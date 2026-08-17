import type {
  Buildable,
  Deployable,
  DeploymentContext,
  DeploymentPlan,
  DeploymentResult,
  InitializableProvider,
  ProviderInitialization,
} from "@tryopenbot/runtime-provider";
import { isDevelopmentLifecycle, persistEnvironment } from "@tryopenbot/runtime-provider";
import { VercelPlatform, vercelPlatform } from "@tryopenbot/platform-integrations";
import {
  ensureVercelProject,
  installVercelEnvironment,
  requiredVercelProject,
  vercelDeploymentUrl,
  vercelScopeArguments,
} from "@tryopenbot/platform-integrations/vercel/deployment";
import { resolve } from "node:path";
import { materializeFileTemplate } from "@tryopenbot/utilities";
import { checkControlService } from "../check.js";
import { processRunner, type CommandRunner } from "../command.js";
import {
  buildVercelControlService,
  controlVercelArtifact,
  vercelProjectTemplate,
} from "./build.js";

export interface VercelControlServiceProviderOptions {
  platform?: VercelPlatform;
  runner?: CommandRunner;
  request?: typeof fetch;
}

export class VercelControlServiceProvider implements Buildable, Deployable, InitializableProvider {
  readonly platform: VercelPlatform;
  readonly platforms: readonly VercelPlatform[];
  readonly initialization: ProviderInitialization = {
    id: "vercel-control",
    label: "Vercel control service",
    questions: [
      {
        id: "vercel-control-project",
        prompt: "Vercel project for the control service",
        description:
          "Name of the Vercel project that will host the OpenBot control service and web application.",
        input: "text",
        required: true,
        destination: { kind: "environment", key: "VERCEL_CONTROL_PROJECT" },
      },
    ],
  };
  readonly #runner: CommandRunner;
  readonly #request: typeof fetch;
  constructor(options: VercelControlServiceProviderOptions = {}) {
    this.platform = options.platform ?? vercelPlatform;
    this.platforms = [this.platform];
    this.#runner = options.runner ?? processRunner;
    this.#request = options.request ?? fetch;
  }
  check(context: DeploymentContext) {
    return checkControlService(context, this.#runner);
  }
  async build(context: DeploymentContext) {
    if (isDevelopmentLifecycle(context)) return;
    return buildVercelControlService(context, this.#runner);
  }
  async plan(context: DeploymentContext): Promise<DeploymentPlan> {
    if (isDevelopmentLifecycle(context))
      return {
        summary: "Use the watched local control service in development",
        steps: ["Skip Vercel project configuration and deployment"],
      };
    return {
      summary: "Deploy the independently built control service and web UI to Vercel",
      steps: [`Upload ${controlVercelArtifact} as a prebuilt deployment`, "Smoke-test /healthz"],
    };
  }
  baseUrl(context: Pick<DeploymentContext, "devMode" | "environment">): URL {
    if (context.devMode) {
      return new URL(
        context.environment.PUBLIC_ORIGIN ??
          `http://127.0.0.1:${context.environment.PORT ?? "4100"}`,
      );
    }
    const project = requiredVercelProject(context.environment, "VERCEL_CONTROL_PROJECT");
    return new URL(`https://${project}.vercel.app`);
  }
  async configure(context: DeploymentContext): Promise<DeploymentResult> {
    if (isDevelopmentLifecycle(context)) return {};
    const project = requiredVercelProject(context.environment, "VERCEL_CONTROL_PROJECT");
    await ensureVercelProject(this.#runner, context, project);
    const origin = this.baseUrl(context).toString().replace(/\/$/, "");
    await persistEnvironment(context, "PUBLIC_ORIGIN", origin, "OpenBot public origin.");
    return { outputs: { "control-service.origin": origin, "runtime.origin": origin } };
  }
  async deploy(context: DeploymentContext): Promise<DeploymentResult> {
    if (isDevelopmentLifecycle(context)) return {};
    const project = requiredVercelProject(context.environment, "VERCEL_CONTROL_PROJECT");
    const root = context.inputs.require("control-service.artifact");
    await materializeFileTemplate(vercelProjectTemplate, resolve(root, "vercel.json"));
    await installVercelEnvironment(context, project, this.#request);
    const args = [
      "exec",
      "vercel",
      "deploy",
      "--prebuilt",
      "--yes",
      "--json",
      "--cwd",
      root,
      "--project",
      project,
      ...vercelScopeArguments(context.environment),
    ];
    args.push("--prod");
    const result = await this.#runner.run("pnpm", args, {
      cwd: context.repositoryRoot,
      environment: context.environment,
    });
    const url = vercelDeploymentUrl(`${result.stdout}\n${result.stderr}`);
    const healthUrl = `${url}/healthz`;
    const response = await this.#request(healthUrl, { signal: AbortSignal.timeout(30_000) });
    const body = await response.text();
    if (!response.ok || !healthyResponse(body))
      throw new Error(
        `Control service health smoke failed: ${healthUrl} returned ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`,
      );
    return { outputs: { "control-service.deployment-url": url, "runtime.deployment-url": url } };
  }
}

function healthyResponse(body: string): boolean {
  try {
    return (JSON.parse(body) as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
}

export {
  ensureVercelProject,
  vercelDeploymentUrl as deploymentUrl,
} from "@tryopenbot/platform-integrations/vercel/deployment";
