import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { DeploymentOutputs } from "@tryopenbot/runtime-provider";
import {
  CODEX_AUTH_JSON,
  CodexInferenceProvider,
  DEFAULT_CODEX_MODEL,
  type CodexAuthenticationClient,
} from "./codex.js";

function authentication(options: { failStored?: boolean } = {}): CodexAuthenticationClient {
  return {
    async loginWithDeviceCode(codexHome) {
      await writeFile(join(codexHome, "auth.json"), '{"tokens":{"refresh":"device"}}');
    },
    async readAccount(codexHome, refreshToken) {
      const auth = await readFile(join(codexHome, "auth.json"), "utf8");
      if (options.failStored && auth.includes("stored")) throw new Error("revoked");
      if (refreshToken)
        await writeFile(join(codexHome, "auth.json"), '{"tokens":{"refresh":"fresh"}}');
      return { type: "chatgpt", planType: "plus" };
    },
  };
}

describe("CodexInferenceProvider", () => {
  it("uses device login and stores only the opaque auth cache as a secret", async () => {
    const provider = new CodexInferenceProvider({ authentication: authentication() });
    const setEnvironment = vi.fn(async () => undefined);
    const setSecret = vi.fn(async () => undefined);

    await provider.initialize({
      repositoryRoot: "/repository",
      environment: {},
      interactive: true,
      setEnvironment,
      setSecret,
    });

    expect(setEnvironment).toHaveBeenCalledWith(
      "INFERENCE_PROVIDER",
      "codex-subscription",
      expect.any(String),
    );
    expect(setEnvironment).toHaveBeenCalledWith(
      "AI_MODEL",
      DEFAULT_CODEX_MODEL,
      expect.any(String),
    );
    expect(setEnvironment).toHaveBeenCalledWith(
      "VERCEL_SUPPORT_LARGE_FUNCTIONS",
      "1",
      expect.any(String),
    );
    expect(setSecret).toHaveBeenCalledWith(
      CODEX_AUTH_JSON,
      '{"tokens":{"refresh":"fresh"}}',
      expect.any(String),
    );
  });

  it("refreshes existing credentials without another device login", async () => {
    const client = authentication();
    const login = vi.spyOn(client, "loginWithDeviceCode");
    const setSecret = vi.fn(async () => undefined);
    const provider = new CodexInferenceProvider({ authentication: client });

    await provider.initialize({
      repositoryRoot: "/repository",
      environment: { CODEX_AUTH_JSON: '{"tokens":{"refresh":"stored"}}' },
      interactive: false,
      setEnvironment: vi.fn(async () => undefined),
      setSecret,
    });

    expect(login).not.toHaveBeenCalled();
    expect(setSecret).toHaveBeenCalledWith(
      CODEX_AUTH_JSON,
      '{"tokens":{"refresh":"fresh"}}',
      expect.any(String),
    );
  });

  it("requires interactive device login when stored credentials are revoked", async () => {
    const provider = new CodexInferenceProvider({
      authentication: authentication({ failStored: true }),
    });

    await expect(
      provider.initialize({
        repositoryRoot: "/repository",
        environment: { CODEX_AUTH_JSON: '{"tokens":{"refresh":"stored"}}' },
        interactive: false,
        setEnvironment: vi.fn(async () => undefined),
        setSecret: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow("Run openbot init in an interactive terminal");
  });

  it("refreshes and persists credentials before development or deployment builds", async () => {
    const setSecret = vi.fn(async () => undefined);
    const environment = { CODEX_AUTH_JSON: '{"tokens":{"refresh":"stored"}}' };
    const provider = new CodexInferenceProvider({ authentication: authentication() });

    await provider.buildable.check({
      devMode: false,
      dryRun: false,
      interactive: false,
      repositoryRoot: "/repository",
      environment,
      inputs: new DeploymentOutputs(),
      persistence: {
        setEnvironment: vi.fn(async () => undefined),
        setSecret,
        unsetEnvironment: vi.fn(async () => undefined),
        unsetSecret: vi.fn(async () => undefined),
      },
      report: vi.fn(),
    });

    expect(setSecret).toHaveBeenCalledWith(
      CODEX_AUTH_JSON,
      '{"tokens":{"refresh":"fresh"}}',
      expect.any(String),
    );
    expect(environment.CODEX_AUTH_JSON).toBe('{"tokens":{"refresh":"fresh"}}');
  });

  it("packages the Linux Codex executable into each prebuilt Vercel agent function", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-codex-vercel-"));
    try {
      const artifact = join(root, "artifact");
      const functions = join(artifact, ".vercel/output/functions/api/agents");
      const executable = join(root, "codex-linux");
      await Promise.all([
        mkdir(join(functions, "factory.func"), { recursive: true }),
        mkdir(join(functions, "assistant.func"), { recursive: true }),
        writeFile(executable, "codex executable"),
      ]);
      await chmod(executable, 0o755);
      const inputs = new DeploymentOutputs();
      inputs.merge({
        outputs: { "agent-service.artifact": artifact, "agent-service.target": "vercel" },
      });
      const provider = new CodexInferenceProvider({
        authentication: authentication(),
        linuxExecutablePath: executable,
      });

      await provider.buildable.build({
        devMode: false,
        dryRun: false,
        interactive: false,
        repositoryRoot: root,
        environment: {},
        inputs,
        report: vi.fn(),
      });

      for (const name of ["factory.func", "assistant.func"]) {
        const deployed = join(functions, name, "codex");
        await expect(readFile(deployed, "utf8")).resolves.toBe("codex executable");
        expect((await stat(deployed)).mode & 0o111).toBe(0o111);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves the pinned Linux Codex executable on a contributor host", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-codex-linux-resolution-"));
    try {
      const artifact = join(root, "artifact");
      await mkdir(join(artifact, ".vercel/output/functions/api/agents"), { recursive: true });
      const inputs = new DeploymentOutputs();
      inputs.merge({
        outputs: { "agent-service.artifact": artifact, "agent-service.target": "vercel" },
      });

      await expect(
        new CodexInferenceProvider().buildable.build({
          devMode: false,
          dryRun: false,
          interactive: false,
          repositoryRoot: root,
          environment: {},
          inputs,
          report: vi.fn(),
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not package a deployment executable for the local agent service", async () => {
    const inputs = new DeploymentOutputs();
    inputs.merge({
      outputs: {
        "agent-service.artifact": "/not-a-vercel-artifact",
        "agent-service.target": "local",
      },
    });
    const provider = new CodexInferenceProvider({
      authentication: authentication(),
      linuxExecutablePath: "/missing-codex",
    });

    await expect(
      provider.buildable.build({
        devMode: false,
        dryRun: false,
        interactive: false,
        repositoryRoot: "/repository",
        environment: {},
        inputs,
        report: vi.fn(),
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps the shared credential available while multiple local agents initialize", async () => {
    const provider = new CodexInferenceProvider();
    const template = provider.agentTemplate.files[0];
    const source = await readFile(template.source, "utf8");

    expect(source).toContain("process.env.CODEX_AUTH_JSON?.trim()");
    expect(source).not.toContain("delete process.env.CODEX_AUTH_JSON");
  });
});
