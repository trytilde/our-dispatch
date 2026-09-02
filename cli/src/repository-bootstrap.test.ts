import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { InitializationCommandRunner, InitializationPrompts } from "./initialization.js";
import { bootstrapOpenBotRepository } from "./repository-bootstrap.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("OpenBot repository bootstrap", () => {
  it("rejects an incompatible canonical revision before prompts or repository creation", async () => {
    const destination = await temporaryDirectory();
    const { prompts, input, select } = testPrompts();
    const { runner, run } = testRunner(destination, { canonicalPackageName: "openbot" });

    await expect(bootstrapOpenBotRepository({ destination, prompts, runner })).rejects.toThrow(
      "The canonical OpenBot repository is older than this CLI",
    );

    expect(input).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(
      run.mock.calls.some(([command, args]) => command === "gh" && args.includes("fork")),
    ).toBe(false);
    expect(
      run.mock.calls.some(([command, args]) => command === "gh" && args.includes("create")),
    ).toBe(false);
  });

  it("rejects every non-empty directory before prompts or commands", async () => {
    const destination = await temporaryDirectory();
    await writeFile(join(destination, ".hidden"), "present");
    const { prompts, input, select } = testPrompts();
    const { runner, run } = testRunner(destination);

    await expect(bootstrapOpenBotRepository({ destination, prompts, runner })).rejects.toThrow(
      "openbot init requires a completely empty directory",
    );

    expect(input).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("creates and verifies a public fork before configuration", async () => {
    const destination = await temporaryDirectory();
    const { prompts } = testPrompts("my-openbot", "public");
    const { runner, run } = testRunner(destination);

    await bootstrapOpenBotRepository({ destination, prompts, runner });

    const calls = run.mock.calls;
    expect(calls.some(([command, args]) => command === "gh" && args.includes("fork"))).toBe(true);
    expect(
      calls.some(
        ([command, args]) => command === "gh" && args.join(" ") === "repo clone owner/my-openbot .",
      ),
    ).toBe(true);
    expect(
      calls.some(
        ([command, args]) =>
          command === "git" &&
          args.join(" ") === "remote add upstream https://github.com/trytilde/dispatch.git",
      ),
    ).toBe(true);
  });

  it("creates a public fork in the requested GitHub organization", async () => {
    const destination = await temporaryDirectory();
    const { prompts, input } = testPrompts(" trytilde/our-dispatch ", "public");
    const { runner, run } = testRunner(destination);

    await bootstrapOpenBotRepository({ destination, prompts, runner });

    expect(input).toHaveBeenCalledWith("GitHub repository (owner/name)", {
      id: "repository-name",
      description:
        "Enter name to use your GitHub account, or owner/name to create it in an organization.",
      required: true,
    });
    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "gh" &&
          args.join(" ") ===
            "repo fork trytilde/dispatch --org trytilde --fork-name our-dispatch --clone=false",
      ),
    ).toBe(true);
    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "gh" && args.join(" ") === "repo clone trytilde/our-dispatch .",
      ),
    ).toBe(true);
  });

  it("creates a private repository through a temporary bare mirror", async () => {
    const destination = await temporaryDirectory();
    const { prompts } = testPrompts("private-openbot", "private");
    const { runner, run } = testRunner(destination);

    await bootstrapOpenBotRepository({ destination, prompts, runner });

    const calls = run.mock.calls;
    expect(
      calls.some(
        ([command, args]) =>
          command === "gh" && args.join(" ") === "repo create owner/private-openbot --private",
      ),
    ).toBe(true);
    expect(calls.some(([command, args]) => command === "git" && args.includes("--bare"))).toBe(
      true,
    );
    expect(calls.some(([command, args]) => command === "git" && args.includes("--mirror"))).toBe(
      true,
    );
  });

  it("creates a private mirror in the requested GitHub organization", async () => {
    const destination = await temporaryDirectory();
    const { prompts } = testPrompts("trytilde/private-openbot", "private");
    const { runner, run } = testRunner(destination);

    await bootstrapOpenBotRepository({ destination, prompts, runner });

    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "gh" && args.join(" ") === "repo create trytilde/private-openbot --private",
      ),
    ).toBe(true);
    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "gh" && args.join(" ") === "repo clone trytilde/private-openbot .",
      ),
    ).toBe(true);
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openbot-bootstrap-"));
  temporaryDirectories.push(path);
  return path;
}

function testPrompts(name = "unused", visibility = "private") {
  const input = vi.fn(async () => name);
  const select = vi.fn(async () => visibility);
  const prompts: InitializationPrompts = { input, select };
  return { prompts, input, select };
}

function testRunner(destination: string, options: { canonicalPackageName?: string } = {}) {
  const canonicalHead = "a".repeat(40);
  let ownedRepository = "";
  let upstreamAdded = false;
  const run = vi.fn(async (command: string, args: readonly string[]) => {
    if (command === "git" && args[0] === "ls-remote")
      return { stdout: `${canonicalHead}\tHEAD\n`, stderr: "" };
    if (command === "gh" && args.join(" ") === "api user --jq .login")
      return { stdout: "owner\n", stderr: "" };
    if (command === "gh" && args[0] === "api" && args[1]?.includes("contents/package.json"))
      return {
        stdout: Buffer.from(
          JSON.stringify({ name: options.canonicalPackageName ?? "@tryopenbot/workspace" }),
        ).toString("base64"),
        stderr: "",
      };
    if (command === "gh" && args.includes("clone")) {
      ownedRepository = args[2] ?? "";
      await writeFile(
        join(destination, "package.json"),
        JSON.stringify({ name: "@tryopenbot/workspace" }),
      );
    }
    if (command === "git" && args.join(" ") === "remote get-url origin")
      return { stdout: `git@github.com:${ownedRepository}.git\n`, stderr: "" };
    if (command === "git" && args.join(" ") === "rev-parse HEAD")
      return { stdout: `${canonicalHead}\n`, stderr: "" };
    if (command === "git" && args.join(" ") === "remote get-url upstream")
      if (upstreamAdded)
        return { stdout: "https://github.com/trytilde/dispatch.git\n", stderr: "" };
      else throw new Error("upstream is not configured");
    if (command === "git" && args.join(" ").startsWith("remote add upstream")) upstreamAdded = true;
    return { stdout: "", stderr: "" };
  });
  const runner: InitializationCommandRunner = { run };
  return { runner, run };
}
