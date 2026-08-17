import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { deployProviders, DeploymentOutputs } from "@tryopenbot/runtime-provider";
import { LocalControlServiceProvider } from "./local/index.js";
import { deploymentUrl, VercelControlServiceProvider } from "./vercel/index.js";
import { buildVercelControlService } from "./vercel/build.js";
import type { CommandRunner } from "./command.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("control service providers", () => {
  it("depends on shared Vercel setup but owns only its control project question", () => {
    const provider = new VercelControlServiceProvider();
    expect(provider.platforms.map(({ id }) => id)).toEqual(["vercel"]);
    expect(provider.initialization.questions.map(({ id }) => id)).toEqual([
      "vercel-control-project",
    ]);
    expect(
      provider.baseUrl({
        devMode: false,
        environment: { VERCEL_CONTROL_PROJECT: "control" },
      }),
    ).toEqual(new URL("https://control.vercel.app"));
  });

  it("bundles provider-owned Vercel assets into a prebuilt artifact", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "apps/web/dist"), { recursive: true });
    await mkdir(join(root, "apps/control-service/src"), { recursive: true });
    await mkdir(join(root, "configuration"), { recursive: true });
    await writeFile(
      join(root, "apps/web/dist/index.html"),
      "<!doctype html><title>OpenBot</title>",
    );
    await writeFile(
      join(root, "apps/control-service/src/app.ts"),
      "export function createApp() { return { fetch: () => Response.json({ service: 'openbot-control' }) }; }\n",
    );
    await writeFile(
      join(root, "configuration/index.ts"),
      `import { VercelControlServiceProvider } from ${JSON.stringify(join(process.cwd(), "src/index.ts"))};\nexport default { providers: { controlService: new VercelControlServiceProvider() } };\n`,
    );
    const run = vi.fn<CommandRunner["run"]>(async () => ({ stdout: "", stderr: "" }));
    const result = await buildVercelControlService(
      {
        devMode: false,
        repositoryRoot: root,
        environment: {},
        inputs: new DeploymentOutputs(),
        report: () => undefined,
      },
      { run },
    );
    const artifact = result.outputs?.["control-service.artifact"];
    expect(artifact).toBe(join(root, ".openbot-deploy/vercel/control"));
    const outputConfiguration = JSON.parse(
      await readFile(join(artifact!, ".vercel/output/config.json"), "utf8"),
    ) as { version: number; routes: Array<{ src?: string; dest?: string }> };
    expect(outputConfiguration).toMatchObject({ version: 3 });
    expect(outputConfiguration.routes).toContainEqual({ src: "/api(?:/.*)?", dest: "/control" });
    expect(outputConfiguration.routes).not.toContainEqual(
      expect.objectContaining({ src: expect.stringContaining("/rpc") }),
    );
    const functionSource = await readFile(
      join(artifact!, ".vercel/output/functions/control.func/index.mjs"),
      "utf8",
    );
    expect(functionSource).toContain("openbot-control");
    expect(functionSource).not.toContain("Cannot find native binding");
    expect(await readFile(join(artifact!, ".vercel/output/static/index.html"), "utf8")).toContain(
      "OpenBot",
    );
  });

  it("installs a secret-free local systemd unit", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "repository with spaces");
    await mkdir(repository);
    const run = vi.fn<CommandRunner["run"]>(async () => ({ stdout: "", stderr: "" }));
    const provider = new LocalControlServiceProvider({
      platform: "linux",
      homeDirectory: join(root, "home"),
      runner: { run },
      request: healthy(),
      command: ["/usr/bin/node", "/tmp/control.mjs"],
    });
    await deployProviders(
      [{ id: "control", role: "runtime", provider: { deployable: provider } }],
      {
        devMode: false,
        dryRun: false,
        repositoryRoot: repository,
        environment: { PORT: "4100", API_KEY: "private-value" },
        initialInputs: {
          outputs: { "control-service.artifact": "/tmp/control.mjs" },
        },
      },
    );
    const unit = await readFile(
      join(root, "home/.config/systemd/user/openbot-control.service"),
      "utf8",
    );
    const environment = await readFile(
      join(repository, ".openbot-deploy/control-service.env"),
      "utf8",
    );
    expect(unit).toContain(`WorkingDirectory=${root}/repository\\x20with\\x20spaces`);
    expect(unit).not.toContain('WorkingDirectory="');
    expect(unit).toContain(
      `EnvironmentFile=${root}/repository\\x20with\\x20spaces/.openbot-deploy/control-service.env`,
    );
    expect(unit).not.toContain('EnvironmentFile="');
    expect(unit).not.toContain("private-value");
    expect(environment).toContain('API_KEY="private-value"');
    expect(run).toHaveBeenCalledWith(
      "systemctl",
      ["--user", "restart", "openbot-control.service"],
      expect.anything(),
    );
  });

  it("deploys the prebuilt control artifact to its own Vercel project", async () => {
    const root = await temporaryRoot();
    const artifact = join(root, "control-artifact");
    await mkdir(artifact);
    const run = vi.fn<CommandRunner["run"]>(async (_command, args) =>
      args.includes("deploy")
        ? { stdout: "https://control-preview.vercel.app\n", stderr: "" }
        : { stdout: "", stderr: "" },
    );
    const provider = new VercelControlServiceProvider({ runner: { run }, request: healthy() });
    await deployProviders(
      [{ id: "control", role: "runtime", provider: { deployable: provider } }],
      {
        devMode: false,
        dryRun: false,
        repositoryRoot: root,
        environment: {
          VERCEL_CONTROL_PROJECT: "openbot-control",
          VERCEL_TOKEN: "deployment-token",
        },
        initialInputs: { outputs: { "control-service.artifact": artifact } },
      },
    );
    expect(run).toHaveBeenCalledWith(
      "pnpm",
      expect.arrayContaining([
        "deploy",
        "--prebuilt",
        "--cwd",
        artifact,
        "--project",
        "openbot-control",
        "--prod",
      ]),
      expect.anything(),
    );
    expect(JSON.parse(await readFile(join(artifact, "vercel.json"), "utf8"))).toMatchObject({
      framework: null,
    });
  });

  it("creates a missing Vercel project before configuring it", async () => {
    const run = vi.fn<CommandRunner["run"]>(async (_command, args) => {
      if (args.includes("inspect")) throw new Error("missing");
      return { stdout: "", stderr: "" };
    });
    const provider = new VercelControlServiceProvider({ runner: { run }, request: healthy() });
    await provider.configure({
      devMode: false,
      repositoryRoot: "/repo",
      environment: { VERCEL_CONTROL_PROJECT: "openbot-control" },
      inputs: new DeploymentOutputs(),
      report: () => undefined,
    });
    expect(run).toHaveBeenCalledWith(
      "pnpm",
      expect.arrayContaining(["project", "add", "openbot-control"]),
      expect.anything(),
    );
  });

  it("keeps Vercel remote operations out of development", async () => {
    const run = vi.fn<CommandRunner["run"]>(async () => ({ stdout: "", stderr: "" }));
    const request = healthy();
    const provider = new VercelControlServiceProvider({ runner: { run }, request });
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

  it("keeps launchd secrets in the private environment file", async () => {
    const root = await temporaryRoot();
    const run = vi.fn<CommandRunner["run"]>(async () => ({ stdout: "", stderr: "" }));
    const provider = new LocalControlServiceProvider({
      platform: "darwin",
      homeDirectory: join(root, "home"),
      uid: 501,
      runner: { run },
      request: healthy(),
      command: ["/usr/bin/node", "/tmp/control.mjs"],
    });
    await deployProviders(
      [{ id: "control", role: "runtime", provider: { deployable: provider } }],
      {
        devMode: false,
        dryRun: false,
        repositoryRoot: root,
        environment: { PORT: "4100", API_KEY: "private-value" },
        initialInputs: {
          outputs: { "control-service.artifact": "/tmp/control.mjs" },
        },
      },
    );
    const plist = await readFile(
      join(root, "home/Library/LaunchAgents/ai.openbot.openbot-control.plist"),
      "utf8",
    );
    expect(plist).toContain("--env-file=");
    expect(plist).not.toContain("private-value");
  });

  it("parses plain and JSON Vercel deployment URLs", () => {
    expect(deploymentUrl("https://one.vercel.app\n")).toBe("https://one.vercel.app");
    expect(deploymentUrl('{"url":"two.vercel.app"}')).toBe("https://two.vercel.app");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-control-provider-"));
  roots.push(root);
  return root;
}
function healthy(): typeof fetch {
  return vi.fn(async () => Response.json({ ok: true })) as typeof fetch;
}
