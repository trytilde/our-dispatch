import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { buildVercelAgentService } from "./vercel/build.js";
import { discoverAgents } from "./discovery.js";
import { discoverAgentWorkspaces } from "./workspaces.js";
import {
  deployProviders,
  DeploymentOutputs,
  type DeploymentContext,
} from "@tryopenbot/runtime-provider";
import { VercelAgentServiceProvider } from "./vercel/index.js";
import type { CommandRunner } from "@tryopenbot/control-service-provider";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("agent service artifacts", () => {
  it("depends on shared Vercel setup but owns only its agent project question", () => {
    const provider = new VercelAgentServiceProvider();
    expect(provider.platforms.map(({ id }) => id)).toEqual(["vercel"]);
    expect(provider.initialization.questions.map(({ id }) => id)).toEqual(["vercel-agent-project"]);
    expect(
      provider.baseUrl({ devMode: false, environment: { VERCEL_AGENT_PROJECT: "agents" } }),
    ).toEqual(new URL("https://agents.vercel.app"));
    expect(provider.baseUrl({ devMode: true, environment: { PORT: "4200" } })).toEqual(
      new URL("http://127.0.0.1:4200"),
    );
  });

  it("rejects agents missing a required computer tool", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "configuration/agent"), { recursive: true });
    await writeFile(
      join(root, "configuration/agent/agent.ts"),
      "export default async function endpoint() { return new Response('incomplete') }\n",
    );
    await expect(discoverAgents(root)).rejects.toThrow("missing a required source file");
  });

  it("discovers stable slugs and emits one independently bundled Vercel function per agent", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "configuration/agent/tools"), { recursive: true });
    await mkdir(join(root, "configuration/agent/subagents/beta/tools"), { recursive: true });
    await writeFile(
      join(root, "configuration/instrumentation.ts"),
      "export default { setup() {} }\n",
    );
    for (const directory of [
      join(root, "configuration/agent"),
      join(root, "configuration/agent/subagents/beta"),
    ]) {
      for (const name of [
        "await_shell.ts",
        "bash.ts",
        "copy_from_computer.ts",
        "copy_to_computer.ts",
        "glob.ts",
        "grep.ts",
        "read_file.ts",
        "screenshot.ts",
        "write_file.ts",
      ]) {
        await writeFile(join(directory, "tools", name), "export default {}\n");
      }
    }
    await writeFile(
      join(root, "configuration/agent/agent.ts"),
      "export default async function endpoint() { return new Response('hello-world') }\n",
    );
    await writeFile(
      join(root, "configuration/agent/subagents/beta/agent.ts"),
      "export default async function endpoint() { return new Response('beta') }\n",
    );
    await writeFile(
      join(root, "configuration/agent/instrumentation.ts"),
      "export default { setup() {} }\n",
    );
    await writeFile(
      join(root, "configuration/agent/subagents/beta/instrumentation.ts"),
      "export default { setup() {} }\n",
    );
    await mkdir(join(root, "configuration/agent/sandbox/workspace"), { recursive: true });
    await mkdir(join(root, "configuration/agent/subagents/beta/sandbox/workspace"), {
      recursive: true,
    });
    await writeFile(
      join(root, "configuration/agent/sandbox/workspace/.profile"),
      "export PROFILE_LOADED=1\n",
    );
    await writeFile(
      join(root, "configuration/agent/subagents/beta/sandbox/workspace/.profile"),
      "export BETA_PROFILE_LOADED=1\n",
    );
    expect((await discoverAgents(root)).map((agent) => [agent.slug, agent.kind])).toEqual([
      ["factory", "primary"],
      ["beta", "subagent"],
    ]);
    expect(
      (await discoverAgentWorkspaces(root)).map((workspace) => [
        workspace.agentId,
        workspace.files.map((file) => file.path),
      ]),
    ).toEqual([
      ["factory", [".profile"]],
      ["beta", [".profile"]],
    ]);
    const result = await buildVercelAgentService(context(root));
    expect(result.outputs?.["agent-service.target"]).toBe("vercel");
    expect(result.outputs?.["agent-service.count"]).toBe("2");
    expect(result.outputs?.["agent-service.changed-count"]).toBe("2");
    for (const slug of ["factory", "beta"]) {
      const config = JSON.parse(
        await readFile(
          join(
            root,
            `.openbot-deploy/vercel/agents/.vercel/output/functions/api/agents/${slug}.func/.vc-config.json`,
          ),
          "utf8",
        ),
      ) as { runtime: string; handler: string };
      expect(config).toMatchObject({ runtime: "nodejs24.x", handler: "index.mjs" });
      expect(
        await readFile(
          join(
            root,
            `.openbot-deploy/vercel/agents/.vercel/output/functions/api/agents/${slug}.func/index.mjs`,
          ),
          "utf8",
        ),
      ).toContain(slug);
    }
    const cached = await buildVercelAgentService(context(root));
    expect(cached.outputs?.["agent-service.changed-count"]).toBe("0");
    await writeFile(
      join(root, "configuration/agent/subagents/beta/agent.ts"),
      "export default async function endpoint() { return new Response('beta changed') }\n",
    );
    const oneChanged = await buildVercelAgentService(context(root));
    expect(oneChanged.outputs?.["agent-service.changed-count"]).toBe("1");
  });

  it("rejects nested subagents", async () => {
    const nestedRoot = await temporaryRoot();
    await createMinimalAgent(join(nestedRoot, "configuration/agent"));
    await createMinimalAgent(join(nestedRoot, "configuration/agent/subagents/beta"));
    await mkdir(join(nestedRoot, "configuration/agent/subagents/beta/subagents"));
    await expect(discoverAgents(nestedRoot)).rejects.toThrow("Nested subagents are not supported");
  });

  it("materializes provider-owned Vercel project configuration during deploy", async () => {
    const root = await temporaryRoot();
    const artifact = join(root, "agent-artifact");
    await mkdir(artifact);
    const run = vi.fn<CommandRunner["run"]>(async (_command, args) =>
      args.includes("deploy")
        ? { stdout: "https://agents-preview.vercel.app\n", stderr: "" }
        : { stdout: "", stderr: "" },
    );
    const provider = new VercelAgentServiceProvider({
      runner: { run },
      request: vi.fn(async () => Response.json({ ok: true })) as typeof fetch,
    });
    await deployProviders([{ id: "agents", provider: { deployable: provider } }], {
      devMode: false,
      dryRun: false,
      repositoryRoot: root,
      environment: { VERCEL_AGENT_PROJECT: "openbot-agents", VERCEL_TOKEN: "deployment-token" },
      initialInputs: {
        outputs: { "agent-service.artifact": artifact, "agent-service.count": "0" },
      },
    });
    expect(run).toHaveBeenCalledWith(
      "pnpm",
      expect.arrayContaining([
        "deploy",
        "--prebuilt",
        "--cwd",
        artifact,
        "--project",
        "openbot-agents",
        "--prod",
      ]),
      expect.anything(),
    );
    expect(JSON.parse(await readFile(join(artifact, "vercel.json"), "utf8"))).toMatchObject({
      framework: null,
    });
  });

  it("keeps Vercel remote operations out of development", async () => {
    const run = vi.fn<CommandRunner["run"]>(async () => ({ stdout: "", stderr: "" }));
    const request = vi.fn(async () => Response.json({ ok: true })) as typeof fetch;
    const provider = new VercelAgentServiceProvider({ runner: { run }, request });
    const development = {
      devMode: true,
      repositoryRoot: "/repository",
      environment: {},
      inputs: new DeploymentOutputs(),
      report: vi.fn(),
    } as const;

    await expect(provider.build(development)).resolves.toBeUndefined();
    await expect(provider.configure(development)).resolves.toEqual({});
    await expect(provider.deploy(development)).resolves.toEqual({});
    await expect(provider.plan(development)).resolves.toMatchObject({
      summary: expect.stringContaining("development"),
    });
    expect(run).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});

function context(repositoryRoot: string): DeploymentContext {
  return {
    devMode: false,
    repositoryRoot,
    environment: {},
    inputs: new DeploymentOutputs(),
    report: () => undefined,
  };
}
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-agent-provider-"));
  roots.push(root);
  return root;
}

async function createMinimalAgent(directory: string): Promise<void> {
  await mkdir(join(directory, "tools"), { recursive: true });
  await writeFile(
    join(directory, "agent.ts"),
    "export default async function endpoint() { return new Response('ok') }\n",
  );
  for (const name of [
    "await_shell.ts",
    "bash.ts",
    "copy_from_computer.ts",
    "copy_to_computer.ts",
    "glob.ts",
    "grep.ts",
    "read_file.ts",
    "screenshot.ts",
    "write_file.ts",
  ])
    await writeFile(join(directory, "tools", name), "export default {}\n");
}
