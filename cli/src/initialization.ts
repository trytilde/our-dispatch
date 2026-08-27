import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  discoverAgents,
  LocalRuntimeServiceProvider,
  VercelRuntimeServiceProvider,
} from "@tryopenbot/agent-service-provider";
import { TildeAuthProvider } from "@tryopenbot/auth-provider";
import { tildeAgentProviderInitialization } from "@tryopenbot/agent-provider";
import type {
  OpenBotConfiguration,
  SopsOwnerIdentityConfiguration,
  UserConfiguration,
} from "@tryopenbot/configuration";
import {
  MicrosandboxComputerProvider,
  VercelSandboxComputerProvider,
} from "@tryopenbot/computer-service-provider";
import {
  collectProviderInitializations,
  initializeProviders,
  type InitializableProvider,
  type ProviderInitialization,
  type ProviderInitializationQuestion,
} from "@tryopenbot/runtime-provider";
import { GitHubGitProvider, LocalGitProvider } from "@tryopenbot/git-provider";
import {
  CODEX_INFERENCE_PROVIDER,
  CodexInferenceProvider,
  type InferenceAgentTemplateFile,
  type InferenceProvider,
  VERCEL_INFERENCE_PROVIDER,
  VercelInferenceProvider,
} from "@tryopenbot/inference-provider";
import { tildePlatform, VercelPlatform } from "@tryopenbot/platform-integrations";
import { materializeFileTemplate, renderFileTemplatePath } from "@tryopenbot/utilities";
import {
  agentTemplateDirectory,
  scaffoldAgentTemplates,
  scaffoldPrimaryAgent,
} from "./agent-scaffold.js";
import { loadConfigurationModule } from "./configuration-loader.js";

export const SANDBOX_SOPS_AGE_KEY = "SOPS_AGE_KEY";
const COMPUTER_SERVICE_SECRET = "COMPUTER_SERVICE_API_KEY";
const COMPUTER_SERVICE_ENVIRONMENT = "COMPUTER_SERVICE_API_KEY";
const SECRETS_SOPS_AGE_SECRET = "SECRETS_SOPS_AGE_KEY";
const upstreamConfigurationIgnore = "*\n!.gitignore\n";
const configurationAssets = {
  instrumentation: fileURLToPath(
    new URL("./assets/agents/instrumentation.ts.hbs", import.meta.url),
  ),
  local: fileURLToPath(new URL("./assets/configuration/local.ts.hbs", import.meta.url)),
  tildeCloud: fileURLToPath(new URL("./assets/configuration/tilde-cloud.ts.hbs", import.meta.url)),
  tsconfig: fileURLToPath(new URL("./assets/configuration/tsconfig.json.hbs", import.meta.url)),
  vercel: fileURLToPath(new URL("./assets/configuration/vercel.ts.hbs", import.meta.url)),
} as const;
const fileTemplates = {
  document: fileURLToPath(new URL("./assets/files/document.hbs", import.meta.url)),
  empty: fileURLToPath(new URL("./assets/files/empty.hbs", import.meta.url)),
  environmentEntry: fileURLToPath(new URL("./assets/files/environment-entry.hbs", import.meta.url)),
} as const;
export interface SelectChoice {
  value: string;
  label: string;
  description?: string;
}

export interface InitializationPrompts {
  select(
    prompt: string,
    choices: readonly SelectChoice[],
    options?: { id?: string; initialValue?: string },
  ): Promise<string>;
  input(
    prompt: string,
    options?: {
      id?: string;
      description?: string;
      secret?: boolean;
      required?: boolean;
      initialValue?: string;
    },
  ): Promise<string>;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface InitializationCommandRunner {
  run: (
    command: string,
    args: readonly string[],
    options?: { cwd?: string; environment?: NodeJS.ProcessEnv; input?: string },
  ) => Promise<CommandResult>;
  runWithInputFile?: (
    command: string,
    args: readonly string[],
    options: { cwd?: string; environment?: NodeJS.ProcessEnv; input: string },
  ) => Promise<CommandResult>;
}

export interface InitializationOptions {
  repositoryRoot: string;
  prompts: InitializationPrompts;
  runner?: InitializationCommandRunner;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  interactive?: boolean;
  userConfigurationPath?: string;
  request?: typeof fetch;
  /** Renders provider provisioning events; defaults to plain standard output lines. */
  report?: InitializationEventReporter;
}

export type InitializationEventReporter = (event: {
  event: string;
  details?: Readonly<Record<string, unknown>>;
}) => void;

interface AgeIdentity {
  recipient: string;
  identity: string;
}

type SopsCreationRule = Record<string, string | readonly string[]>;

interface DescribedValue {
  description: string;
  value: string;
}

interface OwnerIdentity {
  creationRule: SopsCreationRule;
  metadata: SopsOwnerIdentityConfiguration;
}

interface ExistingInitializationState {
  creationRule: SopsCreationRule;
  encryptionEnvironment: NodeJS.ProcessEnv;
  environmentValues: Record<string, string>;
  secretValues: Record<string, DescribedValue>;
  providerEnvironment: NodeJS.ProcessEnv;
}

export const ownerIdentityChoices: readonly SelectChoice[] = [
  {
    value: "vault-transit",
    label: "HashiCorp Vault Transit",
    description: "Use an existing Vault Transit encryption key.",
  },
  {
    value: "azure-key-vault",
    label: "Azure Key Vault",
    description: "Use an Azure Key Vault key as the owner identity.",
  },
  {
    value: "gcp-kms",
    label: "Google Cloud KMS",
    description: "Use Google Cloud IAM to control owner access.",
  },
  {
    value: "aws-kms",
    label: "Amazon AWS KMS",
    description: "Use AWS IAM to control owner access.",
  },
  {
    value: "onepassword",
    label: "1Password",
    description: "Generate an owner age identity and keep it in 1Password.",
  },
  {
    value: "native-age",
    label: "Native keychain",
    description: "Generate an owner age identity and keep it in this computer's keychain.",
  },
  {
    value: "managed-file",
    label: "Managed Computer file",
    description:
      "Generate an owner age identity in a private file on a managed persistent Computer.",
  },
];

export const runtimeChoices: readonly SelectChoice[] = [
  {
    value: "local",
    label: "Local",
    description: "Run OpenBot as user services on this computer.",
  },
  {
    value: "vercel",
    label: "Vercel",
    description: "Deploy the web app, control API, and isolated agent functions as one runtime.",
  },
  {
    value: "tilde-cloud",
    label: "Tilde Cloud",
    description:
      "Run Vercel services and Sandbox under Tilde's managed hosting and DNS control plane.",
  },
];

export const inferenceChoices: readonly SelectChoice[] = [
  {
    value: "vercel",
    label: "Vercel AI Gateway",
    description: "Use API-backed models through the Vercel AI SDK gateway.",
  },
  {
    value: "codex",
    label: "ChatGPT subscription",
    description: "Use Codex app-server after signing in with a device code.",
  },
];

type RuntimeChoice = "local" | "vercel" | "tilde-cloud";
type InferenceChoice = "vercel" | "codex";

interface InitializationProviderSelection {
  providers: readonly InitializableProvider[];
  runtime: RuntimeChoice | "current";
  inference: InferenceChoice | "current";
  previousInference?: InferenceChoice;
  configurationSource?: string;
}

interface InitializationProviderStage {
  domain: "runtime" | "inference";
  providers: readonly InitializableProvider[];
  inference?: InferenceChoice | "current";
  previousInference?: InferenceChoice;
}

type InitializationProviderStageHandler = (stage: InitializationProviderStage) => Promise<void>;

interface InitializationStageState {
  initializations: Map<string, ProviderInitialization>;
  questions: Map<string, ProviderInitializationQuestion>;
  initializedProviders: Set<string>;
}

export function inferenceChoicesForRuntime(
  runtime: "local" | "vercel" | "tilde-cloud",
): readonly SelectChoice[] {
  return runtime === "tilde-cloud"
    ? inferenceChoices.filter((choice) => choice.value === "vercel")
    : inferenceChoices;
}

export async function initializeOpenBot(options: InitializationOptions): Promise<void> {
  await assertOpenBotRepositoryRoot(options.repositoryRoot);
  const runner = options.runner ?? processCommandRunner;
  const configurationDirectory = resolve(options.repositoryRoot, "configuration");
  const environmentPath = resolve(configurationDirectory, ".env");
  const sopsConfigPath = resolve(configurationDirectory, ".sops.yaml");
  const secretsPath = resolve(configurationDirectory, "secrets.enc.yaml");
  const configurationPath = resolve(configurationDirectory, "index.ts");
  const configurationIgnorePath = resolve(configurationDirectory, ".gitignore");

  const existingMarkers = await Promise.all(
    [secretsPath, sopsConfigPath].map((path) => exists(path)),
  );
  if (existingMarkers.some(Boolean)) {
    if (!existingMarkers.every(Boolean))
      throw new Error(
        "OpenBot has an incomplete SOPS configuration; preserve or remove it before retrying init",
      );
    await reconfigureOpenBot(options, runner, {
      configurationPath,
      environmentPath,
      secretsPath,
      sopsConfigPath,
    });
    return;
  }

  await mkdir(configurationDirectory, { recursive: true, mode: 0o700 });
  await assertUpstreamConfigurationIgnore(configurationIgnorePath);
  await createBlankEnvironment(environmentPath);
  const sandboxIdentity = generateAgeIdentity();
  const ownerKind = await options.prompts.select(
    "How should owners decrypt OpenBot secrets?",
    ownerIdentityChoices,
    { id: "owner-identity" },
  );
  const owner = await configureOwnerIdentity(ownerKind, options, runner);
  const ownerEncryptionEnvironment = await sopsEncryptionEnvironment(
    runner,
    owner.metadata,
    options.repositoryRoot,
    options.environment ?? process.env,
  );
  await assertSopsEncryptionWorks(
    runner,
    { ...owner.creationRule, encrypted_regex: "^value$" },
    options.repositoryRoot,
    ownerEncryptionEnvironment,
  );
  await storeUserOwnerIdentity(options.repositoryRoot, owner.metadata, {
    path: options.userConfigurationPath,
  });

  const environmentValues: Record<string, DescribedValue> = {};
  const secretValues: Record<string, DescribedValue> = {};
  const stageState = createInitializationStageState();
  const provisioningValues = {
    baseEnvironment: options.environment ?? process.env,
    environmentValues,
    interactive: options.interactive !== false,
    report: options.report,
    request: options.request,
    secretValues,
  };
  const ask = async (question: ProviderInitializationQuestion) => {
    const value = await askProviderQuestion(options.prompts, question);
    if (!value) return;
    const described = {
      description: question.description ?? question.prompt,
      value,
    };
    if (question.destination.kind === "environment")
      environmentValues[question.destination.key] = described;
    else secretValues[question.destination.key] = described;
  };
  const selection = await selectInitializationProviders(
    configurationPath,
    options.prompts,
    undefined,
    async ({ providers }) =>
      configureInitializationStage(
        providers,
        options.repositoryRoot,
        stageState,
        provisioningValues,
        ask,
      ),
  );
  const selectedProviders = selection.providers;
  await configureInitializationStage(
    selectedProviders,
    options.repositoryRoot,
    stageState,
    provisioningValues,
    ask,
  );
  secretValues[COMPUTER_SERVICE_SECRET] ??= {
    description: "Shared bearer key for computer-service RPC authentication.",
    value: randomBytes(32).toString("base64url"),
  };
  secretValues[SECRETS_SOPS_AGE_SECRET] = {
    description: "Age identity used by the trusted deployment sandbox to decrypt secrets.",
    value: sandboxIdentity.identity,
  };
  environmentValues.AGENT_FACTORY_NAME = {
    description: "Display name for the factory agent.",
    value: "Factory",
  };

  const ownerAge = owner.creationRule.age;
  const creationRule: SopsCreationRule = {
    ...owner.creationRule,
    path_regex: "configuration/secrets\\.enc\\.yaml$",
    encrypted_regex: "^value$",
    age: [sandboxIdentity.recipient, ...(Array.isArray(ownerAge) ? ownerAge : [])],
  };
  const plaintext = stringifyYaml(secretValues);
  const encryptArguments = [
    "encrypt",
    ...sopsEncryptionArguments(creationRule),
    "--filename-override",
    "configuration/secrets.enc.yaml",
    "--input-type",
    "yaml",
    "--output-type",
    "yaml",
  ];
  const encrypted = runner.runWithInputFile
    ? await runner.runWithInputFile("sops", encryptArguments, {
        cwd: options.repositoryRoot,
        environment: ownerEncryptionEnvironment,
        input: plaintext,
      })
    : await runner.run("sops", encryptArguments, {
        cwd: options.repositoryRoot,
        environment: ownerEncryptionEnvironment,
        input: plaintext,
      });
  if (!encrypted.stdout.trim()) throw new Error("SOPS did not return an encrypted configuration");
  const encryptedDocument = parseYaml(encrypted.stdout) as { sops?: unknown } | undefined;
  if (!encryptedDocument?.sops || encrypted.stdout.includes(sandboxIdentity.identity))
    throw new Error("SOPS returned an invalid encrypted configuration");

  await writeFileAtomically(
    sopsConfigPath,
    await renderDocument(stringifyYaml({ creation_rules: [creationRule] })),
    0o600,
  );
  await writeFileAtomically(secretsPath, await renderDocument(encrypted.stdout), 0o600);
  await updateEnvironmentFile(environmentPath, environmentValues);
  if (selection.configurationSource)
    await writeFileAtomically(configurationPath, selection.configurationSource, 0o600);
  await createConfiguration(
    resolve(configurationDirectory, "instrumentation.ts"),
    configurationAssets.instrumentation,
  );
  await createConfiguration(
    resolve(configurationDirectory, "tsconfig.json"),
    configurationAssets.tsconfig,
  );
  await scaffoldAgentTemplates(options.repositoryRoot, inferenceTemplateFiles(selectedProviders));
  await scaffoldPrimaryAgent(options.repositoryRoot, "Factory", { existing: "preserve" });
  await rm(configurationIgnorePath, { force: true });
  await runner.run("vp", ["install"], { cwd: options.repositoryRoot });
}

export async function isInitializedOpenBotRepository(repositoryRoot: string): Promise<boolean> {
  if (!(await isOpenBotRepository(repositoryRoot))) return false;
  const configurationDirectory = resolve(repositoryRoot, "configuration");
  const markers = await Promise.all(
    [".sops.yaml", "secrets.enc.yaml"].map((name) => exists(resolve(configurationDirectory, name))),
  );
  return markers.every(Boolean);
}

export async function isOpenBotRepository(repositoryRoot: string): Promise<boolean> {
  try {
    await assertOpenBotRepositoryRoot(repositoryRoot);
    return true;
  } catch {
    return false;
  }
}

async function reconfigureOpenBot(
  options: InitializationOptions,
  runner: InitializationCommandRunner,
  paths: {
    configurationPath: string;
    environmentPath: string;
    secretsPath: string;
    sopsConfigPath: string;
  },
): Promise<void> {
  const state = await loadExistingInitializationState(options, runner, paths);
  const environmentValues: Record<string, DescribedValue> = {};
  const removedEnvironmentNames = new Set<string>();
  const stageState = createInitializationStageState();
  const allEnvironmentValues: Record<string, DescribedValue> = Object.fromEntries(
    Object.entries(state.environmentValues).map(([name, value]) => [
      name,
      { description: "Existing OpenBot environment value.", value },
    ]),
  );
  const provisioningValues = {
    baseEnvironment: options.environment ?? process.env,
    environmentValues: allEnvironmentValues,
    secretValues: state.secretValues,
    environmentUpdates: environmentValues,
    interactive: options.interactive !== false,
    report: options.report,
    request: options.request,
  };
  const ask = async (question: ProviderInitializationQuestion) => {
    const secretName = repositorySecretName(question.destination.key);
    const initialValue =
      question.destination.kind === "environment"
        ? state.environmentValues[question.destination.key]
        : state.secretValues[secretName]?.value;
    const value = await askProviderQuestion(options.prompts, question, initialValue);
    if (question.destination.kind === "environment") {
      if (value) {
        const described = {
          description: question.description ?? question.prompt,
          value,
        };
        environmentValues[question.destination.key] = described;
        allEnvironmentValues[question.destination.key] = described;
      } else {
        removedEnvironmentNames.add(question.destination.key);
        delete allEnvironmentValues[question.destination.key];
      }
      return;
    }
    if (value) {
      state.secretValues[secretName] = {
        description: question.description ?? question.prompt,
        value,
      };
    } else {
      delete state.secretValues[secretName];
    }
  };
  let inferenceMigration: FileReplacement[] = [];
  const selection = await selectInitializationProviders(
    paths.configurationPath,
    options.prompts,
    state.providerEnvironment,
    async (stage) => {
      if (
        stage.domain === "inference" &&
        stage.previousInference &&
        stage.inference &&
        stage.inference !== "current" &&
        stage.previousInference !== stage.inference
      ) {
        allEnvironmentValues.INFERENCE_PROVIDER ??= {
          description: "Previous inference implementation selected by this installation.",
          value:
            stage.previousInference === "codex"
              ? CODEX_INFERENCE_PROVIDER
              : VERCEL_INFERENCE_PROVIDER,
        };
        inferenceMigration = await prepareInferenceTemplateMigration(
          options.repositoryRoot,
          inferenceProvider(stage.previousInference, undefined).agentTemplate.files,
          inferenceProvider(stage.inference, undefined).agentTemplate.files,
          state.providerEnvironment,
        );
      }
      await configureInitializationStage(
        stage.providers,
        options.repositoryRoot,
        stageState,
        provisioningValues,
        ask,
      );
    },
  );
  const providers = selection.providers;
  await configureInitializationStage(
    providers,
    options.repositoryRoot,
    stageState,
    provisioningValues,
    ask,
  );

  const encrypted = await encryptSecretsDocument(
    runner,
    options.repositoryRoot,
    state.creationRule,
    state.encryptionEnvironment,
    state.secretValues,
  );
  await reconcileEnvironmentFile(paths.environmentPath, environmentValues, removedEnvironmentNames);
  await writeFileAtomically(paths.secretsPath, await renderDocument(encrypted), 0o600);
  await applyFileReplacements(inferenceMigration);
  if (selection.configurationSource)
    await writeFileAtomically(paths.configurationPath, selection.configurationSource, 0o600);
  await scaffoldAgentTemplates(options.repositoryRoot, inferenceTemplateFiles(providers));
  await createConfiguration(
    resolve(dirname(paths.environmentPath), "tsconfig.json"),
    configurationAssets.tsconfig,
  );
  await scaffoldPrimaryAgent(options.repositoryRoot, "Factory", { existing: "preserve" });
  await runner.run("vp", ["install"], { cwd: options.repositoryRoot });
}

async function loadExistingInitializationState(
  options: InitializationOptions,
  runner: InitializationCommandRunner,
  paths: { environmentPath: string; secretsPath: string; sopsConfigPath: string },
): Promise<ExistingInitializationState> {
  const environmentValues = await readEnvironmentFile(paths.environmentPath);
  const encryptionEnvironment = await sopsCommandEnvironment(options.repositoryRoot, runner, {
    environment: options.environment ?? process.env,
    platform: options.platform ?? process.platform,
    prompts: options.interactive === false ? undefined : options.prompts,
    userConfigurationPath: options.userConfigurationPath,
  });
  const decrypted = await runner.run(
    "sops",
    ["decrypt", "--input-type", "yaml", "--output-type", "yaml", paths.secretsPath],
    { cwd: options.repositoryRoot, environment: encryptionEnvironment },
  );
  const secretValues = parseDescribedSecretsDocument(parseYaml(decrypted.stdout) as unknown);
  const sopsConfiguration = parseYaml(await readFile(paths.sopsConfigPath, "utf8")) as
    | { creation_rules?: unknown }
    | undefined;
  const creationRule = Array.isArray(sopsConfiguration?.creation_rules)
    ? sopsConfiguration.creation_rules[0]
    : undefined;
  if (!creationRule || typeof creationRule !== "object" || Array.isArray(creationRule))
    throw new Error("configuration/.sops.yaml does not contain an OpenBot creation rule");

  const resolvedSecrets: Record<string, string> = {};
  for (const [name, described] of Object.entries(secretValues)) {
    if (name === SECRETS_SOPS_AGE_SECRET) continue;
    resolvedSecrets[runtimeSecretName(name)] = described.value;
  }
  return {
    creationRule: creationRule as SopsCreationRule,
    encryptionEnvironment,
    environmentValues,
    secretValues,
    providerEnvironment: {
      ...(options.environment ?? process.env),
      ...environmentValues,
      ...resolvedSecrets,
    },
  };
}

async function encryptSecretsDocument(
  runner: InitializationCommandRunner,
  repositoryRoot: string,
  creationRule: SopsCreationRule,
  environment: NodeJS.ProcessEnv,
  values: Readonly<Record<string, DescribedValue>>,
): Promise<string> {
  const arguments_ = [
    "encrypt",
    ...sopsEncryptionArguments(creationRule),
    "--filename-override",
    "configuration/secrets.enc.yaml",
    "--input-type",
    "yaml",
    "--output-type",
    "yaml",
  ];
  const input = stringifyYaml(values);
  const encrypted = runner.runWithInputFile
    ? await runner.runWithInputFile("sops", arguments_, {
        cwd: repositoryRoot,
        environment,
        input,
      })
    : await runner.run("sops", arguments_, { cwd: repositoryRoot, environment, input });
  const encryptedDocument = parseYaml(encrypted.stdout) as
    | ({ sops?: unknown } & Record<string, unknown>)
    | undefined;
  if (!encryptedDocument?.sops) throw new Error("SOPS returned an invalid encrypted configuration");
  for (const [name, described] of Object.entries(values)) {
    const encryptedEntry = encryptedDocument[name];
    const encryptedValue =
      encryptedEntry && typeof encryptedEntry === "object" && !Array.isArray(encryptedEntry)
        ? (encryptedEntry as Record<string, unknown>).value
        : undefined;
    if (typeof encryptedValue !== "string" || encryptedValue === described.value)
      throw new Error("SOPS returned plaintext in the encrypted configuration");
  }
  return encrypted.stdout;
}

async function assertOpenBotRepositoryRoot(repositoryRoot: string): Promise<void> {
  try {
    const workspaceManifest = await readFile(resolve(repositoryRoot, "package.json"), "utf8");
    const workspace = JSON.parse(workspaceManifest) as { name?: unknown };
    if (workspace.name === "@tryopenbot/workspace") return;
  } catch {
    // Report one stable repository-boundary error for missing or invalid markers.
  }
  throw new Error(
    "openbot init must run from the root of a cloned OpenBot repository; change to that directory and retry",
  );
}

async function assertUpstreamConfigurationIgnore(path: string): Promise<void> {
  if (!(await exists(path))) return;
  if ((await readFile(path, "utf8")) === upstreamConfigurationIgnore) return;
  throw new Error(
    "configuration/.gitignore is fork-owned; preserve or remove it before retrying init",
  );
}

export async function loadDeploymentConfiguration(
  repositoryRoot: string,
  options: {
    runner?: InitializationCommandRunner;
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    prompts?: InitializationPrompts;
    userConfigurationPath?: string;
  } = {},
): Promise<{ environment: NodeJS.ProcessEnv; configuration: NodeJS.ProcessEnv }> {
  const runner = options.runner ?? processCommandRunner;
  const configurationDirectory = resolve(repositoryRoot, "configuration");
  const environmentPath = resolve(configurationDirectory, ".env");
  const secretsPath = resolve(configurationDirectory, "secrets.enc.yaml");
  const staticEnvironment = await readEnvironmentFile(environmentPath);
  if (!(await exists(secretsPath))) {
    const configuration = { ...staticEnvironment };
    return {
      environment: { ...(options.environment ?? process.env), ...configuration },
      configuration,
    };
  }

  const commandEnvironment = await sopsCommandEnvironment(repositoryRoot, runner, {
    environment: options.environment ?? process.env,
    platform: options.platform ?? process.platform,
    prompts: options.prompts,
    userConfigurationPath: options.userConfigurationPath,
  });
  const decrypted = await runner.run(
    "sops",
    ["decrypt", "--input-type", "yaml", "--output-type", "yaml", secretsPath],
    {
      cwd: repositoryRoot,
      environment: commandEnvironment,
    },
  );
  const document = parseYaml(decrypted.stdout) as unknown;
  const parsed = parseSecretsDocument(document);
  const configuration = {
    ...staticEnvironment,
    ...parsed.secrets,
  };
  const deploymentEnvironment = {
    ...(options.environment ?? process.env),
    ...configuration,
    [SANDBOX_SOPS_AGE_KEY]: parsed.sandboxAgeIdentity,
  };
  return { environment: deploymentEnvironment, configuration };
}

export async function setEncryptedSecret(
  repositoryRoot: string,
  name: string,
  value: string,
  options: {
    runner?: InitializationCommandRunner;
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    prompts?: InitializationPrompts;
    userConfigurationPath?: string;
    description: string;
  },
): Promise<void> {
  validateSecretName(name);
  if (!value) throw new Error("Secret value must not be empty");
  const description = requireDescription(options.description);
  const runner = options.runner ?? processCommandRunner;
  const environment = await sopsCommandEnvironment(repositoryRoot, runner, {
    environment: options.environment ?? process.env,
    platform: options.platform ?? process.platform,
    prompts: options.prompts,
    userConfigurationPath: options.userConfigurationPath,
  });
  const secretsPath = resolve(repositoryRoot, "configuration/secrets.enc.yaml");
  // `sops set` re-uses the file's existing data key, so any single recipient (such as the
  // sandbox age identity) can persist a secret without access to every master key (KMS).
  // Trade-off: the value appears in the sops process arguments for its brief lifetime.
  await runner.run(
    "sops",
    [
      "set",
      secretsPath,
      `[${JSON.stringify(repositorySecretName(name))}]`,
      JSON.stringify({ description, value }),
    ],
    { cwd: repositoryRoot, environment },
  );
}

export async function setEnvironmentValue(
  repositoryRoot: string,
  name: string,
  value: string,
  description: string,
): Promise<void> {
  validateSecretName(name);
  if (!value) throw new Error("Environment value must not be empty");
  await updateEnvironmentFile(resolve(repositoryRoot, "configuration/.env"), {
    [name]: { description: requireDescription(description), value },
  });
}

export async function unsetEnvironmentValue(repositoryRoot: string, name: string): Promise<void> {
  validateSecretName(name);
  const path = resolve(repositoryRoot, "configuration/.env");
  const contents = await readFile(path, "utf8");
  const pattern = new RegExp(`(?:^# [^\\n]*\\n)?^${name}=.*(?:\\n|$)`, "m");
  await writeFileAtomically(path, contents.replace(pattern, ""), 0o600);
}

export async function unsetEncryptedSecret(
  repositoryRoot: string,
  name: string,
  options: {
    runner?: InitializationCommandRunner;
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    prompts?: InitializationPrompts;
    userConfigurationPath?: string;
  } = {},
): Promise<void> {
  validateSecretName(name);
  const runner = options.runner ?? processCommandRunner;
  const environment = await sopsCommandEnvironment(repositoryRoot, runner, {
    environment: options.environment ?? process.env,
    platform: options.platform ?? process.platform,
    prompts: options.prompts,
    userConfigurationPath: options.userConfigurationPath,
  });
  await runner.run(
    "sops",
    [
      "unset",
      resolve(repositoryRoot, "configuration/secrets.enc.yaml"),
      `[${JSON.stringify(repositorySecretName(name))}]`,
    ],
    { cwd: repositoryRoot, environment },
  );
}

export function generateAgeIdentity(): AgeIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const privateJwk = privateKey.export({ format: "jwk" });
  const publicJwk = publicKey.export({ format: "jwk" });
  if (!privateJwk.d || !publicJwk.x)
    throw new Error("Node.js did not generate a complete X25519 key pair");
  return {
    recipient: bech32Encode("age", Buffer.from(publicJwk.x, "base64url")),
    identity: bech32Encode("age-secret-key-", Buffer.from(privateJwk.d, "base64url")).toUpperCase(),
  };
}

async function configureOwnerIdentity(
  kind: string,
  options: InitializationOptions,
  runner: InitializationCommandRunner,
): Promise<OwnerIdentity> {
  switch (kind) {
    case "aws-kms": {
      const arn = await options.prompts.input("AWS KMS key ARN", {
        id: "aws-kms-key-arn",
        required: true,
      });
      const profile = await options.prompts.input(
        "AWS profile (leave blank to use the default credential chain)",
        { id: "aws-profile" },
      );
      return {
        creationRule: { kms: [arn] },
        metadata: { kind: "aws-profile", ...(profile ? { profile } : {}) },
      };
    }
    case "gcp-kms":
      return {
        creationRule: {
          gcp_kms: [
            await options.prompts.input("Google Cloud KMS resource ID", {
              id: "gcp-kms-resource-id",
              required: true,
            }),
          ],
        },
        metadata: { kind: "gcp-kms" },
      };
    case "azure-key-vault":
      return {
        creationRule: {
          azure_keyvault: [
            await options.prompts.input("Azure Key Vault key URL", {
              id: "azure-key-vault-key-url",
              required: true,
            }),
          ],
        },
        metadata: { kind: "azure-key-vault" },
      };
    case "vault-transit":
      return {
        creationRule: {
          hc_vault_transit_uri: [
            await options.prompts.input("Vault Transit key URI", {
              id: "vault-transit-key-uri",
              required: true,
            }),
          ],
        },
        metadata: { kind: "vault-transit" },
      };
    case "onepassword": {
      const vault = await options.prompts.input("1Password vault", {
        id: "onepassword-vault",
        required: true,
      });
      const title = await options.prompts.input("1Password item title", {
        id: "onepassword-item-title",
        required: true,
      });
      const identity = generateAgeIdentity();
      await storeInOnePassword(runner, vault, title, identity.identity, options.repositoryRoot);
      return {
        creationRule: { age: [identity.recipient] },
        metadata: { kind: "onepassword", reference: `op://${vault}/${title}/password` },
      };
    }
    case "native-age": {
      const platform = options.platform ?? process.platform;
      if (platform !== "darwin" && platform !== "linux")
        throw new Error(`Native keychain age identities are not supported on ${platform}`);
      const identity = generateAgeIdentity();
      await storeInNativeKeychain(runner, platform, identity.identity, options.repositoryRoot);
      return {
        creationRule: { age: [identity.recipient] },
        metadata: { kind: "native-keychain", platform },
      };
    }
    case "managed-file": {
      const path = resolve(
        await options.prompts.input("Managed owner age identity path", {
          id: "managed-owner-identity-path",
          required: true,
        }),
      );
      const identity = generateAgeIdentity();
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, `${identity.identity}\n`, { mode: 0o400, flag: "wx" });
      return {
        creationRule: { age: [identity.recipient] },
        metadata: { kind: "managed-file", path },
      };
    }
    default:
      throw new Error(`Unsupported SOPS owner identity: ${kind}`);
  }
}

async function askProviderQuestion(
  prompts: InitializationPrompts,
  question: ProviderInitializationQuestion,
  initialValue?: string,
): Promise<string> {
  if (!/^[a-z][a-z0-9-]*$/.test(question.id))
    throw new Error(`Invalid provider initialization question id: ${question.id}`);
  if (!/^[A-Z][A-Z0-9_]*$/.test(question.destination.key))
    throw new Error(`Invalid provider initialization destination: ${question.destination.key}`);
  if (question.input === "select" && !question.choices?.length)
    throw new Error(`Select question ${question.id} must define choices`);
  const offeredValue = initialValue ?? question.defaultValue;
  const value =
    question.input === "select"
      ? await prompts.select(question.prompt, question.choices ?? [], {
          id: question.id,
          initialValue: offeredValue,
        })
      : await prompts.input(question.prompt, {
          id: question.id,
          description: question.description,
          secret: question.input === "secret",
          required: question.required,
          initialValue: offeredValue,
        });
  if (value && question.validation && !new RegExp(question.validation.pattern).test(value))
    throw new Error(question.validation.message);
  return value;
}

async function storeInOnePassword(
  runner: InitializationCommandRunner,
  vault: string,
  title: string,
  identity: string,
  cwd: string,
): Promise<void> {
  const templateResult = await runner.run(
    "op",
    ["item", "template", "get", "Password", "--format", "json"],
    { cwd },
  );
  const template = JSON.parse(templateResult.stdout) as {
    title?: string;
    fields?: { id?: string; value?: string }[];
  };
  const password = template.fields?.find((field) => field.id === "password");
  if (!password)
    throw new Error("1Password's Password item template did not contain a password field");
  template.title = title;
  password.value = identity;
  await runner.run("op", ["item", "create", "--vault", vault, "-"], {
    cwd,
    input: JSON.stringify(template),
  });
}

async function storeInNativeKeychain(
  runner: InitializationCommandRunner,
  platform: "darwin" | "linux",
  identity: string,
  cwd: string,
): Promise<void> {
  if (platform === "linux") {
    await runner.run(
      "secret-tool",
      [
        "store",
        "--label",
        "OpenBot SOPS identity",
        "service",
        "ai.openbot.sops",
        "account",
        "owner",
      ],
      { cwd, input: identity },
    );
    return;
  }
  await runner.run("/usr/bin/swift", ["-e", macKeychainStoreProgram], { cwd, input: identity });
}

async function loadStoredOwnerMetadata(
  repositoryRoot: string,
  prompts: InitializationPrompts | undefined,
  platform: NodeJS.Platform,
  userConfigurationPath?: string,
): Promise<SopsOwnerIdentityConfiguration> {
  const path = resolveUserConfigurationPath(repositoryRoot, userConfigurationPath);
  const configuration = await readUserConfiguration(path);
  if (configuration?.sops?.ownerIdentity) return configuration.sops.ownerIdentity;

  const creationRule = await readSopsCreationRule(repositoryRoot);
  let ownerIdentity: SopsOwnerIdentityConfiguration;
  if (creationRule.kms) {
    if (!prompts) throw missingUserSopsConfigurationError(path);
    const profile = await prompts.input(
      "AWS profile for SOPS (leave blank to use the default credential chain)",
      { id: "aws-profile" },
    );
    ownerIdentity = { kind: "aws-profile", ...(profile ? { profile } : {}) };
  } else if (creationRule.gcp_kms) {
    ownerIdentity = { kind: "gcp-kms" };
  } else if (creationRule.azure_keyvault) {
    ownerIdentity = { kind: "azure-key-vault" };
  } else if (creationRule.hc_vault_transit_uri) {
    ownerIdentity = { kind: "vault-transit" };
  } else if (creationRule.age) {
    if (!prompts) throw missingUserSopsConfigurationError(path);
    const kind = await prompts.select(
      "Where is this repository's existing SOPS owner age identity stored?",
      [
        {
          value: "onepassword",
          label: "1Password",
          description: "Load the existing identity from a 1Password secret reference.",
        },
        {
          value: "native-age",
          label: "Native keychain",
          description: "Load the existing identity from this computer's keychain.",
        },
      ],
      { id: "existing-owner-identity" },
    );
    if (kind === "onepassword") {
      const reference = await prompts.input("1Password secret reference", {
        id: "onepassword-reference",
        description: "For example: op://Engineering/OpenBot owner identity/password",
        required: true,
      });
      ownerIdentity = { kind: "onepassword", reference };
    } else {
      if (platform !== "darwin" && platform !== "linux")
        throw new Error(`Native keychain age identities are not supported on ${platform}`);
      ownerIdentity = { kind: "native-keychain", platform };
    }
  } else {
    throw new Error("configuration/.sops.yaml does not contain a supported owner identity");
  }

  await storeUserOwnerIdentity(repositoryRoot, ownerIdentity, { path });
  return ownerIdentity;
}

async function readSopsCreationRule(repositoryRoot: string): Promise<SopsCreationRule> {
  const path = resolve(repositoryRoot, "configuration/.sops.yaml");
  const document = parseYaml(await readFile(path, "utf8")) as
    | { creation_rules?: unknown }
    | undefined;
  const rule = Array.isArray(document?.creation_rules) ? document.creation_rules[0] : undefined;
  if (!rule || typeof rule !== "object" || Array.isArray(rule))
    throw new Error("configuration/.sops.yaml does not contain an OpenBot creation rule");
  return rule as SopsCreationRule;
}

function resolveUserConfigurationPath(repositoryRoot: string, explicitPath?: string): string {
  if (explicitPath) return resolve(explicitPath);
  return resolve(repositoryRoot, "local-user-config.json");
}

async function readUserConfiguration(path: string): Promise<UserConfiguration | undefined> {
  if (!(await exists(path))) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`OpenBot user configuration is invalid JSON: ${path}`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`OpenBot user configuration must be a JSON object: ${path}`);
  const configuration = value as Partial<UserConfiguration>;
  if (
    configuration.version !== 1 ||
    (configuration.sops !== undefined &&
      (typeof configuration.sops !== "object" || Array.isArray(configuration.sops)))
  )
    throw new Error(`OpenBot user configuration has an unsupported schema: ${path}`);
  if (
    configuration.sops?.ownerIdentity !== undefined &&
    !isSopsOwnerIdentityConfiguration(configuration.sops.ownerIdentity)
  )
    throw new Error(`OpenBot user SOPS configuration is invalid: ${path}`);
  return configuration as UserConfiguration;
}

function isSopsOwnerIdentityConfiguration(value: unknown): value is SopsOwnerIdentityConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  switch (identity.kind) {
    case "onepassword":
      return typeof identity.reference === "string" && Boolean(identity.reference.trim());
    case "native-keychain":
      return identity.platform === "darwin" || identity.platform === "linux";
    case "aws-profile":
      return identity.profile === undefined || typeof identity.profile === "string";
    case "gcp-kms":
    case "azure-key-vault":
    case "vault-transit":
      return true;
    case "managed-file":
      return typeof identity.path === "string" && identity.path.startsWith("/");
    default:
      return false;
  }
}

async function storeUserOwnerIdentity(
  repositoryRoot: string,
  ownerIdentity: SopsOwnerIdentityConfiguration,
  options: { path?: string } = {},
): Promise<void> {
  const path = resolveUserConfigurationPath(repositoryRoot, options.path);
  const existing = (await readUserConfiguration(path)) ?? { version: 1, sops: {} };
  const configuration: UserConfiguration = {
    ...existing,
    version: 1,
    sops: { ...existing.sops, ownerIdentity },
  };
  await writeFileAtomically(path, `${JSON.stringify(configuration, null, 2)}\n`, 0o600);
}

function missingUserSopsConfigurationError(path: string): Error {
  return new Error(
    `SOPS owner configuration is missing from ${path}. Run this command in an interactive terminal (or run openbot init) to configure the existing owner identity; non-interactive commands cannot choose it safely.`,
  );
}

async function loadStoredOwnerIdentity(
  repositoryRoot: string,
  runner: InitializationCommandRunner,
  platform: NodeJS.Platform,
  metadata: SopsOwnerIdentityConfiguration,
): Promise<string | undefined> {
  if (metadata.kind === "managed-file") return (await readFile(metadata.path, "utf8")).trim();
  if (metadata.kind === "onepassword") {
    return (
      await runner.run("op", ["read", "--no-newline", metadata.reference], {
        cwd: repositoryRoot,
      })
    ).stdout.trim();
  }
  if (metadata.kind !== "native-keychain") return undefined;
  if (metadata.platform !== platform)
    throw new Error(
      `The configured SOPS identity belongs to ${metadata.platform}, not ${platform}`,
    );
  if (platform === "linux") {
    return (
      await runner.run(
        "secret-tool",
        ["lookup", "service", "ai.openbot.sops", "account", "owner"],
        { cwd: repositoryRoot },
      )
    ).stdout.trim();
  }
  return (
    await runner.run(
      "security",
      ["find-generic-password", "-w", "-s", "ai.openbot.sops", "-a", "owner"],
      { cwd: repositoryRoot },
    )
  ).stdout.trim();
}

async function sopsCommandEnvironment(
  repositoryRoot: string,
  runner: InitializationCommandRunner,
  options: {
    environment: NodeJS.ProcessEnv;
    platform: NodeJS.Platform;
    prompts?: InitializationPrompts;
    userConfigurationPath?: string;
  },
): Promise<NodeJS.ProcessEnv> {
  const hasAgeIdentity = Boolean(
    options.environment.SOPS_AGE_KEY ||
    options.environment.SOPS_AGE_KEY_FILE ||
    options.environment.SOPS_AGE_KEY_CMD,
  );
  // An explicitly provided age identity decrypts on its own; skip owner-identity resolution
  // even when KMS recipients exist, since SOPS needs only one successful key group.
  if (hasAgeIdentity) return { ...options.environment };
  const metadata = await loadStoredOwnerMetadata(
    repositoryRoot,
    options.prompts,
    options.platform,
    options.userConfigurationPath,
  );
  const commandEnvironment =
    metadata.kind === "aws-profile" && metadata.profile
      ? await awsProfileEnvironment(runner, metadata.profile, repositoryRoot, options.environment)
      : { ...options.environment };
  if (!commandEnvironment.SOPS_AGE_KEY) {
    const ownerIdentity = await loadStoredOwnerIdentity(
      repositoryRoot,
      runner,
      options.platform,
      metadata,
    );
    if (ownerIdentity) commandEnvironment.SOPS_AGE_KEY = ownerIdentity;
  }
  return commandEnvironment;
}

function validateSecretName(name: string): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Invalid secret name: ${name}`);
}

function parseSecretsDocument(value: unknown): {
  sandboxAgeIdentity: string;
  secrets: Record<string, string>;
} {
  const describedSecrets = parseDescribedSecretsDocument(value);
  const secrets: Record<string, string> = {};
  let sandboxAgeIdentity: string | undefined;
  for (const [storedName, described] of Object.entries(describedSecrets)) {
    if (storedName === SECRETS_SOPS_AGE_SECRET) {
      if (!described.value.startsWith("AGE-SECRET-KEY-1"))
        throw new Error(`${SECRETS_SOPS_AGE_SECRET} is not a valid age identity`);
      sandboxAgeIdentity = described.value;
    } else {
      secrets[runtimeSecretName(storedName)] = described.value;
    }
  }
  if (!sandboxAgeIdentity)
    throw new Error(`Encrypted configuration is missing ${SECRETS_SOPS_AGE_SECRET}`);
  return { sandboxAgeIdentity, secrets };
}

function parseDescribedSecretsDocument(value: unknown): Record<string, DescribedValue> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid encrypted OpenBot secrets document");
  const root = value as Record<string, unknown>;
  const result: Record<string, DescribedValue> = {};
  for (const [storedName, entry] of Object.entries(root)) {
    if (storedName === "sops") continue;
    validateSecretName(storedName);
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`Encrypted secret ${storedName} must contain description and value`);
    const described = entry as Record<string, unknown>;
    if (
      typeof described.description !== "string" ||
      !described.description.trim() ||
      typeof described.value !== "string" ||
      !described.value
    )
      throw new Error(`Invalid encrypted secret: ${storedName}`);
    result[storedName] = {
      description: described.description,
      value: described.value,
    };
  }
  return result;
}

function sopsEncryptionArguments(rule: SopsCreationRule): string[] {
  const flags: Record<string, string> = {
    age: "--age",
    kms: "--kms",
    gcp_kms: "--gcp-kms",
    azure_keyvault: "--azure-kv",
    hc_vault_transit_uri: "--hc-vault-transit",
    encrypted_regex: "--encrypted-regex",
  };
  const arguments_: string[] = [];
  for (const [name, value] of Object.entries(rule)) {
    const flag = flags[name];
    if (!flag) continue;
    arguments_.push(flag, typeof value === "string" ? value : value.join(","));
  }
  return arguments_;
}

async function sopsEncryptionEnvironment(
  runner: InitializationCommandRunner,
  metadata: SopsOwnerIdentityConfiguration,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  if (metadata.kind === "managed-file")
    return { ...environment, SOPS_AGE_KEY: (await readFile(metadata.path, "utf8")).trim() };
  if (metadata.kind !== "aws-profile" || !metadata.profile) return environment;
  return awsProfileEnvironment(runner, metadata.profile, cwd, environment);
}

async function awsProfileEnvironment(
  runner: InitializationCommandRunner,
  profile: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  let exported: CommandResult;
  try {
    exported = await runner.run(
      "aws",
      ["configure", "export-credentials", "--profile", profile, "--format", "process"],
      { cwd, environment },
    );
  } catch (error) {
    throw new Error(
      `AWS profile credential export failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  let credentials: unknown;
  try {
    credentials = JSON.parse(exported.stdout);
  } catch {
    throw new Error("AWS profile credential export returned invalid JSON");
  }
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials))
    throw new Error("AWS profile credential export returned an invalid document");
  const values = credentials as Record<string, unknown>;
  if (typeof values.AccessKeyId !== "string" || typeof values.SecretAccessKey !== "string")
    throw new Error("AWS profile credential export returned incomplete credentials");

  const commandEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    AWS_ACCESS_KEY_ID: values.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: values.SecretAccessKey,
  };
  // Static credentials must be the only selected AWS source. Some AWS SDKs,
  // including the version embedded in older SOPS releases, prefer a named SSO
  // profile even when fresher exported credentials are present.
  delete commandEnvironment.AWS_PROFILE;
  delete commandEnvironment.AWS_DEFAULT_PROFILE;
  delete commandEnvironment.AWS_SESSION_TOKEN;
  delete commandEnvironment.AWS_SECURITY_TOKEN;
  if (typeof values.SessionToken === "string")
    commandEnvironment.AWS_SESSION_TOKEN = values.SessionToken;
  return commandEnvironment;
}

async function assertSopsEncryptionWorks(
  runner: InitializationCommandRunner,
  creationRule: SopsCreationRule,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const proofValue = randomBytes(16).toString("hex");
  const proof = stringifyYaml({
    SOPS_TEST: { description: "SOPS encryption test.", value: proofValue },
  });
  const arguments_ = [
    "encrypt",
    ...sopsEncryptionArguments(creationRule),
    "--input-type",
    "yaml",
    "--output-type",
    "yaml",
  ];
  let encrypted: CommandResult;
  try {
    encrypted = runner.runWithInputFile
      ? await runner.runWithInputFile("sops", arguments_, {
          cwd,
          environment,
          input: proof,
        })
      : await runner.run("sops", arguments_, {
          cwd,
          environment,
          input: proof,
        });
  } catch (error) {
    throw new Error(
      `SOPS encryption test failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const encryptedDocument = parseYaml(encrypted.stdout) as { sops?: unknown } | undefined;
  if (!encryptedDocument?.sops || encrypted.stdout.includes(proofValue))
    throw new Error("SOPS encryption test failed: SOPS returned an invalid encrypted document");
}

async function readEnvironmentFile(path: string): Promise<Record<string, string>> {
  try {
    const parsed = parseDotenv(await readFile(path, "utf8"));
    for (const name of Object.keys(parsed))
      if (!/^[A-Z][A-Z0-9_]*$/.test(name))
        throw new Error(`Invalid configuration environment variable: ${name}`);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function createBlankEnvironment(path: string): Promise<void> {
  try {
    await materializeFileTemplate(fileTemplates.empty, path, {}, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function createConfiguration(
  path: string,
  asset: string,
  values: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  try {
    await materializeFileTemplate(asset, path, values, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export async function selectInitializationProviders(
  path: string,
  prompts: InitializationPrompts,
  environment?: NodeJS.ProcessEnv,
  onSelected?: InitializationProviderStageHandler,
): Promise<InitializationProviderSelection> {
  if (await exists(path)) {
    const module = await importConfiguredOpenBot(
      path,
      initializationDiscoveryEnvironment(environment ?? process.env),
    );
    if (!module.default)
      throw new Error("configuration/index.ts must export the OpenBot configuration as default");
    const currentGroups = configuredInitializationProviderGroups(module.default);
    const currentProviders = [
      ...currentGroups.runtime,
      ...currentGroups.inference,
      ...currentGroups.shared,
    ];
    const currentRuntime = configuredRuntimeChoice(module.default);
    const currentInference = configuredInferenceChoice(module.default);
    const runtime = await selectProviderChoice(
      prompts,
      "Where should OpenBot run?",
      "runtime",
      runtimeChoices,
      currentRuntime,
      "Current custom runtime providers",
    );
    const runtimeChanged = runtime !== (currentRuntime ?? "current");
    if (runtimeChanged) {
      if (runtime === "current" || !currentRuntime || !currentInference)
        throw new Error(
          "OpenBot cannot automatically rewrite a custom provider composition. Keep the current selections or edit configuration/index.ts explicitly.",
        );
      await assertCanonicalBuiltInConfiguration(path, currentRuntime, currentInference);
    }
    const runtimeProviders =
      runtime === "current" || runtime === currentRuntime
        ? currentGroups.runtime
        : builtInRuntimeProviderGroup(runtime);
    await onSelected?.({ domain: "runtime", providers: runtimeProviders });

    const inference = await selectProviderChoice(
      prompts,
      "How should OpenBot run inference?",
      "inference",
      inferenceChoices,
      currentInference,
      "Current custom inference provider",
    );
    const inferenceChanged = inference !== (currentInference ?? "current");
    if (inferenceChanged) {
      if (inference === "current" || !currentRuntime || !currentInference)
        throw new Error(
          "OpenBot cannot automatically rewrite a custom provider composition. Keep the current selections or edit configuration/index.ts explicitly.",
        );
      if (!runtimeChanged)
        await assertCanonicalBuiltInConfiguration(path, currentRuntime, currentInference);
    }
    const inferenceProviders =
      inference === "current" || inference === currentInference
        ? currentGroups.inference
        : [inferenceProvider(inference, runtime === "current" ? currentRuntime : runtime)];
    await onSelected?.({
      domain: "inference",
      providers: inferenceProviders,
      inference,
      previousInference: currentInference,
    });

    if (runtime === (currentRuntime ?? "current") && inference === (currentInference ?? "current"))
      return {
        providers: currentProviders,
        runtime,
        inference,
        previousInference: currentInference,
      };
    if (runtime === "current" || inference === "current")
      throw new Error(
        "OpenBot cannot automatically rewrite a custom provider composition. Keep the current selections or edit configuration/index.ts explicitly.",
      );
    return {
      providers: [
        ...runtimeProviders,
        ...inferenceProviders,
        ...builtInSharedProviderGroup(runtime),
      ],
      runtime,
      inference,
      previousInference: currentInference,
      configurationSource: await renderBuiltInConfiguration(runtime, inference),
    };
  }
  const runtime = await prompts.select("Where do you want to deploy OpenBot?", runtimeChoices, {
    id: "runtime",
    initialValue: "vercel",
  });
  if (runtime !== "local" && runtime !== "vercel" && runtime !== "tilde-cloud")
    throw new Error(`Unsupported runtime provider: ${runtime}`);
  const runtimeProviders = builtInRuntimeProviderGroup(runtime);
  await onSelected?.({ domain: "runtime", providers: runtimeProviders });
  const inference = await prompts.select(
    "How should OpenBot run inference?",
    inferenceChoicesForRuntime(runtime),
    {
      id: "inference",
      initialValue: "vercel",
    },
  );
  if (inference !== "vercel" && inference !== "codex")
    throw new Error(`Unsupported inference provider: ${inference}`);
  const inferenceProviders = [inferenceProvider(inference, runtime)];
  await onSelected?.({ domain: "inference", providers: inferenceProviders, inference });
  return {
    providers: [...runtimeProviders, ...inferenceProviders, ...builtInSharedProviderGroup(runtime)],
    runtime,
    inference,
    configurationSource: await renderBuiltInConfiguration(runtime, inference),
  };
}

async function assertCanonicalBuiltInConfiguration(
  path: string,
  runtime: RuntimeChoice,
  inference: InferenceChoice,
): Promise<void> {
  const currentSource = await readFile(path, "utf8");
  const canonicalCurrent = await renderBuiltInConfiguration(runtime, inference);
  if (currentSource.trimEnd() !== canonicalCurrent.trimEnd())
    throw new Error(
      "configuration/index.ts contains fork-owned changes. Keep the current providers or update the composition explicitly so init does not overwrite those changes.",
    );
}

async function selectProviderChoice<T extends string>(
  prompts: InitializationPrompts,
  prompt: string,
  id: string,
  choices: readonly SelectChoice[],
  current: T | undefined,
  customLabel: string,
): Promise<T | "current"> {
  const offeredChoices = current
    ? choices
    : [
        {
          value: "current",
          label: customLabel,
          description:
            "Preserve the provider composition already authored in configuration/index.ts.",
        },
        ...choices,
      ];
  const selected = await prompts.select(prompt, offeredChoices, {
    id,
    initialValue: current ?? "current",
  });
  if (selected === "current") return selected;
  if (!choices.some((choice) => choice.value === selected))
    throw new Error(`Unsupported ${id} provider: ${selected}`);
  return selected as T;
}

async function renderBuiltInConfiguration(
  runtime: RuntimeChoice,
  inference: InferenceChoice,
): Promise<string> {
  const asset =
    runtime === "local"
      ? configurationAssets.local
      : runtime === "tilde-cloud"
        ? configurationAssets.tildeCloud
        : configurationAssets.vercel;
  return renderFileTemplatePath(asset, { CODEX_INFERENCE: inference === "codex" });
}

function initializationDiscoveryEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...environment };
  const selections = [
    builtInRuntimeInitializationProviders("local", "vercel"),
    builtInRuntimeInitializationProviders("local", "codex"),
    builtInRuntimeInitializationProviders("vercel", "vercel"),
    builtInRuntimeInitializationProviders("vercel", "codex"),
    builtInRuntimeInitializationProviders("tilde-cloud", "vercel"),
  ];
  for (const providers of selections) {
    for (const initialization of collectProviderInitializations(providers)) {
      for (const question of initialization.questions) {
        result[question.destination.key] ??= `openbot-initialization-${question.id}`;
      }
    }
  }
  return result;
}

async function importConfiguredOpenBot(
  path: string,
  environment: NodeJS.ProcessEnv,
): Promise<{ default?: OpenBotConfiguration }> {
  return loadConfigurationModule(path, environment);
}

export function builtInRuntimeInitializationProviders(
  runtime: RuntimeChoice,
  inference: "vercel" | "codex" = "vercel",
): readonly InitializableProvider[] {
  return [
    ...builtInRuntimeProviderGroup(runtime),
    inferenceProvider(inference, runtime),
    ...builtInSharedProviderGroup(runtime),
  ];
}

function builtInRuntimeProviderGroup(runtime: RuntimeChoice): InitializableProvider[] {
  const vercel = new VercelPlatform({ managed: runtime === "tilde-cloud" });
  return runtime === "local"
    ? [new LocalRuntimeServiceProvider(), new MicrosandboxComputerProvider()]
    : [
        new VercelRuntimeServiceProvider({ platform: vercel }),
        new VercelSandboxComputerProvider({ platform: vercel, projectRole: "runtime" }),
      ];
}

function builtInSharedProviderGroup(runtime: RuntimeChoice | "current"): InitializableProvider[] {
  return [
    new TildeAuthProvider(tildePlatform),
    {
      platforms: [tildePlatform],
      initialization: tildeAgentProviderInitialization,
    },
    runtime === "tilde-cloud" ? new LocalGitProvider() : new GitHubGitProvider(tildePlatform),
  ];
}

function inferenceProvider(
  inference: InferenceChoice,
  runtime: RuntimeChoice | undefined,
): InferenceProvider {
  if (inference === "codex") return new CodexInferenceProvider();
  return new VercelInferenceProvider(
    runtime === "tilde-cloud" ? new VercelPlatform({ managed: true }) : undefined,
  );
}

function inferenceTemplateFiles(providers: readonly InitializableProvider[]) {
  const contributions = providers.flatMap((provider) => {
    if (!("agentTemplate" in provider)) return [];
    const template = (provider as Partial<InferenceProvider>).agentTemplate;
    return template ? [template] : [];
  });
  if (contributions.length > 1)
    throw new Error(
      `OpenBot supports one inference agent template contribution; found ${contributions.length}`,
    );
  return contributions[0]?.files ?? [];
}

interface FileReplacement {
  path: string;
  contents?: string;
}

export async function prepareInferenceTemplateMigration(
  repositoryRoot: string,
  previousFiles: readonly InferenceAgentTemplateFile[],
  nextFiles: readonly InferenceAgentTemplateFile[],
  environment: NodeJS.ProcessEnv,
): Promise<FileReplacement[]> {
  const previous = inferenceTemplateMap(previousFiles);
  const next = inferenceTemplateMap(nextFiles);
  const paths = [...new Set([...previous.keys(), ...next.keys()])].sort();
  const agents = await discoverAgents(repositoryRoot);
  const replacements: FileReplacement[] = [];

  for (const relativePath of paths) {
    const previousFile = previous.get(relativePath);
    const nextFile = next.get(relativePath);
    const templatePath = resolve(repositoryRoot, agentTemplateDirectory, relativePath);
    await prepareFileReplacement(
      templatePath,
      previousFile ? await readFile(previousFile.source, "utf8") : undefined,
      nextFile ? await readFile(nextFile.source, "utf8") : undefined,
      replacements,
    );

    const outputPath = relativePath.slice(0, -".hbs".length);
    for (const agent of agents) {
      const nameKey = `AGENT_${agent.slug.replaceAll("-", "_").toUpperCase()}_NAME`;
      const name =
        environment[nameKey]?.trim() || (agent.kind === "primary" ? "Factory" : agent.slug);
      const values = {
        AGENT_ID: agent.slug,
        AGENT_ID_JSON: JSON.stringify(agent.slug),
        AGENT_NAME: name,
        AGENT_NAME_JSON: JSON.stringify(name),
        AGENT_ENV_PREFIX: agent.slug.replaceAll("-", "_").toUpperCase(),
      };
      await prepareFileReplacement(
        resolve(agent.directory, outputPath),
        previousFile ? await renderFileTemplatePath(previousFile.source, values) : undefined,
        nextFile ? await renderFileTemplatePath(nextFile.source, values) : undefined,
        replacements,
      );
    }
  }
  return replacements;
}

function inferenceTemplateMap(files: readonly InferenceAgentTemplateFile[]) {
  const result = new Map<string, (typeof files)[number]>();
  for (const file of files) {
    if (
      !file.path.endsWith(".hbs") ||
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path.split("/").some((segment) => !segment || segment === "." || segment === "..")
    )
      throw new Error(`Invalid inference agent template path: ${file.path}`);
    if (result.has(file.path))
      throw new Error(`Duplicate inference agent template path: ${file.path}`);
    result.set(file.path, file);
  }
  return result;
}

async function prepareFileReplacement(
  path: string,
  expected: string | undefined,
  replacement: string | undefined,
  result: FileReplacement[],
): Promise<void> {
  const current = await readOptionalFile(path);
  if (expected === undefined ? current !== undefined : current !== expected)
    throw new Error(
      `Cannot switch inference providers because ${path} contains fork-owned changes. Preserve those changes with an explicit migration first.`,
    );
  result.push({ path, ...(replacement === undefined ? {} : { contents: replacement }) });
}

export async function applyFileReplacements(
  replacements: readonly FileReplacement[],
): Promise<void> {
  for (const replacement of replacements) {
    if (replacement.contents === undefined) {
      await rm(replacement.path, { force: true });
      continue;
    }
    await writeFileAtomically(replacement.path, replacement.contents, 0o600);
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function runInitializationProvisioning(
  providers: readonly InitializableProvider[],
  repositoryRoot: string,
  values: {
    baseEnvironment: NodeJS.ProcessEnv;
    environmentValues: Record<string, DescribedValue>;
    secretValues: Record<string, DescribedValue>;
    environmentUpdates?: Record<string, DescribedValue>;
    request?: typeof fetch;
    interactive?: boolean;
    report?: InitializationEventReporter;
  },
): Promise<void> {
  const environment = {
    ...values.baseEnvironment,
    ...Object.fromEntries(
      Object.entries(values.environmentValues).map(([name, described]) => [name, described.value]),
    ),
    ...Object.fromEntries(
      Object.entries(values.secretValues).map(([name, described]) => [
        runtimeSecretName(name),
        described.value,
      ]),
    ),
  };
  await initializeProviders(providers, {
    repositoryRoot,
    environment,
    request: values.request,
    interactive: values.interactive === true,
    report: values.report ?? plainInitializationReporter,
    async setEnvironment(name, value, description) {
      const described = { description, value };
      values.environmentValues[name] = described;
      if (values.environmentUpdates) values.environmentUpdates[name] = described;
      environment[name] = value;
    },
    async setSecret(name, value, description) {
      values.secretValues[repositorySecretName(name)] = { description, value };
      environment[name] = value;
    },
  });
}

async function configureInitializationStage(
  providers: readonly InitializableProvider[],
  repositoryRoot: string,
  state: InitializationStageState,
  values: Parameters<typeof runInitializationProvisioning>[2],
  ask: (question: ProviderInitializationQuestion) => Promise<void>,
): Promise<void> {
  const initializations = collectProviderInitializations(providers);
  for (const initialization of initializations) {
    const previous = state.initializations.get(initialization.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(initialization))
      throw new Error(
        `Providers define conflicting initialization dependency: ${initialization.id}`,
      );
    state.initializations.set(initialization.id, initialization);
  }

  for (const question of uniqueInitializationQuestions(
    initializations.flatMap((initialization) => initialization.questions),
  )) {
    const key = `${question.destination.kind}:${question.destination.key}`;
    const previous = state.questions.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(question))
      throw new Error(
        `Providers define conflicting initialization questions for ${question.destination.key}`,
      );
    if (previous) continue;
    state.questions.set(key, question);
    await ask(question);
  }

  const pending = providers.filter((provider) => {
    if (!provider.initialize) return true;
    const id = provider.initialization?.id;
    if (!id) throw new Error("Provider initializers require stable initialization metadata");
    return !state.initializedProviders.has(id);
  });
  await runInitializationProvisioning(pending, repositoryRoot, values);
  for (const provider of pending) {
    if (provider.initialize && provider.initialization)
      state.initializedProviders.add(provider.initialization.id);
  }
}

function createInitializationStageState(): InitializationStageState {
  return {
    initializations: new Map(),
    questions: new Map(),
    initializedProviders: new Set(),
  };
}

/** Plain standard-output rendering of provider provisioning events. */
export function plainInitializationReporter({
  event,
  details = {},
}: {
  event: string;
  details?: Readonly<Record<string, unknown>>;
}): void {
  if (event === "git.github.authorization.required") {
    const url = typeof details.url === "string" ? details.url : undefined;
    const hint = typeof details.hint === "string" ? details.hint : "";
    const instructions = typeof details.instructions === "string" ? details.instructions : "";
    process.stdout.write(
      `\nGitHub authorization required. Open this link to create and install the GitHub App:\n${
        url ? `  ${url}\n` : ""
      }${instructions ? `${instructions}\n` : ""}${hint ? `${hint}\n` : ""}`,
    );
    return;
  }
  if (event === "git.github.authorization.waiting") {
    process.stdout.write("Waiting for the GitHub App authorization to complete…\n");
    return;
  }
  if (event === "git.github.authorized") {
    process.stdout.write("GitHub App connected.\n");
    return;
  }
  process.stdout.write(
    `${event}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}\n`,
  );
}

function uniqueInitializationQuestions(
  questions: readonly ProviderInitializationQuestion[],
): ProviderInitializationQuestion[] {
  const result = new Map<string, ProviderInitializationQuestion>();
  for (const question of questions) {
    const key = `${question.destination.kind}:${question.destination.key}`;
    const previous = result.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(question)) {
      throw new Error(
        `Providers define conflicting initialization questions for ${question.destination.key}`,
      );
    }
    result.set(key, question);
  }
  return [...result.values()];
}

function configuredInitializationProviderGroups(configuration: OpenBotConfiguration): {
  runtime: InitializableProvider[];
  inference: InitializableProvider[];
  shared: InitializableProvider[];
} {
  const compatible = (provider: InitializableProvider | undefined) =>
    provider ? [compatibleInitializationProvider(provider)] : [];
  return {
    runtime: [
      ...compatible(configuration.providers.controlService),
      ...compatible(configuration.providers.agentService),
      ...compatible(configuration.providers.computer),
    ],
    inference: compatible(configuration.providers.inference),
    shared: [
      ...compatible(configuration.providers.auth),
      ...compatible(configuration.providers.agent),
      ...compatible(configuration.providers.git),
    ],
  };
}

export function configuredRuntimeChoice(
  configuration: OpenBotConfiguration,
): RuntimeChoice | undefined {
  if (configuration.providers.controlService !== configuration.providers.agentService)
    return undefined;
  const constructors = [
    constructorName(configuration.providers.controlService),
    constructorName(configuration.providers.agentService),
    constructorName(configuration.providers.computer),
  ];
  if (
    constructors[0] === "LocalRuntimeServiceProvider" &&
    constructors[1] === "LocalRuntimeServiceProvider" &&
    constructors[2] === "MicrosandboxComputerProvider"
  )
    return "local";
  if (
    constructors[0] === "VercelRuntimeServiceProvider" &&
    constructors[1] === "VercelRuntimeServiceProvider" &&
    constructors[2] === "VercelSandboxComputerProvider"
  )
    return constructorName(configuration.providers.git) === "LocalGitProvider"
      ? "tilde-cloud"
      : "vercel";
  return undefined;
}

function configuredInferenceChoice(
  configuration: OpenBotConfiguration,
): InferenceChoice | undefined {
  switch (constructorName(configuration.providers.inference)) {
    case "VercelInferenceProvider":
      return "vercel";
    case "CodexInferenceProvider":
      return "codex";
    default:
      return undefined;
  }
}

function compatibleInitializationProvider(provider: InitializableProvider): InitializableProvider {
  if (provider.platforms?.length) return provider;

  switch (constructorName(provider)) {
    case "VercelRuntimeServiceProvider":
      return new VercelRuntimeServiceProvider();
    case "VercelSandboxComputerProvider":
      return new VercelSandboxComputerProvider();
    case "TildeAgentProvider":
      return { platforms: [tildePlatform] };
    default:
      return provider;
  }
}

function constructorName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const provider = value as InitializableProvider;
  return provider.constructor?.name;
}

async function updateEnvironmentFile(
  path: string,
  values: Readonly<Record<string, DescribedValue>>,
): Promise<void> {
  let contents = await readFile(path, "utf8");
  for (const [name, described] of Object.entries(values)) {
    const line = (
      await renderFileTemplatePath(fileTemplates.environmentEntry, {
        NAME: name,
        DESCRIPTION: described.description,
        VALUE: JSON.stringify(described.value),
      })
    ).trimEnd();
    const pattern = new RegExp(`(?:^# [^\\n]*\\n)?^${name}=.*$`, "m");
    contents = pattern.test(contents)
      ? contents.replace(pattern, line)
      : `${contents}${contents && !contents.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  await writeFileAtomically(path, contents, 0o600);
}

async function reconcileEnvironmentFile(
  path: string,
  values: Readonly<Record<string, DescribedValue>>,
  removedNames: ReadonlySet<string>,
): Promise<void> {
  let contents = await readFile(path, "utf8");
  for (const name of removedNames) {
    validateSecretName(name);
    const pattern = new RegExp(`(?:^# [^\\n]*\\n)?^${name}=.*(?:\\n|$)`, "m");
    contents = contents.replace(pattern, "");
  }
  await writeFileAtomically(path, contents, 0o600);
  await updateEnvironmentFile(path, values);
}

function repositorySecretName(name: string): string {
  return name === COMPUTER_SERVICE_ENVIRONMENT ? COMPUTER_SERVICE_SECRET : name;
}

function runtimeSecretName(name: string): string {
  return name === COMPUTER_SERVICE_SECRET ? COMPUTER_SERVICE_ENVIRONMENT : name;
}

function requireDescription(description: string): string {
  const selected = description.trim();
  if (!selected) throw new Error("Description must not be empty");
  if (/\r|\n/.test(selected)) throw new Error("Description must be a single line");
  return selected;
}

async function renderDocument(contents: string): Promise<string> {
  return renderFileTemplatePath(fileTemplates.document, { CONTENTS: contents.replace(/\n+$/, "") });
}

async function writeFileAtomically(path: string, contents: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const words = convertBits(bytes, 8, 5);
  const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, index) => (polymod >>> (5 * (5 - index))) & 31);
  return `${hrp}1${[...words, ...checksum].map((value) => alphabet[value]).join("")}`;
}

function convertBits(data: Uint8Array, from: number, to: number): number[] {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  for (const value of data) {
    accumulator = (accumulator << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      result.push((accumulator >>> bits) & ((1 << to) - 1));
    }
  }
  if (bits) result.push((accumulator << (to - bits)) & ((1 << to) - 1));
  return result;
}

function hrpExpand(hrp: string): number[] {
  return Array.from(hrp)
    .map((character) => character.charCodeAt(0) >>> 5)
    .concat(
      [0],
      Array.from(hrp).map((character) => character.charCodeAt(0) & 31),
    );
}

function bech32Polymod(values: readonly number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < generators.length; index += 1)
      if ((top >>> index) & 1) checksum ^= generators[index]!;
  }
  return checksum;
}

const macKeychainStoreProgram = `
import Foundation
import Security
let data = FileHandle.standardInput.readDataToEndOfFile()
let deleteQuery: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "ai.openbot.sops", kSecAttrAccount as String: "owner"]
SecItemDelete(deleteQuery as CFDictionary)
var addQuery = deleteQuery
addQuery[kSecValueData as String] = data
let status = SecItemAdd(addQuery as CFDictionary, nil)
if status != errSecSuccess { fputs("Keychain error: \\(status)\\n", stderr); exit(1) }
`;

export const processCommandRunner: InitializationCommandRunner = {
  run(command, args, options = {}) {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.environment ?? process.env,
        stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      if (options.input !== undefined) child.stdin?.end(options.input);
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolvePromise({ stdout, stderr })
          : reject(
              new Error(
                `${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}${stderr ? `: ${stderr.trim()}` : ""}`,
              ),
            ),
      );
    });
  },
  async runWithInputFile(command, args, options) {
    const directory = await mkdtemp(resolve(tmpdir(), "openbot-sops-"));
    const pipe = resolve(directory, "input");
    try {
      await processCommandRunner.run("mkfifo", [pipe], {
        cwd: options.cwd,
        environment: options.environment,
      });
      const processResult = processCommandRunner.run(command, [...args, pipe], {
        cwd: options.cwd,
        environment: options.environment,
      });
      await writeFile(pipe, options.input, "utf8");
      return await processResult;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
};
