import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  deployProviders,
  DeploymentOutputs,
  type DeploymentContext,
} from "@tryopenbot/runtime-provider";
import type { CommandRunner } from "@tryopenbot/control-service-provider";
import { buildLocalRuntimeService } from "./local-build.js";
import { LocalRuntimeServiceProvider } from "./local.js";
import { buildVercelRuntimeService } from "./vercel-build.js";
import { VercelRuntimeServiceProvider } from "./vercel.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("combined runtime artifacts", () => {
  it("puts static UI, control API, and isolated agent functions in one Vercel artifact", async () => {
    const root = await fixture();
    const result = await buildVercelRuntimeService(context(root), runner());
    const artifact = result.outputs?.["runtime.artifact"];
    expect(artifact).toBe(join(root, ".openbot-deploy/vercel/control"));
    expect(result.outputs?.["control-service.artifact"]).toBe(artifact);
    expect(result.outputs?.["agent-service.artifact"]).toBe(artifact);
    const agentFunction = join(artifact!, ".vercel/output/functions/api/agents/factory.func");
    expect(await readdir(agentFunction)).toContain("index.mjs");
    expect(
      await Promise.all(
        (await readdir(agentFunction))
          .filter((name) => name.endsWith(".mjs"))
          .map((name) => readFile(join(agentFunction, name), "utf8")),
      ),
    ).toEqual(expect.arrayContaining([expect.stringContaining("agent-response")]));
    expect(
      await readFile(join(artifact!, ".vercel/output/functions/control.func/index.mjs"), "utf8"),
    ).toContain("control-response");
    expect(await readFile(join(artifact!, ".vercel/output/static/index.html"), "utf8")).toContain(
      "OpenBot",
    );
  });

  it("deploys the combined artifact through the explicit runtime project", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-runtime-deploy-"));
    roots.push(root);
    const artifact = join(root, "artifact");
    await mkdir(artifact);
    const run = vi.fn<CommandRunner["run"]>(async (_command, args) =>
      args.includes("deploy")
        ? { stdout: "https://runtime-preview.vercel.app\n", stderr: "" }
        : { stdout: "", stderr: "" },
    );
    const environment: NodeJS.ProcessEnv = {
      VERCEL_RUNTIME_PROJECT: "openbot-runtime",
      VERCEL_TOKEN: "deployment-token",
    };
    const provider = new VercelRuntimeServiceProvider({
      runner: { run },
      request: vi.fn(async () => Response.json({ ok: true })) as typeof fetch,
    });
    const result = await deployProviders(
      [{ id: "runtime", role: "runtime", provider: { deployable: provider } }],
      {
        devMode: false,
        dryRun: false,
        repositoryRoot: root,
        environment,
        initialInputs: { outputs: { "control-service.artifact": artifact } },
      },
    );

    expect(provider.initialization.questions.map(({ id }) => id)).toEqual([
      "vercel-runtime-project",
    ]);
    expect(run).toHaveBeenCalledWith(
      "pnpm",
      expect.arrayContaining(["deploy", "--project", "openbot-runtime"]),
      expect.anything(),
    );
    expect(environment.PUBLIC_ORIGIN).toBe("https://openbot-runtime.vercel.app");
    expect(environment.AGENT_SERVICE_ORIGIN).toBe("https://openbot-runtime.vercel.app");
    expect(environment.VERCEL_CONTROL_PROJECT).toBeUndefined();
    expect(result.get("control-service.deployment-url")).toBe("https://runtime-preview.vercel.app");
    expect(result.get("agent-service.deployment-url")).toBe("https://runtime-preview.vercel.app");
  });

  it("keeps the prior agent origin when the consolidated runtime health check fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-runtime-failed-deploy-"));
    roots.push(root);
    const artifact = join(root, "artifact");
    await mkdir(artifact);
    const run = vi.fn<CommandRunner["run"]>(async (_command, args) =>
      args.includes("deploy")
        ? { stdout: "https://runtime-preview.vercel.app\n", stderr: "" }
        : { stdout: "", stderr: "" },
    );
    const environment: NodeJS.ProcessEnv = {
      AGENT_SERVICE_ORIGIN: "https://openbot-agents.vercel.app",
      VERCEL_RUNTIME_PROJECT: "openbot-runtime",
      VERCEL_TOKEN: "deployment-token",
    };
    const provider = new VercelRuntimeServiceProvider({
      runner: { run },
      request: vi.fn(async (input) =>
        new URL(input instanceof Request ? input.url : input.toString()).hostname ===
        "runtime-preview.vercel.app"
          ? Response.json({ ok: false }, { status: 503 })
          : Response.json({ ok: true }),
      ) as typeof fetch,
    });

    await expect(
      deployProviders([{ id: "runtime", role: "runtime", provider: { deployable: provider } }], {
        devMode: false,
        dryRun: false,
        repositoryRoot: root,
        environment,
        initialInputs: { outputs: { "control-service.artifact": artifact } },
      }),
    ).rejects.toThrow("health smoke failed");
    expect(environment.AGENT_SERVICE_ORIGIN).toBe("https://openbot-agents.vercel.app");
  });

  it("builds one local process with agent routes before the control fallback", async () => {
    const root = await fixture();
    const result = await buildLocalRuntimeService(context(root), runner());
    expect(result.outputs?.["control-service.artifact"]).toBe(
      result.outputs?.["agent-service.artifact"],
    );
    const artifact = result.outputs!["runtime.artifact"]!;
    const source = await readFile(artifact, "utf8");
    expect(source).toContain("/api/agents/factory");
    expect(source).toContain("control-response");
    expect(
      await Promise.all(
        (await readdir(join(artifact, "..")))
          .filter((name) => name.startsWith("agent-") && name.endsWith(".mjs"))
          .map((name) => readFile(join(artifact, "..", name), "utf8")),
      ),
    ).toEqual(expect.arrayContaining([expect.stringContaining("agent-response")]));
  });

  it("retires the legacy systemd agent service only after endpoint cutover", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-runtime-retirement-"));
    roots.push(root);
    const repository = join(root, "repository");
    const homeDirectory = join(root, "home");
    const legacyUnit = join(homeDirectory, ".config/systemd/user/openbot-agents.service");
    await mkdir(repository);
    await mkdir(join(legacyUnit, ".."), { recursive: true });
    await writeFile(legacyUnit, "legacy-agent-service\n");
    const events: string[] = [];
    const run = vi.fn<CommandRunner["run"]>(async (command, args) => {
      events.push(`${command} ${args.join(" ")}`);
      return { stdout: "", stderr: "" };
    });
    const provider = new LocalRuntimeServiceProvider({
      platform: "linux",
      homeDirectory,
      runner: { run },
      request: vi.fn(async () => {
        events.push("health");
        return Response.json({ ok: true });
      }) as typeof fetch,
      command: ["/usr/bin/node", "/tmp/runtime.mjs"],
    });
    const deploy = () =>
      deployProviders([{ id: "runtime", role: "runtime", provider: { deployable: provider } }], {
        devMode: false,
        dryRun: false,
        repositoryRoot: repository,
        environment: { PORT: "4100" },
        initialInputs: { outputs: { "control-service.artifact": "/tmp/runtime.mjs" } },
      });
    const finalize = () =>
      provider.finalizeEndpointCutover({
        devMode: false,
        repositoryRoot: repository,
        environment: { PORT: "4100" },
        inputs: new DeploymentOutputs(),
        report: vi.fn(),
      });

    await deploy();
    expect(events.some((event) => event.includes("disable --now openbot-agents.service"))).toBe(
      false,
    );
    await finalize();
    await deploy();
    await finalize();

    await expect(readFile(`${legacyUnit}.retired`, "utf8")).resolves.toBe("legacy-agent-service\n");
    expect(events.indexOf("systemctl --user restart openbot-control.service")).toBeLessThan(
      events.indexOf("health"),
    );
    expect(events.indexOf("health")).toBeLessThan(
      events.indexOf("systemctl --user disable --now openbot-agents.service"),
    );
    expect(
      events.filter((event) => event.includes("disable --now openbot-agents.service")),
    ).toHaveLength(1);
  });

  it("unloads and preserves a legacy launchd agent definition", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-runtime-retirement-"));
    roots.push(root);
    const repository = join(root, "repository");
    const homeDirectory = join(root, "home");
    const legacyPlist = join(homeDirectory, "Library/LaunchAgents/ai.openbot.openbot-agents.plist");
    await mkdir(repository);
    await mkdir(join(legacyPlist, ".."), { recursive: true });
    await writeFile(legacyPlist, "legacy-agent-service\n");
    const run = vi.fn<CommandRunner["run"]>(async () => ({ stdout: "", stderr: "" }));
    const provider = new LocalRuntimeServiceProvider({
      platform: "darwin",
      homeDirectory,
      uid: 501,
      runner: { run },
      request: vi.fn(async () => Response.json({ ok: true })) as typeof fetch,
      command: ["/usr/bin/node", "/tmp/runtime.mjs"],
    });
    await deployProviders(
      [{ id: "runtime", role: "runtime", provider: { deployable: provider } }],
      {
        devMode: false,
        dryRun: false,
        repositoryRoot: repository,
        environment: { PORT: "4100" },
        initialInputs: { outputs: { "control-service.artifact": "/tmp/runtime.mjs" } },
      },
    );
    await provider.finalizeEndpointCutover({
      devMode: false,
      repositoryRoot: repository,
      environment: { PORT: "4100" },
      inputs: new DeploymentOutputs(),
      report: vi.fn(),
    });

    await expect(readFile(`${legacyPlist}.retired`, "utf8")).resolves.toBe(
      "legacy-agent-service\n",
    );
    expect(run).toHaveBeenCalledWith(
      "launchctl",
      ["bootout", "gui/501", legacyPlist],
      expect.anything(),
    );
  });
});

function runner(): CommandRunner {
  return { run: vi.fn(async () => ({ stdout: "", stderr: "" })) };
}

function context(repositoryRoot: string): DeploymentContext {
  return {
    devMode: false,
    repositoryRoot,
    environment: {},
    inputs: new DeploymentOutputs(),
    report: () => undefined,
  };
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-runtime-provider-"));
  roots.push(root);
  await Promise.all([
    mkdir(join(root, "apps/web/dist"), { recursive: true }),
    mkdir(join(root, "apps/control-service/src"), { recursive: true }),
    mkdir(join(root, "configuration/agent/tools"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, "apps/web/dist/index.html"), "<!doctype html><title>OpenBot</title>"),
    writeFile(
      join(root, "apps/control-service/src/app.ts"),
      "export function createApp() { return { fetch: () => new Response('control-response') }; }\n",
    ),
    writeFile(
      join(root, "configuration/index.ts"),
      "export default { providers: { auth: {}, computer: {} } };\n",
    ),
    writeFile(join(root, "configuration/instrumentation.ts"), "export default { setup() {} };\n"),
    writeFile(
      join(root, "configuration/agent/agent.ts"),
      "export default async function endpoint() { return new Response('agent-response'); }\n",
    ),
  ]);
  await Promise.all(
    [
      "await_shell.ts",
      "bash.ts",
      "copy_from_computer.ts",
      "copy_to_computer.ts",
      "glob.ts",
      "grep.ts",
      "read_file.ts",
      "screenshot.ts",
      "write_file.ts",
    ].map((name) =>
      writeFile(join(root, "configuration/agent/tools", name), "export default {};\n"),
    ),
  );
  return root;
}
