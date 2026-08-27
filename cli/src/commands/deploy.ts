import { resolve } from "node:path";
import arg from "arg";
import type { OpenBotConfiguration } from "@tryopenbot/configuration";
import { discoverAgentWorkspaces } from "@tryopenbot/agent-service-provider";
import {
  buildProviders,
  deployProviders,
  type DeploymentContext,
  type DeploymentEvent,
  type DeploymentParticipant,
} from "@tryopenbot/runtime-provider";
import {
  discoveredAgentIds,
  persistAgentSandboxUrls,
  reconcileAgentResources,
  repositoryDeploymentPersistence,
} from "../agent-lifecycle.js";
import { loadDeploymentConfiguration } from "../initialization.js";
import { loadConfigurationModule } from "../configuration-loader.js";
import { repositoryRoot } from "../paths.js";
import { inkPrompts } from "./init.js";

export interface DeployOptions {
  yes: boolean;
  dryRun: boolean;
  json: boolean;
  skipDeploy: boolean;
  service: "all" | "agents" | "control";
}

export interface DeploymentScope {
  deployAgents: boolean;
  deployControl: boolean;
  deployComputer: boolean;
}

/** A consolidated runtime cannot build or release one half independently. */
export function deploymentScope(
  service: DeployOptions["service"],
  consolidatedRuntime: boolean,
): DeploymentScope {
  if (consolidatedRuntime) return { deployAgents: true, deployControl: true, deployComputer: true };
  return {
    deployAgents: service === "all" || service === "agents",
    deployControl: service === "all" || service === "control",
    deployComputer: service === "all",
  };
}

export function serviceDeploymentParticipants(options: {
  agentService: OpenBotConfiguration["providers"]["agentService"];
  controlService: OpenBotConfiguration["providers"]["controlService"];
  inference: OpenBotConfiguration["providers"]["inference"];
  deployAgents: boolean;
  consolidatedRuntime: boolean;
}): DeploymentParticipant[] {
  if (!options.deployAgents) return [];
  const service = options.consolidatedRuntime ? options.controlService : options.agentService;
  return [
    {
      id: options.consolidatedRuntime ? "runtime-service" : "agent-service",
      ...(options.consolidatedRuntime ? { role: "runtime" as const } : {}),
      implementation: service,
      providerType: options.consolidatedRuntime
        ? "Runtime Service Provider"
        : "Agent Service Provider",
      provider: { buildable: service, deployable: service },
    },
    ...(options.inference
      ? [
          {
            id: "inference",
            implementation: options.inference,
            providerType: "Inference Provider",
            provider: options.inference,
          },
        ]
      : []),
  ];
}

export function agentEndpointCutoverOrigins(options: {
  consolidatedRuntime: boolean;
  environment: NodeJS.ProcessEnv;
  targetOrigin: string;
}): { preparationOrigin: string; targetOrigin: string } {
  const targetOrigin = options.targetOrigin.replace(/\/$/, "");
  const persistedOrigin = options.environment.AGENT_SERVICE_ORIGIN?.trim().replace(/\/$/, "");
  return {
    preparationOrigin:
      options.consolidatedRuntime && persistedOrigin ? persistedOrigin : targetOrigin,
    targetOrigin,
  };
}

export function parseOptions(argv: readonly string[]): DeployOptions {
  const parsed = arg(
    {
      "--yes": Boolean,
      "--dry-run": Boolean,
      "--json": Boolean,
      "--skip-deploy": Boolean,
      "--service": String,
    },
    { argv: argv.filter((argument) => argument !== "--") },
  );
  if (parsed._.length) throw new Error(`Unknown deploy option: ${parsed._.join(", ")}`);
  const service = parsed["--service"] ?? "all";
  if (service !== "all" && service !== "agents" && service !== "control")
    throw new Error(`Unsupported deploy service: ${service}`);
  return {
    yes: parsed["--yes"] ?? false,
    dryRun: parsed["--dry-run"] ?? false,
    json: parsed["--json"] ?? false,
    skipDeploy: parsed["--skip-deploy"] ?? false,
    service: service as DeployOptions["service"],
  };
}

export function redact(value: string, secrets: Iterable<string>): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length >= 8) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted.replace(/(VERCEL_TOKEN)=([^\s]+)/g, "$1=[REDACTED]");
}

export async function runProductionDeploy(argv: readonly string[]): Promise<void> {
  const options = parseOptions(argv);
  if (!options.yes && !options.dryRun && !options.skipDeploy)
    throw new Error("Production deployment requires --yes (or use --dry-run or --skip-deploy)");

  const report = ({ event, details = {} }: DeploymentEvent): void => {
    process.stdout.write(
      options.json
        ? `${JSON.stringify({ event, ...details })}\n`
        : `${event}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}\n`,
    );
  };

  const deploymentConfiguration = await loadDeploymentConfiguration(repositoryRoot, {
    environment: process.env,
    prompts: process.stdin.isTTY && process.stdout.isTTY ? inkPrompts : undefined,
  });
  Object.assign(process.env, deploymentConfiguration.environment);
  const configuration = await loadRepositoryConfiguration();
  const agentService = configuration.providers.agentService;
  const controlService = configuration.providers.controlService;
  const consolidatedRuntime = agentService === controlService;
  const auth = configuration.providers.auth;
  const computer = configuration.providers.computer;
  const deployComputerLifecycle = computer && !computer.externallyManagedLifecycle;
  const inference = configuration.providers.inference;
  const { deployAgents, deployControl, deployComputer } = deploymentScope(
    options.service,
    consolidatedRuntime,
  );
  const computerId = deploymentConfiguration.environment.COMPUTER_ID?.trim() || "openbot-computer";
  const developmentSandboxId =
    deploymentConfiguration.environment.DEVELOPMENT_SANDBOX_ID?.trim() || "openbot-development";
  const git = configuration.providers.git;
  const participants: DeploymentParticipant[] = [
    ...(deployAgents && git
      ? [
          {
            id: "git",
            implementation: git,
            providerType: "Git Provider",
            provider: git,
          },
        ]
      : []),
    ...(deployComputer && deployComputerLifecycle ? [{ id: "computer", provider: computer }] : []),
    ...(deployAgents && deployComputerLifecycle
      ? [
          {
            id: "agent-workspaces",
            implementation: computer,
            providerType: "Computer Provider",
            provider: {
              deployable: {
                plan: async (_context: DeploymentContext) => ({
                  summary: "Seed populated agent directories on the shared computer",
                  steps: ["Copy seeds to /workspace/<agent-id>", "Skip directories already seeded"],
                }),
                deploy: async (context: DeploymentContext) =>
                  computer.deployAgentWorkspaces(
                    {
                      computerId,
                      workspaces: await discoverAgentWorkspaces(context.repositoryRoot),
                    },
                    context,
                  ),
              },
            },
          },
        ]
      : []),
    ...serviceDeploymentParticipants({
      agentService,
      controlService,
      inference,
      deployAgents,
      consolidatedRuntime,
    }),
    ...(deployComputer && deployComputerLifecycle
      ? [
          {
            id: "development-sandbox",
            role: "sandbox" as const,
            implementation: computer,
            providerType: "Computer Provider",
            provider: {
              deployable: {
                plan: async (_context: DeploymentContext) => ({
                  summary: "Seed or resume the trusted OpenBot development sandbox",
                  steps: [
                    "Preserve its mutable source tree",
                    "Install the aggregate deployment environment and SOPS identity",
                    "Verify in-sandbox decryption",
                  ],
                }),
                deploy: async (context: DeploymentContext) => {
                  const agentIds = await discoveredAgentIds(context.repositoryRoot);
                  const result = await computer.deployDevelopmentSandbox(
                    { computerId: developmentSandboxId, agentWorkspaceIds: agentIds },
                    context,
                  );
                  await persistAgentSandboxUrls(context, agentIds);
                  return result;
                },
              },
            },
          },
        ]
      : []),
    ...(deployControl && !consolidatedRuntime
      ? [
          {
            id: "control-service",
            role: "runtime" as const,
            implementation: controlService,
            providerType: "Control Service Provider",
            provider: { buildable: controlService, deployable: controlService },
          },
        ]
      : []),
    ...(deployControl
      ? [
          {
            id: "auth",
            implementation: auth,
            providerType: "Auth Provider",
            provider: auth,
          },
        ]
      : []),
  ];
  const persistence = repositoryDeploymentPersistence({
    repositoryRoot,
    environment: deploymentConfiguration.environment,
  });
  const runOptions = {
    devMode: false,
    dryRun: options.dryRun,
    interactive: false,
    repositoryRoot,
    environment: deploymentConfiguration.environment,
    configuration: deploymentConfiguration.configuration,
    persistence,
    report,
  } as const;
  const built = await buildProviders(participants, runOptions);
  if (options.skipDeploy) {
    report({ event: "build.complete", details: { deploySkipped: true } });
    return;
  }
  let agentOrigins: ReturnType<typeof agentEndpointCutoverOrigins> | undefined;
  if (deployAgents && !options.dryRun) {
    agentOrigins = agentEndpointCutoverOrigins({
      consolidatedRuntime,
      environment: deploymentConfiguration.environment,
      targetOrigin: agentService
        .baseUrl({
          devMode: false,
          environment: deploymentConfiguration.environment,
        })
        .toString(),
    });
    await reconcileAgentResources({
      repositoryRoot,
      environment: deploymentConfiguration.environment,
      configuration: deploymentConfiguration.configuration,
      providers: configuration.providers,
      devMode: false,
      agentServiceOrigin: agentOrigins.preparationOrigin,
      report,
    });
  }
  await deployProviders(participants, {
    ...runOptions,
    initialInputs: built.result(),
  });
  if (
    agentOrigins &&
    consolidatedRuntime &&
    agentOrigins.preparationOrigin !== agentOrigins.targetOrigin
  )
    await reconcileAgentResources({
      repositoryRoot,
      environment: deploymentConfiguration.environment,
      configuration: deploymentConfiguration.configuration,
      providers: configuration.providers,
      devMode: false,
      agentServiceOrigin: agentOrigins.targetOrigin,
      report,
    });
  if (agentOrigins && consolidatedRuntime && agentService.finalizeEndpointCutover)
    await agentService.finalizeEndpointCutover({
      ...runOptions,
      inputs: built,
    });
}

async function loadRepositoryConfiguration(): Promise<OpenBotConfiguration> {
  const path = resolve(repositoryRoot, "configuration/index.ts");
  const module = await loadConfigurationModule<{ default?: OpenBotConfiguration }>(path);
  if (!module.default)
    throw new Error("configuration/index.ts must export the OpenBot configuration as default");
  return module.default;
}
