import type {
  DeploymentContext,
  DeploymentPlan,
  DeploymentResult,
  ProviderInitialization,
} from "@tryopenbot/runtime-provider";
import { isDevelopmentLifecycle, persistEnvironment } from "@tryopenbot/runtime-provider";
import {
  processRunner,
  VercelControlServiceProvider,
  type CommandRunner,
} from "@tryopenbot/control-service-provider";
import { TildePlatform, VercelPlatform } from "@tryopenbot/platform-integrations";
import { VercelAgentServiceProvider } from "../vercel/index.js";
import { buildVercelRuntimeService } from "./vercel-build.js";

export interface VercelRuntimeServiceProviderOptions {
  platform?: VercelPlatform;
  hostedPlatform?: TildePlatform;
  runner?: CommandRunner;
  request?: typeof fetch;
}

/** One Vercel project containing static UI, control API, and isolated per-agent Functions. */
export class VercelRuntimeServiceProvider {
  readonly initialization: ProviderInitialization = {
    id: "vercel-runtime",
    label: "Vercel OpenBot runtime",
    questions: [
      {
        id: "vercel-runtime-project",
        prompt: "Vercel project for the OpenBot runtime",
        description:
          "Name of the single Vercel project that will host the web app, control API, and isolated agent functions.",
        input: "text",
        required: true,
        destination: { kind: "environment", key: "VERCEL_RUNTIME_PROJECT" },
      },
    ],
  };
  readonly platform: VercelPlatform;
  readonly platforms: readonly VercelPlatform[];
  readonly #control: VercelControlServiceProvider;
  readonly #agents: VercelAgentServiceProvider;
  readonly #runner: CommandRunner;

  constructor(options: VercelRuntimeServiceProviderOptions = {}) {
    this.#runner = options.runner ?? processRunner;
    const shared = { ...options, runner: this.#runner };
    this.#control = new VercelControlServiceProvider(shared);
    this.#agents = new VercelAgentServiceProvider(shared);
    this.platform = this.#control.platform;
    this.platforms = this.#control.platforms;
  }

  baseUrl(context: Pick<DeploymentContext, "devMode" | "environment">): URL {
    if (context.devMode) return this.#control.baseUrl(context);
    return new URL(`https://${runtimeProject(context.environment)}.vercel.app`);
  }

  async check(context: DeploymentContext): Promise<void> {
    await this.#agents.check(context);
    await this.#control.check(context);
  }

  async build(context: DeploymentContext): Promise<DeploymentResult | undefined> {
    if (isDevelopmentLifecycle(context)) return;
    return buildVercelRuntimeService(context, this.#runner);
  }

  async plan(context: DeploymentContext): Promise<DeploymentPlan> {
    if (isDevelopmentLifecycle(context))
      return {
        summary: "Use the watched combined OpenBot runtime in development",
        steps: ["Skip Vercel project configuration and deployment"],
      };
    return {
      summary: "Deploy the web app, control API, and isolated agent functions together",
      steps: [
        `Upload ${context.inputs.get("agent-service.count") ?? "all"} agent functions with the control runtime`,
        "Smoke-test /healthz",
      ],
    };
  }

  async configure(context: DeploymentContext): Promise<DeploymentResult> {
    const project = runtimeProject(context.environment);
    const result = await withControlProject(context, project, () =>
      this.#control.configure(context),
    );
    if (isDevelopmentLifecycle(context)) return result;
    await persistEnvironment(
      context,
      "VERCEL_RUNTIME_PROJECT",
      project,
      "Vercel project hosting the combined OpenBot runtime.",
    );
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
    const result = await withControlProject(context, runtimeProject(context.environment), () =>
      this.#control.deploy(context),
    );
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
}

function runtimeProject(environment: NodeJS.ProcessEnv): string {
  const project =
    environment.VERCEL_RUNTIME_PROJECT?.trim() ?? environment.VERCEL_CONTROL_PROJECT?.trim();
  if (!project) throw new Error("VERCEL_RUNTIME_PROJECT is required for the OpenBot runtime");
  return project;
}

async function withControlProject<T>(
  context: DeploymentContext,
  project: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = context.environment.VERCEL_CONTROL_PROJECT;
  context.environment.VERCEL_CONTROL_PROJECT = project;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete context.environment.VERCEL_CONTROL_PROJECT;
    else context.environment.VERCEL_CONTROL_PROJECT = previous;
  }
}
