import { resolve } from "node:path";
import { materializeFileTemplate } from "@tryopenbot/utilities";
import { VercelPlatform, vercelPlatform } from "@tryopenbot/platform-integrations";
import {
  ensureVercelProject,
  installVercelEnvironment,
  requiredVercelProject,
  vercelDeploymentUrl,
  vercelScopeArguments,
} from "@tryopenbot/platform-integrations/vercel/deployment";
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
import { processRunner, type CommandRunner } from "@tryopenbot/control-service-provider";
import { checkAgentService } from "../check.js";
import { agentVercelArtifact, buildVercelAgentService, vercelProjectTemplate } from "./build.js";

export interface VercelAgentServiceProviderOptions {
  platform?: VercelPlatform;
  runner?: CommandRunner;
  request?: typeof fetch;
}

export class VercelAgentServiceProvider implements Buildable, Deployable, InitializableProvider {
  readonly platform: VercelPlatform;
  readonly platforms: readonly VercelPlatform[];
  readonly initialization: ProviderInitialization = {
    id: "vercel-agents",
    label: "Vercel agent service",
    questions: [
      {
        id: "vercel-agent-project",
        prompt: "Vercel project for agent functions",
        description:
          "Name of the Vercel project that will host OpenBot agent functions and own their Container Registry namespace.",
        input: "text",
        required: true,
        destination: { kind: "environment", key: "VERCEL_AGENT_PROJECT" },
      },
    ],
  };
  readonly #runner: CommandRunner;
  readonly #request: typeof fetch;
  constructor(options: VercelAgentServiceProviderOptions = {}) {
    this.platform = options.platform ?? vercelPlatform;
    this.platforms = [this.platform];
    this.#runner = options.runner ?? processRunner;
    this.#request = options.request ?? fetch;
  }
  check(context: DeploymentContext) {
    return checkAgentService(context, this.#runner);
  }
  async build(context: DeploymentContext) {
    if (isDevelopmentLifecycle(context)) return;
    return buildVercelAgentService(context);
  }
  async plan(context: DeploymentContext): Promise<DeploymentPlan> {
    if (isDevelopmentLifecycle(context))
      return {
        summary: "Use the watched local agent service in development",
        steps: ["Skip Vercel project configuration and deployment"],
      };
    return {
      summary: "Deploy independently bundled agent functions to Vercel",
      steps: [
        `Upload ${context.inputs.get("agent-service.count") ?? "all"} parallel-built functions`,
        "Smoke-test /healthz",
      ],
    };
  }
  baseUrl(context: Pick<DeploymentContext, "devMode" | "environment">): URL {
    if (context.devMode) {
      return new URL(
        context.environment.PUBLIC_ORIGIN ??
          `http://127.0.0.1:${context.environment.PORT ?? "4100"}`,
      );
    }
    const project = requiredVercelProject(context.environment, "VERCEL_AGENT_PROJECT");
    return new URL(`https://${project}.vercel.app`);
  }
  async configure(context: DeploymentContext): Promise<DeploymentResult> {
    if (isDevelopmentLifecycle(context)) return {};
    const project = requiredVercelProject(context.environment, "VERCEL_AGENT_PROJECT");
    await ensureVercelProject(this.#runner, context, project);
    const origin = this.baseUrl(context).toString().replace(/\/$/, "");
    await persistEnvironment(context, "AGENT_SERVICE_ORIGIN", origin, "Agent service origin.");
    return { outputs: { "agent-service.origin": origin } };
  }
  async deploy(context: DeploymentContext): Promise<DeploymentResult> {
    if (isDevelopmentLifecycle(context)) return {};
    const project = requiredVercelProject(context.environment, "VERCEL_AGENT_PROJECT");
    const root = context.inputs.require("agent-service.artifact");
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
        `Agent service health smoke failed: ${healthUrl} returned ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`,
      );
    return { outputs: { "agent-service.deployment-url": url } };
  }
}

function healthyResponse(body: string): boolean {
  try {
    return (JSON.parse(body) as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
}

export { agentVercelArtifact };
