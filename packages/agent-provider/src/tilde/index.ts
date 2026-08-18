import type { DeploymentContext, DeploymentPlan } from "@tryopenbot/runtime-provider";
import { persistEnvironment, persistSecret } from "@tryopenbot/runtime-provider";
import { TildePlatform, type TildePlatformConfig } from "@tryopenbot/platform-integrations";
import {
  tildeErrorStatus,
  tildeHttpErrorMessage,
} from "@tryopenbot/platform-integrations/tilde/errors";
import {
  chatkitDeleteAgent,
  chatkitGetAgent,
  chatkitListChatProviders,
  chatkitRegisterHttpVercelAiSdkAgent,
  chatkitUpdateChatProvider,
  chatkitRegisterVercelUiChatProvider,
  chatkitSetAgentStatus,
  chatkitUpdateAgent,
  createTildeApiClient,
  InboxStatus,
  type TildeApiClient,
} from "@trytilde/harness-sdk/api";
import type { AgentProvider } from "../core.js";
import { AgentProviderError } from "../core.js";
import { TildeSkillReconciler } from "./skills.js";
import { TildeToolReconciler, tildeAgentProviderInitialization } from "./tools.js";

export { tildeAgentProviderInitialization } from "./tools.js";

export interface TildeAgentProviderConfig extends TildePlatformConfig {}

type JsonRecord = Record<string, unknown>;
const missionControlChannelId = "openbot-mission-control";

interface AgentResource {
  id: string;
  providerId: string;
  displayName?: string;
  endpointUrl?: string;
  localRunningEndpoint: boolean;
  streaming: boolean;
  timeoutMs?: number;
  status?: string;
}

/** Idempotently reconciles every authored agent with Tilde ChatKit. */
export class TildeAgentProvider implements AgentProvider {
  readonly platform: TildePlatform;
  readonly platforms: readonly TildePlatform[];
  readonly initialization = tildeAgentProviderInitialization;
  readonly buildable = {
    check: async (context: DeploymentContext) => {
      requireAgent(context);
    },
    build: async (_context: DeploymentContext) => undefined,
  };
  readonly deployable = {
    plan: (context: DeploymentContext) => this.#plan(context),
    deploy: (context: DeploymentContext) => this.#deploy(context),
  };
  readonly #api: TildeApiClient;
  readonly #teamId: string;
  readonly #skills: TildeSkillReconciler;
  readonly #tools: TildeToolReconciler;

  constructor(platformOrConfig: TildePlatform | TildeAgentProviderConfig) {
    this.platform =
      platformOrConfig instanceof TildePlatform
        ? platformOrConfig
        : new TildePlatform(platformOrConfig);
    this.platforms = [this.platform];
    const config = this.platform.connection();
    this.#api = createTildeApiClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      orgId: config.orgId,
      // Keep generated failures as { error, response } so provider errors retain HTTP context.
      throwOnError: false,
    });
    this.#teamId = config.teamId;
    this.#skills = new TildeSkillReconciler(this.platform);
    this.#tools = new TildeToolReconciler({ platform: this.platform });
  }

  async #plan(context: DeploymentContext): Promise<DeploymentPlan> {
    const agent = requireAgent(context);
    return {
      summary: `Reconcile authored agent ${agent.id} with Tilde`,
      steps: [
        "Create missing ChatKit agents",
        "Create the shared OpenBot Mission Control chat channel when missing",
        "Reconcile Vercel AI SDK endpoint URLs and enabled status",
        "Synchronize authored skills and exact registry membership",
        "Reconcile dynamic MCP, Tilde control-plane, and deployment-platform tools",
        context.devMode
          ? "Enable Tilde local-runtime tunneling"
          : "Use the deployed public agent-service URL",
      ],
    };
  }

  async #deploy(context: DeploymentContext): Promise<void> {
    const { id: slug } = requireAgent(context);
    const origin = context.agentServiceOrigin ?? context.environment.AGENT_SERVICE_ORIGIN;
    if (!origin)
      throw new AgentProviderError(
        "invalid_configuration",
        `The agent service origin is unavailable for ${slug}`,
      );
    const localRunningEndpoint = context.devMode;
    const prefix = `AGENT_${slug.replaceAll("-", "_").toUpperCase()}`;
    const displayName = context.environment[`${prefix}_NAME`]?.trim() || slug;
    const apiKeyName = `${prefix}_API_KEY`;
    const webhookKeyName = `${prefix}_WEBHOOK_SIGNING_KEY`;
    const endpointUrl = new URL(`/api/agents/${slug}`, `${origin}/`);
    const hasCredentials =
      Boolean(context.environment[apiKeyName]) && Boolean(context.environment[webhookKeyName]);
    let agent = await this.#getAgentOrUndefined(slug);
    let createdSecrets: { apiKey: string; webhookSigningKey: string } | undefined;

    // Tilde only returns endpoint credentials at creation. Replace an unrecoverable registration
    // so repeated lifecycle runs converge instead of leaving an unusable endpoint behind.
    if (agent && (!hasCredentials || !isVercelAiSdkProvider(agent.providerId))) {
      await this.#removeAgentEndpoint(agent.id);
      agent = undefined;
    }

    if (!agent) {
      const response = await this.#generated(`create agent "${slug}"`, (signal) =>
        chatkitRegisterHttpVercelAiSdkAgent({
          client: this.#api,
          path: { team_id: this.#teamId },
          body: {
            id: slug,
            display_name: displayName,
            endpoint_url: endpointValue(endpointUrl),
            local_running_endpoint: localRunningEndpoint,
            streaming: true,
            timeout_ms: 300_000,
          },
          signal,
        }),
      );
      agent = agentResource(response.agent as JsonRecord);
      createdSecrets = {
        apiKey: response.api_key,
        webhookSigningKey: response.webhook_signing_key,
      };
    } else if (
      agent.displayName !== displayName ||
      agent.endpointUrl !== endpointValue(endpointUrl) ||
      agent.localRunningEndpoint !== localRunningEndpoint ||
      !agent.streaming ||
      agent.timeoutMs !== 300_000
    ) {
      agent = agentResource(
        (await this.#generated(`update agent "${slug}"`, (signal) =>
          chatkitUpdateAgent({
            client: this.#api,
            path: { team_id: this.#teamId, agent_id: slug },
            body: {
              display_name: displayName,
              endpoint_url: endpointValue(endpointUrl),
              local_running_endpoint: localRunningEndpoint,
              streaming: true,
              timeout_ms: 300_000,
            },
            signal,
          }),
        )) as JsonRecord,
      );
    }

    if (agent.status !== InboxStatus.ENABLED) {
      agent = agentResource(
        (await this.#generated(`enable agent "${slug}"`, (signal) =>
          chatkitSetAgentStatus({
            client: this.#api,
            path: { team_id: this.#teamId, agent_id: agent!.id },
            body: { status: InboxStatus.ENABLED },
            signal,
          }),
        )) as JsonRecord,
      );
    }
    await this.#ensureMissionControlChannel(slug, agent.id, context.agentKind ?? "subagent");
    await persistEnvironment(
      context,
      `${prefix}_AGENT_ID`,
      agent.id,
      `Tilde agent ID for ${slug}.`,
    );
    await persistEnvironment(
      context,
      `${prefix}_PROVIDER_ID`,
      agent.providerId,
      `Tilde agent provider ID for ${slug}.`,
    );
    if (createdSecrets) {
      await persistSecret(
        context,
        apiKeyName,
        createdSecrets.apiKey,
        `Tilde endpoint API key for ${slug}.`,
      );
      await persistSecret(
        context,
        webhookKeyName,
        createdSecrets.webhookSigningKey,
        `Tilde webhook signing key for ${slug}.`,
      );
    }
    await this.#skills.deploy(context);
    await this.#tools.deploy(context);
  }

  /**
   * Tilde resolves Mission Control sessions through the channel whose default agent matches the
   * requested agent, so every authored agent needs its own channel. The primary agent keeps the
   * original shared channel ID.
   */
  async #ensureMissionControlChannel(
    slug: string,
    defaultAgentId: string,
    kind: "primary" | "subagent",
  ): Promise<void> {
    const channelId =
      kind === "primary" ? missionControlChannelId : `${missionControlChannelId}-${slug}`;
    let nextPageToken: string | undefined;
    let existing: JsonRecord | undefined;
    do {
      const response = await this.#generated("list Mission Control chat channels", (signal) =>
        chatkitListChatProviders({
          client: this.#api,
          path: { team_id: this.#teamId },
          query: { page_size: 100, next_page_token: nextPageToken },
          signal,
        }),
      );
      const page = response as { items?: JsonRecord[]; next_page_token?: string | null };
      existing = page.items?.find((channel) => channel.id === channelId);
      if (existing) break;
      nextPageToken = page.next_page_token ?? undefined;
    } while (nextPageToken);

    if (!existing) {
      await this.#generated(`create the Mission Control channel for "${slug}"`, (signal) =>
        chatkitRegisterVercelUiChatProvider({
          client: this.#api,
          path: { team_id: this.#teamId },
          body: {
            id: channelId,
            display_name:
              kind === "primary" ? "OpenBot Mission Control" : `OpenBot Mission Control: ${slug}`,
            default_agent_inbox_id: defaultAgentId,
          },
          signal,
        }),
      );
      return;
    }
    const configuration = jsonRecord(existing.configuration);
    if (configuration?.default_agent_inbox_id === defaultAgentId) return;
    await this.#generated(`repoint the Mission Control channel for "${slug}"`, (signal) =>
      chatkitUpdateChatProvider({
        client: this.#api,
        path: { team_id: this.#teamId, channel_id: channelId },
        body: { default_agent_inbox_id: defaultAgentId },
        signal,
      }),
    );
  }

  async #getAgentOrUndefined(id: string): Promise<AgentResource | undefined> {
    try {
      return agentResource(
        (await this.#generated(`get agent "${id}"`, (signal) =>
          chatkitGetAgent({
            client: this.#api,
            path: { team_id: this.#teamId, agent_id: id },
            signal,
          }),
        )) as JsonRecord,
      );
    } catch (error) {
      if (error instanceof AgentProviderError && error.code === "not_found") return undefined;
      throw error;
    }
  }

  async #removeAgentEndpoint(id: string): Promise<void> {
    try {
      await this.#generated(`clear endpoint for agent "${id}"`, (signal) =>
        chatkitUpdateAgent({
          client: this.#api,
          path: { team_id: this.#teamId, agent_id: id },
          body: { endpoint_url: null, local_running_endpoint: false },
          signal,
        }),
      );
      await this.#generated(`disable agent "${id}"`, (signal) =>
        chatkitSetAgentStatus({
          client: this.#api,
          path: { team_id: this.#teamId, agent_id: id },
          body: { status: InboxStatus.DISABLED },
          signal,
        }),
      );
      await this.#generated(`delete agent "${id}"`, (signal) =>
        chatkitDeleteAgent({
          client: this.#api,
          path: { team_id: this.#teamId, agent_id: id },
          signal,
        }),
      );
    } catch (error) {
      if (error instanceof AgentProviderError && error.code === "not_found") return;
      throw error;
    }
  }

  async #generated<T>(
    operationName: string,
    operation: (signal: AbortSignal) => Promise<{ data?: T; error?: unknown; response?: Response }>,
  ): Promise<T> {
    try {
      const result = await operation(AbortSignal.timeout(30_000));
      if (result.error !== undefined) {
        const status = result.response?.status;
        throw new AgentProviderError(
          agentErrorCode(status),
          `Unable to ${operationName}: ${tildeHttpErrorMessage(
            result.error,
            result.response,
            "Tilde API request failed",
          )}`,
          !status || status >= 500,
        );
      }
      return result.data as T;
    } catch (error) {
      if (error instanceof AgentProviderError) throw error;
      if (
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new AgentProviderError("deadline_exceeded", "Tilde request timed out", true);
      }
      const status = tildeErrorStatus(error);
      throw new AgentProviderError(
        agentErrorCode(status),
        `Unable to ${operationName}: ${tildeHttpErrorMessage(error, undefined)}`,
        !status || status >= 500,
      );
    }
  }
}

function requireAgent(context: DeploymentContext): { id: string; path: string } {
  if (!context.agentId || !context.agentPath)
    throw new AgentProviderError(
      "invalid_configuration",
      "The agent lifecycle requires an agent ID and absolute path",
    );
  return { id: context.agentId, path: context.agentPath };
}

function endpointValue(endpointUrl: URL): string {
  return endpointUrl.toString();
}

function agentResource(value: JsonRecord): AgentResource {
  const configuration = jsonRecord(value.configuration);
  return {
    id: requiredString(value.id, "agent identifier"),
    providerId: optionalString(value.provider_id) ?? "chatkit.http-vercel-ai-sdk",
    displayName: optionalString(value.display_name),
    endpointUrl: optionalString(configuration?.endpoint_url),
    localRunningEndpoint: configuration?.local_running_endpoint === true,
    streaming: configuration?.streaming === true,
    timeoutMs: typeof configuration?.timeout_ms === "number" ? configuration.timeout_ms : undefined,
    status: optionalString(value.status),
  };
}

function jsonRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value)
    throw new AgentProviderError("provider_unavailable", `Tilde returned an invalid ${label}`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isVercelAiSdkProvider(providerId: string): boolean {
  return providerId === "http-vercel-ai-sdk" || providerId.endsWith(".http-vercel-ai-sdk");
}

function agentErrorCode(status: number | undefined): AgentProviderError["code"] {
  switch (status) {
    case 400:
      return "invalid_request";
    case 404:
      return "not_found";
    case 401:
    case 403:
      return "permission_denied";
    default:
      return "provider_unavailable";
  }
}
