import type { AgentProvider } from "@tryopenbot/agent-provider";
import { discoverAgents, type AgentServiceProvider } from "@tryopenbot/agent-service-provider";
import {
  DeploymentOutputs,
  persistEnvironment,
  type DeploymentContext,
  type DeploymentEvent,
  type DeploymentPersistence,
  type DeploymentReporter,
  type DeployableProvider,
  runProviderLifecycleHook,
} from "@tryopenbot/runtime-provider";
import {
  setEncryptedSecret,
  setEnvironmentValue,
  unsetEncryptedSecret,
  unsetEnvironmentValue,
} from "./initialization.js";

/**
 * Point every authored agent's computer tools at the trusted development sandbox, where the
 * writable checkout lives so agents (including the factory) can edit their own source.
 */
/** Discovered agent slugs, or none when the authored tree is not scaffolded yet. */
export async function discoveredAgentIds(repositoryRoot: string): Promise<readonly string[]> {
  try {
    return (await discoverAgents(repositoryRoot)).map((agent) => agent.slug);
  } catch {
    return [];
  }
}

export async function persistAgentSandboxUrls(
  context: DeploymentContext,
  agentIds: readonly string[],
): Promise<void> {
  const serviceUrl = context.environment.DEVELOPMENT_SANDBOX_SERVICE_URL?.trim();
  if (!serviceUrl) return;
  for (const agentId of agentIds) {
    const prefix = `AGENT_${agentId.replaceAll("-", "_").toUpperCase()}`;
    await persistEnvironment(
      context,
      `${prefix}_COMPUTER_SERVICE_URL`,
      serviceUrl,
      `Computer service URL used by the ${agentId} agent's tools.`,
    );
  }
}

export interface ReconcileAgentResourcesOptions {
  repositoryRoot: string;
  agentIds?: readonly string[];
  environment: NodeJS.ProcessEnv;
  configuration?: NodeJS.ProcessEnv;
  providers: {
    agent: AgentProvider;
    agentService: AgentServiceProvider;
  };
  devMode: boolean;
  agentServiceOrigin?: string;
  persistEnvironment?: (name: string, value: string, description: string) => Promise<void>;
  persistSecret?: (name: string, value: string, description: string) => Promise<void>;
  unsetEnvironment?: (name: string) => Promise<void>;
  unsetSecret?: (name: string) => Promise<void>;
  report?: DeploymentReporter;
}

export interface RemoveAgentResourcesOptions extends ReconcileAgentResourcesOptions {
  agentId: string;
  agentPath: string;
}

/** Run each authored agent through its aggregate external-resource lifecycle. */
export async function reconcileAgentResources(
  options: ReconcileAgentResourcesOptions,
): Promise<void> {
  const discoveredSources = await discoverAgents(options.repositoryRoot);
  const selectedAgentIds = options.agentIds ? new Set(options.agentIds) : undefined;
  const automaticMemoryEnabled = discoveredSources.some((source) => {
    if (source.slug === "memory-catcher") return false;
    const prefix = `AGENT_${source.slug.replaceAll("-", "_").toUpperCase()}`;
    const value =
      options.environment[`${prefix}_AUTOMATIC_MEMORY_MODE`] ??
      options.environment.OPENBOT_AUTOMATIC_MEMORY_MODE;
    return (value?.trim().toLowerCase() ?? "none") !== "none";
  });
  let sources = selectedAgentIds
    ? discoveredSources.filter((source) => selectedAgentIds.has(source.slug))
    : discoveredSources.filter(
        (source) => source.slug !== "memory-catcher" || automaticMemoryEnabled,
      );
  const synthesisSource = discoveredSources.find(({ slug }) => slug === "memory-catcher");
  if (
    selectedAgentIds &&
    automaticMemoryEnabled &&
    synthesisSource &&
    sources.some(({ slug }) => slug !== "memory-catcher") &&
    !sources.includes(synthesisSource)
  ) {
    sources = [synthesisSource, ...sources];
  }
  const report = options.report ?? (() => undefined);
  const persistence = serialDeploymentPersistence(repositoryDeploymentPersistence(options));
  const agentServiceOrigin = (
    options.agentServiceOrigin ??
    (
      await runProviderLifecycleHook(
        options.providers.agentService,
        "Agent Service Provider",
        "base URL resolution",
        () =>
          options.providers.agentService.baseUrl({
            devMode: options.devMode,
            environment: options.environment,
          }),
      )
    ).toString()
  ).replace(/\/$/, "");
  report({ event: "agent.lifecycle.started", details: { total: sources.length } });

  const reconcile = async (source: (typeof sources)[number], index: number) => {
    const progress = { agentId: source.slug, index: index + 1, total: sources.length };
    report({ event: "agent.reconcile.started", details: progress });
    const context: DeploymentContext = {
      devMode: options.devMode,
      repositoryRoot: options.repositoryRoot,
      environment: options.environment,
      configuration: options.configuration,
      inputs: new DeploymentOutputs(),
      persistence,
      agentId: source.slug,
      agentPath: source.directory,
      agentKind: source.kind,
      agentServiceOrigin,
      platformIds: [
        ...new Set(
          [options.providers.agentService, options.providers.agent].flatMap(
            (provider) => provider.platforms?.map((platform) => platform.id) ?? [],
          ),
        ),
      ],
      report,
    };
    await runAgentProvider("agent", options.providers.agent, context);
    report({ event: "agent.reconcile.complete", details: progress });
  };

  // Team memory banks validate their configured synthesizer when they are
  // created. Reconcile the built-in synthesizer before ordinary agents so an
  // initial installation cannot race its own dependency.
  const synthesisIndex = sources.findIndex(({ slug }) => slug === "memory-catcher");
  if (synthesisIndex >= 0) await reconcile(sources[synthesisIndex]!, synthesisIndex);
  await mapWithConcurrency(
    sources.filter((_, index) => index !== synthesisIndex),
    10,
    async (source) => reconcile(source, sources.indexOf(source)),
  );
}

/** Remove one authored agent's complete provider-owned external footprint. */
export async function removeAgentResources(options: RemoveAgentResourcesOptions): Promise<void> {
  const persistence = serialDeploymentPersistence(repositoryDeploymentPersistence(options));
  const agentServiceOrigin = (
    options.agentServiceOrigin ??
    (
      await runProviderLifecycleHook(
        options.providers.agentService,
        "Agent Service Provider",
        "base URL resolution",
        () =>
          options.providers.agentService.baseUrl({
            devMode: options.devMode,
            environment: options.environment,
          }),
      )
    ).toString()
  ).replace(/\/$/, "");
  await runProviderLifecycleHook(options.providers.agent, "Agent Provider", "remove", () =>
    options.providers.agent.remove({
      devMode: options.devMode,
      repositoryRoot: options.repositoryRoot,
      environment: options.environment,
      configuration: options.configuration,
      inputs: new DeploymentOutputs(),
      persistence,
      agentId: options.agentId,
      agentPath: options.agentPath,
      agentKind: "subagent",
      agentServiceOrigin,
      platformIds: [
        ...new Set(
          [options.providers.agentService, options.providers.agent].flatMap(
            (provider) => provider.platforms?.map((platform) => platform.id) ?? [],
          ),
        ),
      ],
      report: options.report ?? (() => undefined),
    }),
  );
}

async function runAgentProvider(
  providerId: string,
  provider: DeployableProvider,
  context: DeploymentContext,
): Promise<void> {
  const providerType = "Agent Provider";
  context.report({
    event: "agent.provider.started",
    details: { providerId, agentId: context.agentId },
  });
  if (provider.buildable) {
    await runProviderLifecycleHook(provider, providerType, "check", () =>
      provider.buildable!.check(context),
    );
    context.inputs.merge(
      await runProviderLifecycleHook(provider, providerType, "build", () =>
        provider.buildable!.build(context),
      ),
    );
  }
  if (provider.deployable) {
    if (provider.deployable.configure)
      context.inputs.merge(
        await runProviderLifecycleHook(provider, providerType, "configure", () =>
          provider.deployable!.configure!(context),
        ),
      );
    context.inputs.merge(
      await runProviderLifecycleHook(provider, providerType, "deploy", () =>
        provider.deployable!.deploy(context),
      ),
    );
  }
  context.report({
    event: "agent.provider.complete",
    details: { providerId, agentId: context.agentId },
  });
}

export function repositoryDeploymentPersistence(
  options: Pick<
    ReconcileAgentResourcesOptions,
    | "repositoryRoot"
    | "environment"
    | "persistEnvironment"
    | "persistSecret"
    | "unsetEnvironment"
    | "unsetSecret"
  >,
): DeploymentPersistence {
  return {
    setEnvironment:
      options.persistEnvironment ??
      ((name, value, description) =>
        setEnvironmentValue(options.repositoryRoot, name, value, description)),
    setSecret:
      options.persistSecret ??
      ((name, value, description) =>
        setEncryptedSecret(options.repositoryRoot, name, value, {
          environment: options.environment,
          description,
        })),
    unsetEnvironment:
      options.unsetEnvironment ?? ((name) => unsetEnvironmentValue(options.repositoryRoot, name)),
    unsetSecret:
      options.unsetSecret ??
      ((name) =>
        unsetEncryptedSecret(options.repositoryRoot, name, { environment: options.environment })),
  };
}

/** Keep repository-backed environment and secret writes ordered while remote work runs in parallel. */
export function serialDeploymentPersistence(
  persistence: DeploymentPersistence,
): DeploymentPersistence {
  let tail = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return {
    setEnvironment: (name, value, description) =>
      enqueue(() => persistence.setEnvironment(name, value, description)),
    setSecret: (name, value, description) =>
      enqueue(() => persistence.setSecret(name, value, description)),
    unsetEnvironment: (name) => enqueue(() => persistence.unsetEnvironment(name)),
    unsetSecret: (name) => enqueue(() => persistence.unsetSecret(name)),
  };
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      await operation(values[index]!, index);
    }
  });
  await Promise.all(workers);
}

/** Render lifecycle progress for humans while leaving JSON/reporting policy with the command. */
export function formatAgentLifecycleProgress(event: DeploymentEvent): string | undefined {
  const total = integer(event.details?.total);
  if (event.event === "agent.lifecycle.started" && total !== undefined)
    return `Reconciling Tilde resources for ${total} authored agent${total === 1 ? "" : "s"}`;
  const index = integer(event.details?.index);
  const agentId = event.details?.agentId;
  if (index === undefined || total === undefined || typeof agentId !== "string") return undefined;
  if (event.event === "agent.reconcile.started")
    return `[${index}/${total}] Deploying ${agentId} agent`;
  return undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
