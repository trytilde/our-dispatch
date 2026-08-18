import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import type { OpenBotConfiguration } from "@tryopenbot/configuration";
import { discoverAgentWorkspaces } from "@tryopenbot/agent-service-provider";
import {
  buildProviders,
  deployProviders,
  DeploymentOutputs,
  runProviderLifecycleHook,
  type DeploymentContext,
  type DeploymentParticipant,
  type DeploymentReporter,
} from "@tryopenbot/runtime-provider";
import {
  discoveredAgentIds,
  persistAgentSandboxUrls,
  repositoryDeploymentPersistence,
} from "./agent-lifecycle.js";

export interface DevelopmentLifecycleOptions {
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  providers: OpenBotConfiguration["providers"];
  report?: DeploymentReporter;
}

export interface DevelopmentComputerWatcher {
  close(): void;
}

/** Check every runtime, provision the local Computer, and leave services to the HMR process. */
export async function reconcileDevelopmentInfrastructure(
  options: DevelopmentLifecycleOptions,
): Promise<void> {
  await reconcileParticipants(options, [
    ...(options.providers.git
      ? [
          {
            id: "git",
            implementation: options.providers.git,
            providerType: "Git Provider",
            provider: options.providers.git,
          },
        ]
      : []),
    { id: "computer", provider: options.providers.computer },
    {
      id: "development-sandbox",
      role: "sandbox",
      implementation: options.providers.computer,
      providerType: "Computer Provider",
      provider: {
        deployable: {
          plan: async () => ({
            summary: "Seed or resume the trusted OpenBot development sandbox",
            steps: [
              "Preserve its mutable source tree and git remotes",
              "Install the aggregate deployment environment and SOPS identity",
              "Prepare the primary agent workspace",
            ],
          }),
          deploy: async (context: DeploymentContext) => {
            const computerId =
              options.environment.DEVELOPMENT_SANDBOX_ID?.trim() || "openbot-development";
            const agentIds = await discoveredAgentIds(context.repositoryRoot);
            const result = await options.providers.computer.deployDevelopmentSandbox(
              { computerId, agentWorkspaceIds: agentIds },
              context,
            );
            await persistAgentSandboxUrls(context, agentIds);
            return result;
          },
        },
      },
    },
    {
      id: "agent-service",
      implementation: options.providers.agentService,
      providerType: "Agent Service Provider",
      provider: {
        buildable: options.providers.agentService,
        deployable: options.providers.agentService,
      },
    },
    {
      id: "control-service",
      role: "runtime",
      implementation: options.providers.controlService,
      providerType: "Control Service Provider",
      provider: {
        buildable: options.providers.controlService,
        deployable: options.providers.controlService,
      },
    },
    {
      id: "auth",
      implementation: options.providers.auth,
      providerType: "Auth Provider",
      provider: options.providers.auth,
    },
  ]);
}

/** Rebuild and replace only the development Computer after an image input changes. */
export async function reconcileDevelopmentComputer(
  options: DevelopmentLifecycleOptions,
): Promise<void> {
  await reconcileParticipants(options, [{ id: "computer", provider: options.providers.computer }]);
}

/** Watch exact provider-owned image inputs and serialize rebuild/restart operations. */
export async function watchDevelopmentComputer(
  options: DevelopmentLifecycleOptions & {
    debounceMs?: number;
    onRebuildStarted?: () => void;
    onRebuildComplete?: () => void;
    onRebuildError?: (error: unknown) => void;
  },
): Promise<DevelopmentComputerWatcher> {
  const buildable = options.providers.computer.buildable;
  if (!buildable?.watchPaths) return { close() {} };
  const context = deploymentContext(options, new DeploymentOutputs());
  const paths = [...new Set(await buildable.watchPaths(context))];
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let pending = Promise.resolve();

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      pending = pending.then(async () => {
        options.onRebuildStarted?.();
        try {
          await reconcileDevelopmentComputer(options);
          options.onRebuildComplete?.();
        } catch (error) {
          options.onRebuildError?.(error);
        }
      });
    }, options.debounceMs ?? 300);
  };

  for (const path of paths) {
    const metadata = await stat(path);
    const watcher = watch(path, { recursive: metadata.isDirectory() }, schedule);
    watcher.on("error", (error) => options.onRebuildError?.(error));
    watchers.push(watcher);
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
}

async function reconcileParticipants(
  options: DevelopmentLifecycleOptions,
  participants: readonly DeploymentParticipant[],
): Promise<void> {
  const report = options.report ?? (() => undefined);
  const persistence = repositoryDeploymentPersistence(options);
  const runOptions = {
    devMode: true,
    dryRun: false,
    repositoryRoot: options.repositoryRoot,
    environment: options.environment,
    persistence,
    report,
  } as const;
  const built = await buildProviders(participants, runOptions);
  const deployed = await deployProviders(participants, {
    ...runOptions,
    initialInputs: built.result(),
  });
  if (!participants.some(({ id }) => id === "computer")) return;

  const computerId = options.environment.COMPUTER_ID?.trim() || "openbot-computer";
  await runProviderLifecycleHook(
    options.providers.computer,
    "Computer Provider",
    "deploy agent workspaces",
    async () =>
      options.providers.computer.deployAgentWorkspaces(
        {
          computerId,
          workspaces: await discoverAgentWorkspaces(options.repositoryRoot),
        },
        deploymentContext(options, deployed),
      ),
  );
}

function deploymentContext(
  options: DevelopmentLifecycleOptions,
  inputs: DeploymentOutputs,
): DeploymentContext {
  return {
    devMode: true,
    repositoryRoot: options.repositoryRoot,
    environment: options.environment,
    persistence: repositoryDeploymentPersistence(options),
    inputs,
    report: options.report ?? (() => undefined),
  };
}
