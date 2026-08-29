import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexInferenceProvider, VercelInferenceProvider } from "@tryopenbot/inference-provider";
import {
  ExeDevRuntimeServiceProvider,
  VercelRuntimeServiceProvider,
} from "@tryopenbot/agent-service-provider";
import {
  ExeDevComputerProvider,
  VercelSandboxComputerProvider,
} from "@tryopenbot/computer-service-provider";
import { renderFileTemplatePath } from "@tryopenbot/utilities";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  applyFileReplacements,
  generateAgeIdentity,
  builtInRuntimeInitializationProviders,
  configuredRuntimeChoice,
  inferenceChoicesForRuntime,
  initializeOpenBot,
  isInitializedOpenBotRepository,
  isOpenBotRepository,
  loadDeploymentConfiguration,
  processCommandRunner,
  prepareInferenceTemplateMigration,
  selectInitializationProviders,
  setEncryptedSecret,
  setEnvironmentValue,
  SANDBOX_SOPS_AGE_KEY,
  type InitializationCommandRunner,
  type InitializationPrompts,
  unsetEncryptedSecret,
  unsetEnvironmentValue,
} from "./initialization.js";
import { scaffoldAgent, scaffoldAgentTemplates, scaffoldPrimaryAgent } from "./agent-scaffold.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("OpenBot initialization", () => {
  it("recognizes consolidation only when both service roles share one provider instance", () => {
    const shared = new VercelRuntimeServiceProvider();
    const providers = {
      auth: {},
      agent: {},
      computer: new VercelSandboxComputerProvider(),
      controlService: shared,
      agentService: shared,
    };
    expect(configuredRuntimeChoice({ providers } as never)).toBe("vercel");
    expect(
      configuredRuntimeChoice({
        providers: { ...providers, agentService: new VercelRuntimeServiceProvider() },
      } as never),
    ).toBeUndefined();
  });

  it("recognizes the consolidated exe.dev runtime and Computer composition", () => {
    const runtime = new ExeDevRuntimeServiceProvider();
    expect(
      configuredRuntimeChoice({
        providers: {
          auth: {},
          agent: {},
          computer: new ExeDevComputerProvider(),
          controlService: runtime,
          agentService: runtime,
        },
      } as never),
    ).toBe("exe-dev");
    expect(inferenceChoicesForRuntime("exe-dev").map(({ value }) => value)).toEqual([
      "vercel",
      "codex",
    ]);
  });

  it("offers subscription inference for local and Vercel runtimes", () => {
    expect(inferenceChoicesForRuntime("local").map(({ value }) => value)).toEqual([
      "vercel",
      "codex",
    ]);
    expect(inferenceChoicesForRuntime("vercel").map(({ value }) => value)).toEqual([
      "vercel",
      "codex",
    ]);
    expect(builtInRuntimeInitializationProviders("vercel", "codex")).toBeTruthy();
  });

  it("configures ChatGPT immediately after its provider selection", async () => {
    const repositoryRoot = await temporaryRepository();
    const events: string[] = [];
    const request = vi.fn<typeof fetch>();
    const initializeCodex = vi
      .spyOn(CodexInferenceProvider.prototype, "initialize")
      .mockImplementation(async () => {
        events.push("configure:inference");
        throw new Error("Codex configuration reached");
      });
    const runner: InitializationCommandRunner = {
      run: vi.fn(async (command, args) => {
        if (command === "op" && args.includes("template"))
          return {
            stdout: JSON.stringify({ fields: [{ id: "password", value: "" }] }),
            stderr: "",
          };
        if (command === "op" || command === "sops")
          return { stdout: '{"sops":{"mac":"encrypted"}}\n', stderr: "" };
        return { stdout: "", stderr: "" };
      }),
    };

    try {
      await expect(
        initializeOpenBot({
          repositoryRoot,
          runner,
          request,
          userConfigurationPath: testUserConfigurationPath(repositoryRoot),
          prompts: {
            select: vi.fn(async (_prompt, _choices, options) => {
              events.push(`select:${options?.id ?? "unknown"}`);
              if (options?.id === "owner-identity") return "onepassword";
              if (options?.id === "runtime") return "local";
              if (options?.id === "inference") return "codex";
              return "";
            }),
            input: vi.fn(async (_prompt, options) => {
              events.push(`input:${options?.id ?? "unknown"}`);
              if (options?.id === "onepassword-vault") return "Engineering";
              if (options?.id === "onepassword-item-title") return "OpenBot owner identity";
              return "";
            }),
          },
        }),
      ).rejects.toThrow("Codex configuration reached");
    } finally {
      initializeCodex.mockRestore();
    }

    expect(events.slice(-2)).toEqual(["select:inference", "configure:inference"]);
    expect(events).not.toContain("input:tilde-api-key");
    expect(request).not.toHaveBeenCalled();
  });

  it("preselects configured providers while offering every built-in alternative", async () => {
    const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
    const repositoryRoot = await mkdtemp(join(workspaceRoot, ".openbot-provider-selection-"));
    temporaryDirectories.push(repositoryRoot);
    const configurationTemplate = fileURLToPath(
      new URL("./assets/configuration/vercel.ts.hbs", import.meta.url),
    );
    const configurationPath = join(repositoryRoot, "configuration/index.ts");
    await writeFixture(
      repositoryRoot,
      "configuration/index.ts",
      await renderFileTemplatePath(configurationTemplate, { CODEX_INFERENCE: false }),
    );
    const selections = new Map<string, { values: string[]; initialValue?: string }>();
    const prompts: InitializationPrompts = {
      select: vi.fn(
        async (
          _prompt: string,
          choices: readonly { value: string }[],
          options?: { id?: string; initialValue?: string },
        ) => {
          selections.set(options?.id ?? "", {
            values: choices.map(({ value }) => value),
            initialValue: options?.initialValue,
          });
          return options?.id === "inference" ? "codex" : (options?.initialValue ?? "");
        },
      ),
      input: vi.fn(async () => ""),
    };

    const selected = await selectInitializationProviders(configurationPath, prompts, {
      TILDE_BASE_URL: "https://api.trytilde.ai",
    });

    expect(selections.get("runtime")).toEqual({
      values: ["exe-dev", "local", "vercel", "tilde-cloud"],
      initialValue: "vercel",
    });
    expect(selections.get("inference")).toEqual({
      values: ["vercel", "codex"],
      initialValue: "vercel",
    });
    expect(selected.runtime).toBe("vercel");
    expect(selected.inference).toBe("codex");
    expect(selected.configurationSource).toContain("new CodexInferenceProvider()");
    expect(await readFile(configurationPath, "utf8")).toContain(
      "new VercelInferenceProvider(vercel)",
    );
  });

  it("refuses to rewrite an owner-edited built-in composition", async () => {
    const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
    const repositoryRoot = await mkdtemp(join(workspaceRoot, ".openbot-provider-selection-"));
    temporaryDirectories.push(repositoryRoot);
    const configurationTemplate = fileURLToPath(
      new URL("./assets/configuration/vercel.ts.hbs", import.meta.url),
    );
    const configurationPath = join(repositoryRoot, "configuration/index.ts");
    const canonical = await renderFileTemplatePath(configurationTemplate, {
      CODEX_INFERENCE: false,
    });
    await writeFixture(
      repositoryRoot,
      "configuration/index.ts",
      `${canonical}\n// Owner-specific provider wiring.\n`,
    );

    await expect(
      selectInitializationProviders(
        configurationPath,
        {
          select: vi.fn(async (_prompt, _choices, options) =>
            options?.id === "inference" ? "codex" : (options?.initialValue ?? ""),
          ),
          input: vi.fn(async () => ""),
        },
        { TILDE_BASE_URL: "https://api.trytilde.ai" },
      ),
    ).rejects.toThrow("configuration/index.ts contains fork-owned changes");
    expect(await readFile(configurationPath, "utf8")).toContain(
      "// Owner-specific provider wiring.",
    );
  });

  it("migrates provider-owned inference source for existing and future agents", async () => {
    const repositoryRoot = await temporaryRepository();
    const codex = new CodexInferenceProvider();
    const vercel = new VercelInferenceProvider();
    await scaffoldAgentTemplates(repositoryRoot, codex.agentTemplate.files);
    await scaffoldPrimaryAgent(repositoryRoot, "Factory");
    await scaffoldAgent(repositoryRoot, "Research Assistant");

    const replacements = await prepareInferenceTemplateMigration(
      repositoryRoot,
      codex.agentTemplate.files,
      vercel.agentTemplate.files,
      {
        AGENT_FACTORY_NAME: "Factory",
        AGENT_RESEARCH_ASSISTANT_NAME: "Research Assistant",
      },
    );
    expect(
      await readFile(join(repositoryRoot, "configuration/agent/inference.ts"), "utf8"),
    ).toContain("createCodexAppServer");

    await applyFileReplacements(replacements);

    for (const path of [
      "configuration/templates/agent/inference.ts.hbs",
      "configuration/agent/inference.ts",
      "configuration/agent/subagents/research-assistant/inference.ts",
    ]) {
      const inferenceSource = await readFile(join(repositoryRoot, path), "utf8");
      expect(inferenceSource).toContain('import { stepCountIs } from "ai"');
      expect(inferenceSource).toContain("stopWhen: stepCountIs(50)");
    }
  });

  it("refuses inference migration when an existing agent owns the affected file", async () => {
    const repositoryRoot = await temporaryRepository();
    const codex = new CodexInferenceProvider();
    const vercel = new VercelInferenceProvider();
    await scaffoldAgentTemplates(repositoryRoot, codex.agentTemplate.files);
    await scaffoldPrimaryAgent(repositoryRoot, "Factory");
    await writeFixture(
      repositoryRoot,
      "configuration/agent/inference.ts",
      `${await readFile(join(repositoryRoot, "configuration/agent/inference.ts"), "utf8")}\n// Owner edit.\n`,
    );

    await expect(
      prepareInferenceTemplateMigration(
        repositoryRoot,
        codex.agentTemplate.files,
        vercel.agentTemplate.files,
        { AGENT_FACTORY_NAME: "Factory" },
      ),
    ).rejects.toThrow("contains fork-owned changes");
    expect(
      await readFile(
        join(repositoryRoot, "configuration/templates/agent/inference.ts.hbs"),
        "utf8",
      ),
    ).toContain("createCodexAppServer");
  });

  it("rejects initialization outside an OpenBot repository before writing configuration", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "not-openbot-init-"));
    temporaryDirectories.push(repositoryRoot);

    await expect(
      initializeOpenBot({
        repositoryRoot,
        userConfigurationPath: testUserConfigurationPath(repositoryRoot),
        prompts: {
          select: vi.fn(async () => ""),
          input: vi.fn(async () => ""),
        },
      }),
    ).rejects.toThrow("openbot init must run from the root of a cloned OpenBot repository");

    await expect(access(join(repositoryRoot, "configuration"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("recognizes a cloned checkout separately from a completed initialization", async () => {
    const repositoryRoot = await temporaryRepository();

    await expect(isOpenBotRepository(repositoryRoot)).resolves.toBe(true);
    await expect(isInitializedOpenBotRepository(repositoryRoot)).resolves.toBe(false);
  });

  it("generates valid-looking age identities", () => {
    const identity = generateAgeIdentity();
    expect(identity.recipient).toMatch(/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/);
    expect(identity.identity).toMatch(/^AGE-SECRET-KEY-1[023456789ACDEFGHJKLMNPQRSTUVWXYZ]{58}$/);
  });

  it.skipIf(spawnSync("sops", ["--version"]).error || spawnSync("mkfifo", ["--version"]).error)(
    "generates age identities accepted by SOPS",
    async () => {
      const identity = generateAgeIdentity();
      const encrypted = await processCommandRunner.runWithInputFile!(
        "sops",
        ["encrypt", "--age", identity.recipient, "--input-type", "json", "--output-type", "json"],
        { input: '{"proof":"ok"}' },
      );
      const decrypted = await processCommandRunner.runWithInputFile!(
        "sops",
        ["decrypt", "--input-type", "json", "--output-type", "json"],
        {
          input: encrypted.stdout,
          environment: { ...process.env, SOPS_AGE_KEY: identity.identity },
        },
      );
      expect(JSON.parse(decrypted.stdout)).toEqual({ proof: "ok" });
    },
  );

  it.skipIf(spawnSync("sops", ["--version"]).error || spawnSync("mkfifo", ["--version"]).error)(
    "round-trips an initialized configuration through its owner identity",
    async () => {
      const repositoryRoot = await temporaryRepository();
      let ownerIdentity = "";
      const runner: InitializationCommandRunner = {
        async run(command, args, options) {
          if (command === "op" && args.includes("template"))
            return {
              stdout: JSON.stringify({ fields: [{ id: "password", value: "" }] }),
              stderr: "",
            };
          if (command === "op" && args.includes("create")) {
            const item = JSON.parse(options?.input ?? "{}") as {
              fields?: { id?: string; value?: string }[];
            };
            ownerIdentity = item.fields?.find((field) => field.id === "password")?.value ?? "";
            return { stdout: "", stderr: "" };
          }
          if (command === "op" && args.includes("read"))
            return { stdout: ownerIdentity, stderr: "" };
          if (command === "vp") return { stdout: "", stderr: "" };
          return processCommandRunner.run(command, args, options);
        },
        runWithInputFile: processCommandRunner.runWithInputFile,
      };
      const selections = ["onepassword", "local", "vercel"];
      const inputs = ["Engineering", "OpenBot owner identity"];
      await initializeOpenBot({
        repositoryRoot,
        userConfigurationPath: testUserConfigurationPath(repositoryRoot),
        runner,
        prompts: {
          select: async () => selections.shift()!,
          input: async (_prompt, options) => {
            const providerAnswers: Record<string, string> = {
              "tilde-api-key": "tilde-private",
              "tilde-org-id": "tilde-org",
              "tilde-team-id": "tilde-team",
              "vercel-token": "vercel-private",
              "vercel-team-id": "",
              "vercel-ai-gateway-api-key-name": "OpenBot agents",
            };
            return options?.id ? (providerAnswers[options.id] ?? "") : (inputs.shift() ?? "");
          },
        },
        request: async () =>
          Response.json({ apiKey: { id: "key_123" }, apiKeyString: "gateway-private" }),
      });

      const loaded = await loadDeploymentConfiguration(repositoryRoot, {
        runner,
        environment: { ...process.env },
        userConfigurationPath: testUserConfigurationPath(repositoryRoot),
      });
      expect(loaded.environment.AGENT_FACTORY_NAME).toBe("Factory");
      expect(loaded.environment[SANDBOX_SOPS_AGE_KEY]).toMatch(/^AGE-SECRET-KEY-1/);
      const configuration = await readFile(join(repositoryRoot, "configuration/index.ts"), "utf8");
      expect(configuration).toContain("providers: {");
      expect(configuration).toContain("const runtime = new LocalRuntimeServiceProvider()");
      expect(configuration).toContain("controlService: runtime");
      expect(configuration).toContain("agentService: runtime");
      expect(configuration).toContain("agent: new TildeAgentProvider(tilde)");
      expect(configuration).toContain("inference: new VercelInferenceProvider(vercel)");
      expect(configuration).not.toContain("inferenceModel");
      expect(configuration).not.toContain("requiredEnvironment");
      await expect(
        access(join(repositoryRoot, "configuration/runtime-providers.ts")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const primaryAgent = await readFile(
        join(repositoryRoot, "configuration/agent/agent.ts"),
        "utf8",
      );
      expect(primaryAgent).toContain("export default chatKitEndpoint");
      expect(primaryAgent).toContain("createTildeAttachmentMessageHandlers(client, context)");
      expect(primaryAgent).toContain("createTildeMediaUploader");
      expect(primaryAgent).toContain("createTildeMediaDownloader");
      expect(primaryAgent).toContain('responseMode: "agentLoop"');
      expect(primaryAgent).not.toContain("createChatKitAttachmentFilePartHandler");
      expect(primaryAgent).not.toContain("base64");
      expect(primaryAgent).not.toContain("@tryopenbot/agent-provider");
      expect(
        await readFile(join(repositoryRoot, "configuration/agent/instructions.ts"), "utf8"),
      ).toContain("export default");
      await expect(
        access(join(repositoryRoot, "configuration/agent/tools/factory.ts")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const bashTool = await readFile(
        join(repositoryRoot, "configuration/agent/tools/bash.ts"),
        "utf8",
      );
      expect(bashTool).toContain("createBashTool");
      expect(bashTool).toContain('agentId: "factory"');
      expect(
        await readFile(join(repositoryRoot, "configuration/agent/tools/read_file.ts"), "utf8"),
      ).toContain("createReadFileTool");
      expect(
        await readFile(join(repositoryRoot, "configuration/agent/tools/write_file.ts"), "utf8"),
      ).toContain("createWriteFileTool");
      expect(
        await readFile(join(repositoryRoot, "configuration/agent/tools/glob.ts"), "utf8"),
      ).toContain("createGlobTool");
      expect(
        await readFile(join(repositoryRoot, "configuration/agent/tools/grep.ts"), "utf8"),
      ).toContain("createGrepTool");
      expect(
        await readFile(
          join(repositoryRoot, "configuration/agent/skills/develop-openbot/SKILL.md"),
          "utf8",
        ),
      ).toContain("name: develop-openbot");
      expect(
        await readFile(
          join(repositoryRoot, "configuration/agent/skills/create-agent/SKILL.md"),
          "utf8",
        ),
      ).toContain("pnpm openbot new-agent");
      expect(
        await readFile(
          join(repositoryRoot, "configuration/agent/sandbox/workspace/.profile"),
          "utf8",
        ),
      ).toContain("$HOME/.bashrc");
      expect(
        await readFile(join(repositoryRoot, "configuration/instrumentation.ts"), "utf8"),
      ).toContain("defineInstrumentation");
      expect(
        await readFile(join(repositoryRoot, "configuration/templates/agent/agent.ts.hbs"), "utf8"),
      ).toContain('responseMode: "agentLoop"');
      expect(
        await readFile(join(repositoryRoot, "configuration/templates/agent/agent.ts.hbs"), "utf8"),
      ).toContain("AGENT_{{AGENT_ENV_PREFIX}}_API_KEY");
      await expect(access(join(repositoryRoot, "configuration/skills"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(access(join(repositoryRoot, "configuration/sandbox"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(loaded.environment.COMPUTER_IMAGE_REPOSITORY).toBeUndefined();
      await expect(access(join(repositoryRoot, "configuration/.gitignore"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("preserves a fork-owned configuration ignore file and stops before initialization", async () => {
    const repositoryRoot = await temporaryRepository();
    await writeFixture(repositoryRoot, "configuration/.gitignore", "private-cache/\n");

    await expect(
      initializeOpenBot({
        repositoryRoot,
        userConfigurationPath: testUserConfigurationPath(repositoryRoot),
        prompts: {
          select: vi.fn(async () => ""),
          input: vi.fn(async () => ""),
        },
        runner: { run: vi.fn(async () => ({ stdout: "", stderr: "" })) },
      }),
    ).rejects.toThrow("configuration/.gitignore is fork-owned");

    expect(await readFile(join(repositoryRoot, "configuration/.gitignore"), "utf8")).toBe(
      "private-cache/\n",
    );
    await expect(access(join(repositoryRoot, "configuration/.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails immediately when the configured SOPS owner cannot encrypt", async () => {
    const repositoryRoot = await temporaryRepository();
    const select = vi.fn(async () => "aws-kms");
    const answers = [
      "arn:aws:kms:eu-west-1:123456789012:key/00000000-0000-0000-0000-000000000000",
      "sso-admin",
    ];
    const input = vi.fn(async () => answers.shift() ?? "");
    const runner: InitializationCommandRunner = {
      run: vi.fn(async (command, args, options) => {
        if (command === "aws") {
          expect(args).toEqual([
            "configure",
            "export-credentials",
            "--profile",
            "sso-admin",
            "--format",
            "process",
          ]);
          return {
            stdout: JSON.stringify({
              Version: 1,
              AccessKeyId: "fresh-access-key",
              SecretAccessKey: "fresh-secret-key",
              SessionToken: "fresh-session-token",
            }),
            stderr: "",
          };
        }
        if (command === "sops") {
          expect(args).not.toContain("--aws-profile");
          expect(options?.environment).toMatchObject({
            AWS_ACCESS_KEY_ID: "fresh-access-key",
            AWS_SECRET_ACCESS_KEY: "fresh-secret-key",
            AWS_SESSION_TOKEN: "fresh-session-token",
          });
          throw new Error("KMS access denied");
        }
        return { stdout: "", stderr: "" };
      }),
    };

    await expect(
      initializeOpenBot({
        repositoryRoot,
        prompts: { select, input },
        runner,
        userConfigurationPath: testUserConfigurationPath(repositoryRoot),
      }),
    ).rejects.toThrow("SOPS encryption test failed: KMS access denied");

    expect(select).toHaveBeenCalledTimes(1);
    expect(input).toHaveBeenCalledTimes(2);
    await expect(
      access(join(repositoryRoot, "configuration/secrets.enc.yaml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stores the owner identity in 1Password and encrypts the sandbox identity", async () => {
    const repositoryRoot = await temporaryRepository();
    const answers = ["onepassword", "vercel", "vercel"];
    const inputs: Record<string, string> = {
      "onepassword-vault": "Engineering",
      "onepassword-item-title": "OpenBot owner identity",
      "vercel-token": "vercel-secret",
      "vercel-team-id": "",
      "vercel-runtime-project": "openbot-runtime",
      "vercel-ai-gateway-api-key-name": "OpenBot agents",
      "tilde-api-key": "tilde-secret",
      "tilde-org-id": "tilde-org",
      "tilde-team-id": "tilde-team",
      "openbot-deployment-name": "OpenBot",
      "tilde-base-url": "",
    };
    const promptInput = vi.fn(async (_prompt, options) => inputs[options?.id ?? ""] ?? "");
    const prompts: InitializationPrompts = {
      select: vi.fn(async () => answers.shift()!),
      input: promptInput,
    };
    const calls: { command: string; args: readonly string[]; input?: string }[] = [];
    const runner: InitializationCommandRunner = {
      run: vi.fn(async (command, args, options) => {
        calls.push({ command, args, input: options?.input });
        if (command === "op" && args.includes("template"))
          return {
            stdout: JSON.stringify({ fields: [{ id: "password", value: "" }] }),
            stderr: "",
          };
        if (command === "sops") return { stdout: '{"sops":{"mac":"encrypted"}}\n', stderr: "" };
        return { stdout: "", stderr: "" };
      }),
    };

    await initializeOpenBot({
      repositoryRoot,
      prompts,
      request: async (input) =>
        (input instanceof Request ? input.url : input instanceof URL ? input.href : input).includes(
          "/identity/openbot/deployments",
        )
          ? Response.json({
              client_id: "openbot-client",
              audience: "urn:tilde:openbot:openbot-client",
              issuer: "https://tilde-org.api.trytilde.ai/api/v1/team/tilde-team/identity/oauth",
              scope: "openid profile email offline_access openbot:control",
              authorization_endpoint: "https://api.trytilde.ai/api/v1/identity/oauth/authorize",
              token_endpoint: "https://api.trytilde.ai/api/v1/identity/oauth/token",
              jwks_uri: "https://api.trytilde.ai/api/v1/identity/.well-known/jwks.json",
            })
          : Response.json({ apiKey: { id: "key_123" }, apiKeyString: "gateway-private" }),
      runner,
      userConfigurationPath: testUserConfigurationPath(repositoryRoot),
    });

    expect(calls.at(-1)).toMatchObject({ command: "vp", args: ["install"] });

    expect(promptInput).toHaveBeenCalledTimes(13);
    const environment = await readFile(join(repositoryRoot, "configuration/.env"), "utf8");
    expect(environment).not.toContain("RUNTIME_PROVIDER");
    expect(environment).toContain('VERCEL_RUNTIME_PROJECT="openbot-runtime"');
    expect(environment).toContain(
      "# Name of the single Vercel project that will host the web app, control API, and isolated agent functions.",
    );
    expect(environment).not.toContain("VERCEL_AGENT_PROJECT");
    expect(environment).toContain('VERCEL_AI_GATEWAY_API_KEY_NAME="OpenBot agents"');
    expect(environment).not.toContain("OPENAI_BASE_URL");
    expect(environment).toContain('TILDE_ORG_ID="tilde-org"');
    expect(environment).toContain('TILDE_TEAM_ID="tilde-team"');
    expect(environment).not.toContain("TILDE_RUNTIME_MCP_SERVER_ID");
    expect(environment).not.toContain("TILDE_BASE_URL");
    expect(environment).not.toContain("COMPUTER_IMAGE_REPOSITORY");
    expect(environment).not.toContain("vercel-secret");
    const configuration = await readFile(join(repositoryRoot, "configuration/index.ts"), "utf8");
    expect(configuration).toContain("providers: {");
    expect(configuration).toContain(
      "const runtime = new VercelRuntimeServiceProvider({ platform: vercel })",
    );
    expect(configuration).toContain("controlService: runtime");
    expect(configuration).toContain("agentService: runtime");
    expect(configuration).toContain("inference: new VercelInferenceProvider(vercel)");
    const sopsConfig = await readFile(join(repositoryRoot, "configuration/.sops.yaml"), "utf8");
    expect(sopsConfig.match(/- age1/g)).toHaveLength(2);
    const encrypted = await readFile(
      join(repositoryRoot, "configuration/secrets.enc.yaml"),
      "utf8",
    );
    expect(encrypted).not.toContain("AGE-SECRET-KEY");
    expect(encrypted).not.toContain("vercel-secret");
    const metadata = await readFile(testUserConfigurationPath(repositoryRoot), "utf8");
    expect(metadata).toContain('"sops"');
    expect(metadata).toContain("op://Engineering/OpenBot owner identity/password");
    await expect(
      access(join(repositoryRoot, "configuration/sops.identity.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const onePasswordCreate = calls.find(
      (call) => call.command === "op" && call.args.includes("create"),
    );
    expect(onePasswordCreate?.input).toContain("AGE-SECRET-KEY-1");
    expect(onePasswordCreate?.args.join(" ")).not.toContain("AGE-SECRET-KEY");
    const encryption = calls.find(
      (call) => call.command === "sops" && call.input?.includes("SECRETS_SOPS_AGE_KEY:"),
    );
    expect(encryption?.input).toContain("SECRETS_SOPS_AGE_KEY:");
    expect(encryption?.input).toContain("description:");
    expect(encryption?.input).toContain("value: AGE-SECRET-KEY-1");
    expect(encryption?.input).toContain("VERCEL_TOKEN:");
    expect(encryption?.input).toContain("value: vercel-secret");
    expect(encryption?.input).toContain("value: tilde-secret");
    expect(encryption?.input).toContain("AI_GATEWAY_API_KEY:");
    expect(encryption?.input).toContain("value: gateway-private");
    expect(encryption?.input).toContain("COMPUTER_SERVICE_API_KEY:");
    expect(encryption?.args).toContain("--encrypted-regex");
    expect(encryption?.args.join(" ")).not.toContain("vercel-secret");
    await expect(access(join(repositoryRoot, "configuration/.gitignore"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("revisits initialized platform config with existing values as defaults", async () => {
    const repositoryRoot = await temporaryRepository();
    const sopsConfiguration = stringifyYaml({
      creation_rules: [
        {
          path_regex: "configuration/secrets\\.enc\\.yaml$",
          encrypted_regex: "^value$",
          age: ["age1owner"],
        },
      ],
    });
    const storedSecrets = {
      EXTRA_SECRET: { description: "Unrelated secret", value: "keep-secret" },
      SECRETS_SOPS_AGE_KEY: {
        description: "Sandbox age identity",
        value: "AGE-SECRET-KEY-1STORED",
      },
    };
    await writeFixture(
      repositoryRoot,
      "configuration/.env",
      'TILDE_ORG_ID="stored-org"\nUNRELATED="keep"\n',
    );
    await writeFixture(repositoryRoot, "configuration/.sops.yaml", sopsConfiguration);
    await writeFixture(repositoryRoot, "configuration/secrets.enc.yaml", "encrypted\n");
    await writeFixture(
      repositoryRoot,
      "user-config.json",
      '{"version":1,"sops":{"ownerIdentity":{"kind":"gcp-kms"}}}\n',
    );
    await writeFixture(
      repositoryRoot,
      "configuration/index.ts",
      `function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(\`${"${name}"} is required\`);
  return value;
}

class TildeAgentProvider {
  configured = requiredEnvironment("TILDE_API_KEY");
}

export default {
  providers: {
    controlService: {},
    agentService: {},
    agent: new TildeAgentProvider(),
    computer: {},
  },
};
`,
    );

    const defaults = new Map<string, string | undefined>();
    let encryptionInput: string | undefined;
    const run = vi.fn(async (command: string, args: readonly string[]) => {
      if (command === "sops" && args[0] === "decrypt")
        return { stdout: stringifyYaml(storedSecrets), stderr: "" };
      if (command === "vp") return { stdout: "", stderr: "" };
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });
    const runner: InitializationCommandRunner = {
      run,
      runWithInputFile: vi.fn(async (command, args, options) => {
        expect(command).toBe("sops");
        expect(args[0]).toBe("encrypt");
        encryptionInput = options.input;
        const plaintext = parseYaml(options.input) as Record<
          string,
          { description: string; value: string }
        >;
        const encrypted = Object.fromEntries(
          Object.entries(plaintext).map(([name, described]) => [
            name,
            { ...described, value: `ENC[${name}]` },
          ]),
        );
        return { stdout: stringifyYaml({ ...encrypted, sops: { mac: "encrypted" } }), stderr: "" };
      }),
    };
    const select = vi.fn(async (_prompt, _choices, options) => options?.initialValue ?? "");
    const prompts: InitializationPrompts = {
      select,
      input: vi.fn(async (_prompt, options) => {
        defaults.set(options?.id ?? "", options?.initialValue);
        if (options?.id === "tilde-api-key") return "entered-tilde";
        if (options?.id === "tilde-team-id") return "entered-team";
        return options?.id === "tilde-org-id" ? "updated-org" : (options?.initialValue ?? "");
      }),
    };

    expect(await isInitializedOpenBotRepository(repositoryRoot)).toBe(true);
    await initializeOpenBot({
      repositoryRoot,
      prompts,
      runner,
      userConfigurationPath: testUserConfigurationPath(repositoryRoot),
    });

    expect(select).toHaveBeenCalledTimes(2);
    for (const call of select.mock.calls) {
      expect(call[1].map((choice: { value: string }) => choice.value)).toContain("current");
      expect(call[2]?.initialValue).toBe("current");
    }
    expect(defaults).toEqual(
      new Map([
        ["tilde-api-key", undefined],
        ["tilde-org-id", "stored-org"],
        ["tilde-team-id", undefined],
        ["openbot-deployment-name", "OpenBot"],
        ["tilde-base-url", "https://api.trytilde.ai"],
      ]),
    );
    const environment = await readFile(join(repositoryRoot, "configuration/.env"), "utf8");
    expect(environment).toContain('TILDE_ORG_ID="updated-org"');
    expect(environment).toContain('TILDE_TEAM_ID="entered-team"');
    expect(environment).toContain('TILDE_BASE_URL="https://api.trytilde.ai"');
    expect(environment).toContain('UNRELATED="keep"');
    const reencrypted = parseYaml(encryptionInput ?? "") as typeof storedSecrets;
    expect(reencrypted).toMatchObject({
      TILDE_API_KEY: {
        description: "API key used by OpenBot services to access the selected Tilde team.",
        value: "entered-tilde",
      },
    });
    expect(reencrypted.EXTRA_SECRET).toEqual(storedSecrets.EXTRA_SECRET);
    expect(reencrypted.SECRETS_SOPS_AGE_KEY).toEqual(storedSecrets.SECRETS_SOPS_AGE_KEY);
    expect(await readFile(join(repositoryRoot, "configuration/.sops.yaml"), "utf8")).toBe(
      sopsConfiguration,
    );
    expect(run).toHaveBeenLastCalledWith("vp", ["install"], { cwd: repositoryRoot });
  });

  it("loads runtime values while keeping the sandbox identity sandbox-scoped", async () => {
    const repositoryRoot = await temporaryRepository();
    await writeFixture(repositoryRoot, "configuration/.env", "AI_MODEL=openai/gpt-test\n");
    await writeFixture(
      repositoryRoot,
      "configuration/.sops.yaml",
      "creation_rules:\n  - kms:\n      - arn:aws:kms:us-east-1:123456789012:alias/test\n    encrypted_regex: ^value$\n",
    );
    await writeFixture(repositoryRoot, "configuration/secrets.enc.yaml", "encrypted\n");
    await writeFixture(
      repositoryRoot,
      "user-config.json",
      JSON.stringify({
        version: 1,
        sops: { ownerIdentity: { kind: "aws-profile", profile: "sso-admin" } },
      }),
    );
    const runner: InitializationCommandRunner = {
      run: vi.fn(async (command, args, options) => {
        if (command === "aws") {
          expect(args).toContain("sso-admin");
          return {
            stdout: JSON.stringify({
              Version: 1,
              AccessKeyId: "fresh-access-key",
              SecretAccessKey: "fresh-secret-key",
              SessionToken: "fresh-session-token",
            }),
            stderr: "",
          };
        }
        expect(command).toBe("sops");
        expect(options?.environment).toMatchObject({
          AWS_ACCESS_KEY_ID: "fresh-access-key",
          AWS_SECRET_ACCESS_KEY: "fresh-secret-key",
          AWS_SESSION_TOKEN: "fresh-session-token",
        });
        expect(options?.environment?.AWS_PROFILE).toBeUndefined();
        expect(options?.environment?.AWS_DEFAULT_PROFILE).toBeUndefined();
        return {
          stdout: JSON.stringify({
            SECRETS_SOPS_AGE_KEY: {
              description: "Sandbox age identity",
              value: "AGE-SECRET-KEY-1TEST",
            },
            VERCEL_TOKEN: { description: "Vercel deployment token", value: "deploy-private" },
            API_TOKEN: { description: "Runtime API token", value: "private" },
            COMPUTER_SERVICE_API_KEY: {
              description: "Computer service key",
              value: "computer-private",
            },
          }),
          stderr: "",
        };
      }),
    };

    const loaded = await loadDeploymentConfiguration(repositoryRoot, {
      runner,
      environment: {},
      userConfigurationPath: testUserConfigurationPath(repositoryRoot),
    });

    expect(loaded.environment).toMatchObject({
      AI_MODEL: "openai/gpt-test",
      API_TOKEN: "private",
      VERCEL_TOKEN: "deploy-private",
    });
    expect(loaded.environment.COMPUTER_SERVICE_API_KEY).toBe("computer-private");
    expect(loaded.environment[SANDBOX_SOPS_AGE_KEY]).toBe("AGE-SECRET-KEY-1TEST");
    expect(loaded.configuration).toEqual({
      AI_MODEL: "openai/gpt-test",
      API_TOKEN: "private",
      VERCEL_TOKEN: "deploy-private",
      COMPUTER_SERVICE_API_KEY: "computer-private",
    });
    expect(loaded.configuration[SANDBOX_SOPS_AGE_KEY]).toBeUndefined();
    expect(JSON.parse(await readFile(testUserConfigurationPath(repositoryRoot), "utf8"))).toEqual({
      version: 1,
      sops: { ownerIdentity: { kind: "aws-profile", profile: "sso-admin" } },
    });
  });

  it("fails safely when SOPS values are missing from user configuration non-interactively", async () => {
    const repositoryRoot = await temporaryRepository();
    await writeFixture(
      repositoryRoot,
      "configuration/.sops.yaml",
      stringifyYaml({ creation_rules: [{ age: ["age1owner"] }] }),
    );
    await writeFixture(repositoryRoot, "configuration/secrets.enc.yaml", "encrypted\n");
    const runner: InitializationCommandRunner = { run: vi.fn() };

    await expect(
      loadDeploymentConfiguration(repositoryRoot, {
        runner,
        environment: {},
      }),
    ).rejects.toThrow("local-user-config.json");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("recovers missing age lookup metadata interactively without replacing the identity", async () => {
    const repositoryRoot = await temporaryRepository();
    await writeFixture(
      repositoryRoot,
      "configuration/.sops.yaml",
      stringifyYaml({ creation_rules: [{ age: ["age1owner"] }] }),
    );
    await writeFixture(repositoryRoot, "configuration/secrets.enc.yaml", "encrypted\n");
    const runner: InitializationCommandRunner = {
      run: vi.fn(async (command, args, options) => {
        if (command === "op") return { stdout: "AGE-SECRET-KEY-1EXISTING", stderr: "" };
        expect(command).toBe("sops");
        expect(args[0]).toBe("decrypt");
        expect(options?.environment?.SOPS_AGE_KEY).toBe("AGE-SECRET-KEY-1EXISTING");
        return {
          stdout: stringifyYaml({
            SECRETS_SOPS_AGE_KEY: {
              description: "Sandbox age identity",
              value: "AGE-SECRET-KEY-1SANDBOX",
            },
          }),
          stderr: "",
        };
      }),
    };
    const select = vi.fn(async () => "onepassword");
    const prompts: InitializationPrompts = {
      select,
      input: vi.fn(async () => "op://Engineering/OpenBot owner identity/password"),
    };

    await loadDeploymentConfiguration(repositoryRoot, {
      runner,
      environment: {},
      prompts,
    });

    expect(
      JSON.parse(await readFile(join(repositoryRoot, "local-user-config.json"), "utf8")),
    ).toEqual({
      version: 1,
      sops: {
        ownerIdentity: {
          kind: "onepassword",
          reference: "op://Engineering/OpenBot owner identity/password",
        },
      },
    });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("sets and unsets encrypted secrets by re-using the existing data key", async () => {
    const repositoryRoot = await temporaryRepository();
    await writeFixture(
      repositoryRoot,
      "configuration/.sops.yaml",
      stringifyYaml({
        creation_rules: [{ age: ["age1owner"], encrypted_regex: "^value$" }],
      }),
    );
    const calls: { args: readonly string[]; input?: string }[] = [];
    const runner: InitializationCommandRunner = {
      run: vi.fn(async (_command, args, options) => {
        calls.push({ args, input: options?.input });
        return {
          stdout: args.includes("decrypt")
            ? stringifyYaml({
                EXISTING: { description: "Existing secret.", value: "existing-value" },
              })
            : "",
          stderr: "",
        };
      }),
      runWithInputFile: vi.fn(async (_command, args, options) => {
        calls.push({ args, input: options.input });
        const plaintext = parseYaml(options.input) as Record<
          string,
          { description: string; value: string }
        >;
        return {
          stdout: stringifyYaml({
            ...Object.fromEntries(
              Object.entries(plaintext).map(([name, described]) => [
                name,
                { ...described, value: `ENC[${name}]` },
              ]),
            ),
            sops: { mac: "encrypted" },
          }),
          stderr: "",
        };
      }),
    };

    await setEncryptedSecret(repositoryRoot, "VERCEL_TOKEN", "private-value", {
      runner,
      environment: { SOPS_AGE_KEY: "owner" },
      description: "Vercel deployment credential.",
    });
    await unsetEncryptedSecret(repositoryRoot, "VERCEL_TOKEN", {
      runner,
      environment: { SOPS_AGE_KEY: "owner" },
    });

    // `sops set` re-uses the file's data key so a single recipient can write without KMS access.
    const set = calls.find((call) => call.args.includes("set"));
    expect(set).toBeDefined();
    expect(set?.args.some((argument) => argument.includes('["VERCEL_TOKEN"]'))).toBe(true);
    expect(
      JSON.parse(set?.args.find((argument) => argument.startsWith("{")) ?? "{}"),
    ).toMatchObject({
      description: "Vercel deployment credential.",
      value: "private-value",
    });
    expect(calls.every((call) => !call.args.includes("encrypt"))).toBe(true);
    expect(calls.some((call) => call.args.includes("unset"))).toBe(true);
  });

  it("sets and unsets described environment values", async () => {
    const repositoryRoot = await temporaryRepository();
    await writeFixture(
      repositoryRoot,
      "configuration/.env",
      '# Existing description\nEXISTING="old"\nUNRELATED=value\n',
    );

    await setEnvironmentValue(repositoryRoot, "EXISTING", "new", "Updated description.");
    await setEnvironmentValue(repositoryRoot, "NEW", "value", "New description.");
    let environment = await readFile(join(repositoryRoot, "configuration/.env"), "utf8");
    expect(environment).toContain('# Updated description.\nEXISTING="new"');
    expect(environment).toContain('# New description.\nNEW="value"');
    expect(environment).toContain("UNRELATED=value");

    await unsetEnvironmentValue(repositoryRoot, "EXISTING");
    environment = await readFile(join(repositoryRoot, "configuration/.env"), "utf8");
    expect(environment).not.toContain("Updated description");
    expect(environment).not.toContain("EXISTING");
    expect(environment).toContain("UNRELATED=value");
  });
});

async function temporaryRepository(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openbot-init-"));
  temporaryDirectories.push(path);
  await writeFixture(path, "package.json", '{"name":"@tryopenbot/workspace"}\n');
  await writeFixture(path, "pnpm-workspace.yaml", "packages:\n  - cli\n");
  await writeFixture(path, "cli/package.json", '{"name":"openbot"}\n');
  await writeFixture(path, "configuration/.gitignore", "*\n!.gitignore\n");
  return path;
}

function testUserConfigurationPath(repositoryRoot: string): string {
  return join(repositoryRoot, "user-config.json");
}

async function writeFixture(root: string, relativePath: string, contents: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
