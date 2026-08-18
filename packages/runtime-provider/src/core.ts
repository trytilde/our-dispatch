export interface DeploymentEvent {
  event: string;
  details?: Readonly<Record<string, unknown>>;
}

export type DeploymentReporter = (event: DeploymentEvent) => void;

export interface DeploymentResult {
  outputs?: Readonly<Record<string, string>>;
}

/** In-memory handoff for non-secret lifecycle artifacts and resource identifiers. */
export class DeploymentOutputs {
  readonly #outputs = new Map<string, string>();

  merge(result: DeploymentResult | void): void {
    for (const [name, value] of Object.entries(result?.outputs ?? {})) {
      if (!name || !value) throw new Error("Deployment output names and values must not be empty");
      const existing = this.#outputs.get(name);
      if (existing !== undefined && existing !== value)
        throw new Error(`Conflicting deployment output: ${name}`);
      this.#outputs.set(name, value);
    }
  }

  get(name: string): string | undefined {
    return this.#outputs.get(name);
  }

  require(name: string): string {
    const value = this.get(name);
    if (!value) throw new Error(`Required deployment output is unavailable: ${name}`);
    return value;
  }

  outputs(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.#outputs);
  }

  result(): DeploymentResult {
    return { outputs: this.outputs() };
  }
}

/** A provider-owned, idempotent software artifact lifecycle. */
export interface Buildable {
  check(context: DeploymentContext): Promise<void>;
  build(context: DeploymentContext): Promise<DeploymentResult | void>;
  /** Source paths whose changes require this development artifact to be rebuilt. */
  watchPaths?(context: DeploymentContext): Promise<readonly string[]>;
}

export type InitializationValueDestination = "environment" | "secret";

export interface ProviderInitializationQuestion {
  id: string;
  prompt: string;
  description?: string;
  /** Value offered when the repository has not persisted an answer yet. */
  defaultValue?: string;
  input: "text" | "secret" | "select";
  required?: boolean;
  choices?: readonly { value: string; label: string; description?: string }[];
  destination: {
    kind: InitializationValueDestination;
    key: string;
  };
  validation?: {
    pattern: string;
    message: string;
  };
}

/** Serializable provider onboarding metadata. Renderers remain CLI/browser agnostic. */
export interface ProviderInitialization {
  id: string;
  label: string;
  description?: string;
  questions: readonly ProviderInitializationQuestion[];
}

export interface ProviderInitializationContext {
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  request?: typeof fetch;
  /** Whether an owner is present at an interactive terminal to complete pending actions. */
  interactive?: boolean;
  /** Owner-visible progress and pending-action events, such as an authorization URL. */
  report?: DeploymentReporter;
  setEnvironment(name: string, value: string, description: string): Promise<void>;
  setSecret(name: string, value: string, description: string): Promise<void>;
}

/** Provider-owned provisioning that runs after initialization questions are collected. */
export interface ProviderInitializer {
  initialize(context: ProviderInitializationContext): Promise<void>;
}

/** An external platform shared by one or more domain providers. */
export interface Platform {
  readonly id: string;
  readonly initialization: ProviderInitialization;
}

export interface InitializableProvider {
  readonly initialization?: ProviderInitialization;
  /** Shared external platforms required before this provider can be configured. */
  readonly platforms?: readonly Platform[];
  /** Idempotently provision values or resources required by this provider. */
  initialize?(context: ProviderInitializationContext): Promise<void>;
}

/** Collect provider-owned setup and shared platform dependencies once by stable ID. */
export function collectProviderInitializations(
  providers: readonly InitializableProvider[],
): ProviderInitialization[] {
  const result = new Map<string, ProviderInitialization>();
  for (const provider of providers) {
    const initializations = [
      ...(provider.platforms ?? []).map((platform) => {
        if (platform.id !== platform.initialization.id)
          throw new Error(`Platform ${platform.id} has mismatched initialization metadata`);
        return platform.initialization;
      }),
      ...(provider.initialization ? [provider.initialization] : []),
    ];
    for (const initialization of initializations) {
      const previous = result.get(initialization.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(initialization)) {
        throw new Error(
          `Providers define conflicting initialization dependency: ${initialization.id}`,
        );
      }
      result.set(initialization.id, initialization);
    }
  }
  return [...result.values()];
}

/** Run provider-owned initialization provisioning once per stable initialization ID. */
export async function initializeProviders(
  providers: readonly InitializableProvider[],
  context: ProviderInitializationContext,
): Promise<void> {
  const initialized = new Set<string>();
  for (const provider of providers) {
    if (!provider.initialize) continue;
    const id = provider.initialization?.id;
    if (!id) throw new Error("Provider initializers require stable initialization metadata");
    if (initialized.has(id)) continue;
    await runProviderLifecycleHook(
      provider,
      providerTypeForImplementation(provider),
      "initialize",
      () => provider.initialize!(context),
    );
    initialized.add(id);
  }
}

export interface DeploymentPersistence {
  setEnvironment(name: string, value: string, description: string): Promise<void>;
  setSecret(name: string, value: string, description: string): Promise<void>;
  unsetEnvironment(name: string): Promise<void>;
  unsetSecret(name: string): Promise<void>;
}

const noPersistence: DeploymentPersistence = {
  setEnvironment: async () => undefined,
  setSecret: async () => undefined,
  unsetEnvironment: async () => undefined,
  unsetSecret: async () => undefined,
};

export interface DeploymentContext {
  /** Whether this lifecycle is preparing the watched local development environment. */
  devMode: boolean;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  /** Values loaded from repository configuration, excluding the inherited host environment. */
  configuration?: NodeJS.ProcessEnv;
  persistence?: DeploymentPersistence;
  inputs: DeploymentOutputs;
  agentId?: string;
  agentPath?: string;
  /** Whether the agent under reconciliation is the primary agent or a subagent. */
  agentKind?: "primary" | "subagent";
  agentServiceOrigin?: string;
  /** External platforms selected by the repository composition for this lifecycle. */
  platformIds?: readonly string[];
  report: DeploymentReporter;
}

export function isDevelopmentLifecycle(context: Pick<DeploymentContext, "devMode">): boolean {
  return context.devMode;
}

export async function persistEnvironment(
  context: DeploymentContext,
  name: string,
  value: string,
  description: string,
): Promise<void> {
  validateEnvironmentName(name);
  if (!value) throw new Error(`Environment value must not be empty: ${name}`);
  if (context.environment[name] !== value)
    await (context.persistence ?? noPersistence).setEnvironment(name, value, description);
  context.environment[name] = value;
  if (context.configuration) context.configuration[name] = value;
}

export async function persistSecret(
  context: DeploymentContext,
  name: string,
  value: string,
  description: string,
): Promise<void> {
  validateEnvironmentName(name);
  if (!value) throw new Error(`Secret value must not be empty: ${name}`);
  if (context.environment[name] !== value)
    await (context.persistence ?? noPersistence).setSecret(name, value, description);
  context.environment[name] = value;
  if (context.configuration) context.configuration[name] = value;
}

export async function unsetEnvironment(context: DeploymentContext, name: string): Promise<void> {
  validateEnvironmentName(name);
  if (context.environment[name] !== undefined)
    await (context.persistence ?? noPersistence).unsetEnvironment(name);
  delete context.environment[name];
  if (context.configuration) delete context.configuration[name];
}

export async function unsetSecret(context: DeploymentContext, name: string): Promise<void> {
  validateEnvironmentName(name);
  if (context.environment[name] !== undefined)
    await (context.persistence ?? noPersistence).unsetSecret(name);
  delete context.environment[name];
  if (context.configuration) delete context.configuration[name];
}

function validateEnvironmentName(name: string): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Invalid environment name: ${name}`);
}

export interface DeploymentPlan {
  summary: string;
  steps?: readonly string[];
}

/**
 * A provider-owned deployment lifecycle. Every method must be idempotent: callers may invoke
 * planning, configuration, and deployment repeatedly to reconcile the desired state.
 */
export interface Deployable {
  plan(context: DeploymentContext): Promise<DeploymentPlan>;
  configure?(context: DeploymentContext): Promise<DeploymentResult | void>;
  deploy(context: DeploymentContext): Promise<DeploymentResult | void>;
}

/** Provider domains expose a deployment lifecycle only when they need one. */
export interface DeployableProvider extends InitializableProvider {
  readonly buildable?: Buildable;
  readonly deployable?: Deployable;
}

export interface DeploymentParticipant {
  id: string;
  role?: "provider" | "sandbox" | "runtime";
  provider: DeployableProvider;
  /** Concrete adapter identity when the participant wraps its lifecycle methods. */
  implementation?: object;
  /** Human-readable provider domain, such as "Tools Provider". */
  providerType?: string;
}

export class ProviderLifecycleError extends Error {
  constructor(
    readonly implementation: string,
    readonly providerType: string,
    readonly operation: string,
    cause: unknown,
  ) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    super(
      `${error.message} (occurred in the ${implementation} implementation of the ${providerType})`,
      { cause: error },
    );
    this.name = "ProviderLifecycleError";
  }
}

/** Preserve the vendor error while attributing a lifecycle failure to its concrete adapter. */
export async function runProviderLifecycleHook<T>(
  provider: object,
  providerType: string,
  operation: string,
  run: () => T | Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProviderLifecycleError) throw error;
    throw new ProviderLifecycleError(
      providerImplementationName(provider, providerType),
      providerType,
      operation,
      error,
    );
  }
}

export interface DeploymentRunOptions {
  devMode: boolean;
  dryRun: boolean;
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
  configuration?: NodeJS.ProcessEnv;
  persistence?: DeploymentPersistence;
  initialInputs?: DeploymentResult;
  report?: DeploymentReporter;
}

/** Check and build every opted-in software artifact before deployment begins. */
export async function buildProviders(
  participants: readonly DeploymentParticipant[],
  options: DeploymentRunOptions,
): Promise<DeploymentOutputs> {
  assertUniqueParticipantIds(participants);
  const report = options.report ?? (() => undefined);
  const inputs = new DeploymentOutputs();
  inputs.merge(options.initialInputs);
  const context: DeploymentContext = {
    devMode: options.devMode,
    repositoryRoot: options.repositoryRoot,
    environment: options.environment ?? process.env,
    configuration: options.configuration,
    persistence: options.persistence ?? noPersistence,
    inputs,
    report,
  };

  for (const participant of participants) {
    const buildable = participant.provider.buildable;
    if (!buildable) continue;
    const scopedContext = context;
    const providerType = participant.providerType ?? providerTypeName(participant.id);
    const implementation = participant.implementation ?? participant.provider;
    report({ event: "build.provider.check.started", details: { providerId: participant.id } });
    await runProviderLifecycleHook(implementation, providerType, "check", () =>
      buildable.check(scopedContext),
    );
    report({ event: "build.provider.check.complete", details: { providerId: participant.id } });
    report({ event: "build.provider.build.started", details: { providerId: participant.id } });
    inputs.merge(
      await runProviderLifecycleHook(implementation, providerType, "build", () =>
        buildable.build(scopedContext),
      ),
    );
    report({ event: "build.provider.build.complete", details: { providerId: participant.id } });
  }
  return inputs;
}

export async function deployProviders(
  participants: readonly DeploymentParticipant[],
  options: DeploymentRunOptions,
): Promise<DeploymentOutputs> {
  assertUniqueParticipantIds(participants);
  const deployable = participants.flatMap((participant) =>
    participant.provider.deployable
      ? [{ ...participant, deployable: participant.provider.deployable }]
      : [],
  );
  for (const participant of deployable) {
    if (!participant.id) throw new Error("Deployment participant id must not be empty");
  }
  const runtime = deployable.filter((participant) => participant.role === "runtime");
  if (runtime.length > 1)
    throw new Error("Only one runtime deployment participant may be registered");

  const report = options.report ?? (() => undefined);
  const inputs = new DeploymentOutputs();
  inputs.merge(options.initialInputs);
  const context: DeploymentContext = {
    devMode: options.devMode,
    repositoryRoot: options.repositoryRoot,
    environment: options.environment ?? process.env,
    configuration: options.configuration,
    persistence: options.persistence ?? noPersistence,
    inputs,
    report,
  };
  const contextFor = (_participant: { role?: DeploymentParticipant["role"] }): DeploymentContext =>
    context;

  for (const participant of deployable) {
    report({ event: "deployment.provider.plan.started", details: { providerId: participant.id } });
    const plan = await runParticipantHook(participant, "plan", () =>
      participant.deployable.plan(contextFor(participant)),
    );
    report({
      event: "deployment.provider.plan.complete",
      details: { providerId: participant.id, summary: plan.summary, steps: plan.steps ?? [] },
    });
  }
  if (options.dryRun) return inputs;

  for (const participant of deployable) {
    if (!participant.deployable.configure) continue;
    report({
      event: "deployment.provider.configure.started",
      details: { providerId: participant.id },
    });
    inputs.merge(
      await runParticipantHook(participant, "configure", () =>
        participant.deployable.configure!(contextFor(participant)),
      ),
    );
    report({
      event: "deployment.provider.configure.complete",
      details: { providerId: participant.id },
    });
  }

  const ordered = [
    ...deployable.filter(
      (participant) => participant.role !== "runtime" && participant.role !== "sandbox",
    ),
    ...deployable.filter((participant) => participant.role === "sandbox"),
    ...runtime,
  ];
  for (const participant of ordered) {
    report({
      event: "deployment.provider.deploy.started",
      details: { providerId: participant.id, role: participant.role ?? "provider" },
    });
    inputs.merge(
      await runParticipantHook(participant, "deploy", () =>
        participant.deployable.deploy(contextFor(participant)),
      ),
    );
    report({
      event: "deployment.provider.deploy.complete",
      details: { providerId: participant.id, role: participant.role ?? "provider" },
    });
  }
  return inputs;
}

function runParticipantHook<T>(
  participant: DeploymentParticipant & { deployable: Deployable },
  operation: string,
  run: () => T | Promise<T>,
): Promise<T> {
  return runProviderLifecycleHook(
    participant.implementation ?? participant.provider,
    participant.providerType ?? providerTypeName(participant.id),
    operation,
    run,
  );
}

function providerTypeName(id: string): string {
  const known: Readonly<Record<string, string>> = {
    agent: "Agent Provider",
    "agent-service": "Agent Service Provider",
    "agent-workspaces": "Computer Provider",
    computer: "Computer Provider",
    "control-service": "Control Service Provider",
    "development-sandbox": "Computer Provider",
    git: "Git Provider",
    skills: "Skills Provider",
    tools: "Tools Provider",
  };
  return known[id] ?? `${titleCase(id)} Provider`;
}

function providerTypeForImplementation(provider: object): string {
  const name = provider.constructor?.name ?? "";
  const domains = [
    "AgentService",
    "ControlService",
    "Computer",
    "Inference",
    "Chat",
    "Skills",
    "Skill",
    "Tools",
    "Tool",
    "Agent",
  ];
  const domain = domains.find((candidate) => name.endsWith(`${candidate}Provider`));
  if (!domain) return "Provider";
  const label = domain === "Skill" ? "Skills" : domain === "Tool" ? "Tools" : domain;
  return `${titleCase(label)} Provider`;
}

function providerImplementationName(provider: object, providerType: string): string {
  const constructorName = provider.constructor?.name;
  if (!constructorName || constructorName === "Object") return "Configured";
  let name = constructorName.replace(/Provider$/, "");
  const typeStem = providerType.replace(/ Provider$/, "").replaceAll(" ", "");
  const suffixes = [typeStem, typeStem.replace(/s$/, "")].sort((a, b) => b.length - a.length);
  for (const suffix of suffixes) {
    if (suffix && name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  return titleCase(name || constructorName);
}

function titleCase(value: string): string {
  return value
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function assertUniqueParticipantIds(participants: readonly DeploymentParticipant[]): void {
  const ids = new Set<string>();
  for (const participant of participants) {
    if (!participant.id) throw new Error("Deployment participant id must not be empty");
    if (ids.has(participant.id))
      throw new Error(`Duplicate deployment participant id: ${participant.id}`);
    ids.add(participant.id);
  }
}
