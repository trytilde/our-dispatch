import { homedir } from "node:os";
import type {
  DeploymentContext,
  DeploymentPlan,
  DeploymentResult,
  ProviderInitialization,
} from "@tryopenbot/runtime-provider";
import { isDevelopmentLifecycle, persistEnvironment } from "@tryopenbot/runtime-provider";
import {
  LocalControlServiceProvider,
  processRunner,
  retireLocalService,
  type CommandRunner,
  type LocalControlServiceProviderOptions,
} from "@tryopenbot/control-service-provider";
import { LocalAgentServiceProvider } from "../local/index.js";
import { buildLocalRuntimeService } from "./local-build.js";

export type LocalRuntimeServiceProviderOptions = LocalControlServiceProviderOptions;

/** One local process containing control routes and all authored agent endpoints. */
export class LocalRuntimeServiceProvider {
  readonly initialization: ProviderInitialization = {
    id: "local-runtime",
    label: "Local OpenBot runtime",
    questions: [],
  };
  readonly #control: LocalControlServiceProvider;
  readonly #agents: LocalAgentServiceProvider;
  readonly #runner: CommandRunner;
  readonly #platform: NodeJS.Platform;
  readonly #homeDirectory: string;
  readonly #uid: number | undefined;

  constructor(options: LocalRuntimeServiceProviderOptions = {}) {
    this.#runner = options.runner ?? processRunner;
    this.#platform = options.platform ?? process.platform;
    this.#homeDirectory = options.homeDirectory ?? homedir();
    this.#uid = options.uid ?? process.getuid?.();
    const shared = { ...options, runner: this.#runner };
    this.#control = new LocalControlServiceProvider(shared);
    this.#agents = new LocalAgentServiceProvider(shared);
  }

  baseUrl(context: Pick<DeploymentContext, "devMode" | "environment">): URL {
    return this.#control.baseUrl(context);
  }

  async check(context: DeploymentContext): Promise<void> {
    await this.#agents.check(context);
    await this.#control.check(context);
  }

  async build(context: DeploymentContext): Promise<DeploymentResult | undefined> {
    if (isDevelopmentLifecycle(context)) return;
    return buildLocalRuntimeService(context, this.#runner);
  }

  async plan(context: DeploymentContext): Promise<DeploymentPlan> {
    if (isDevelopmentLifecycle(context))
      return {
        summary: "Use the watched combined OpenBot runtime in development",
        steps: ["Skip local service installation"],
      };
    return {
      summary: "Install the combined local OpenBot runtime",
      steps: ["Install one user service", "Smoke-test /healthz"],
    };
  }

  async configure(context: DeploymentContext): Promise<DeploymentResult> {
    const result = await this.#control.configure(context);
    if (isDevelopmentLifecycle(context)) return result;
    const origin = this.baseUrl(context).toString().replace(/\/$/, "");
    return {
      outputs: {
        ...result.outputs,
        "agent-service.origin": origin,
        "runtime.origin": origin,
      },
    };
  }

  async deploy(context: DeploymentContext): Promise<DeploymentResult> {
    const result = await this.#control.deploy(context);
    if (isDevelopmentLifecycle(context)) return result;
    const origin = this.baseUrl(context).toString().replace(/\/$/, "");
    await persistEnvironment(context, "AGENT_SERVICE_ORIGIN", origin, "Agent endpoint origin.");
    const url = result.outputs?.["control-service.deployment-url"];
    return {
      outputs: {
        ...result.outputs,
        ...(url ? { "agent-service.deployment-url": url } : {}),
      },
    };
  }

  async finalizeEndpointCutover(context: DeploymentContext): Promise<void> {
    if (isDevelopmentLifecycle(context)) return;
    await retireLocalService(context, this.#runner, {
      id: "openbot-agents",
      platform: this.#platform,
      homeDirectory: this.#homeDirectory,
      uid: this.#uid,
    });
  }
}
