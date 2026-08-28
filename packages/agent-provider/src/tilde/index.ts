import type { DeploymentContext, DeploymentPlan } from "@tryopenbot/runtime-provider";
import { persistEnvironment, persistSecret, unsetEnvironment } from "@tryopenbot/runtime-provider";
import {
  TildePlatform,
  tildeAuthenticationHeaders,
  type TildePlatformConfig,
} from "@tryopenbot/platform-integrations";
import { createClient } from "@trytilde/sdk";
import {
  tildeErrorStatus,
  tildeHttpErrorMessage,
} from "@tryopenbot/platform-integrations/tilde/errors";
import {
  chatkitClaimAgentResourceBundleOutputs,
  chatkitGetAgentResourceBundleProvisioning,
  chatkitListChatProviders,
  chatkitProvisionAgentResourceBundle,
  chatkitUpdateChatProvider,
  chatkitUpdateAgentAvatar,
  chatkitRegisterVercelUiChatProvider,
  AgentCredentialStrategy,
  AgentProvisioningStatus,
  ChatKitAgentConcurrencyPolicy,
  createTildeApiClient,
  type TildeApiClient,
} from "@trytilde/sdk/api";
import type { AgentProvider } from "../core.js";
import { AgentProviderError } from "../core.js";
import { TildeSkillReconciler } from "./skills.js";
import { TildeToolReconciler, tildeAgentProviderInitialization } from "./tools.js";
import { fetchWithConcurrency } from "./concurrency.js";
import { renderAgentAvatarPng } from "./avatar.js";

export { tildeAgentProviderInitialization } from "./tools.js";

export interface TildeAgentProviderConfig extends TildePlatformConfig {}

type JsonRecord = Record<string, unknown>;
const chatKitRealtimeChannelId = "openbot-chatkit-workspace";
const maxConcurrentRequests = 10;

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
    const limitedFetch = fetchWithConcurrency(
      (input, init) => fetch(input, init),
      maxConcurrentRequests,
    );
    this.#api = createTildeApiClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      orgId: config.orgId,
      headers: tildeAuthenticationHeaders(config),
      fetch: limitedFetch,
      // Keep generated failures as { error, response } so provider errors retain HTTP context.
      throwOnError: false,
    });
    this.#teamId = config.teamId;
    this.#skills = new TildeSkillReconciler({ ...config, fetch: limitedFetch });
    this.#tools = new TildeToolReconciler({
      client: createClient({
        ...config,
        orgSubdomain: false,
        headers: tildeAuthenticationHeaders(config),
        fetch: limitedFetch,
      }),
    });
  }

  async #plan(context: DeploymentContext): Promise<DeploymentPlan> {
    const agent = requireAgent(context);
    return {
      summary: `Reconcile authored agent ${agent.id} with Tilde`,
      steps: [
        "Create missing ChatKit agents",
        "Create the shared OpenBot ChatKit workspace channel when missing",
        "Reconcile Vercel AI SDK endpoint URLs and enabled status",
        "Upload the agent's canonical machine-user avatar",
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
    const enabledSkills = await this.#skills.bundleSkills(context);
    let operation = await this.#generated(`provision Agent Resource Bundle "${slug}"`, (signal) =>
      chatkitProvisionAgentResourceBundle({
        client: this.#api,
        path: { team_id: this.#teamId, agent_id: slug },
        body: {
          agent: {
            display_name: displayName,
            endpoint: {
              url: endpointValue(endpointUrl),
              local_running_endpoint: localRunningEndpoint,
              streaming: true,
              timeout_ms: 300_000,
              concurrency_policy: ChatKitAgentConcurrencyPolicy.QUEUE,
            },
            status: "enabled",
            credential_strategy: hasCredentials
              ? AgentCredentialStrategy.PRESERVE
              : AgentCredentialStrategy.ROTATE,
          },
          mcp_server: {
            enabled: true,
            id: context.environment[`${prefix}_MCP_SERVER_ID`]?.trim() || `openbot-${slug}`,
            name: `OpenBot ${slug}`,
            dynamic_tool_discovery: true,
            enable_tilde_control_plane: true,
          },
          skill_registry: {
            enabled: true,
            id: context.environment[`${prefix}_SKILL_REGISTRY_ID`]?.trim(),
            name: `OpenBot ${slug}`,
            description: `Skills available to the ${slug} OpenBot agent.`,
            enabled_skills: enabledSkills,
          },
          memory: {
            bank: {
              enabled: true,
              name: `OpenBot ${slug} memory`,
              description: `Memory owned by the ${slug} OpenBot agent.`,
            },
          },
        },
        signal,
      }),
    );
    for (let attempt = 0; operation.status !== AgentProvisioningStatus.ACTIVE; attempt += 1) {
      if (operation.status === AgentProvisioningStatus.ERROR)
        throw new AgentProviderError(
          "provider_unavailable",
          operation.error_message || `Tilde could not provision ${slug}`,
          true,
        );
      if (attempt >= 1_200)
        throw new AgentProviderError(
          "deadline_exceeded",
          `Timed out provisioning Agent Resource Bundle "${slug}"`,
          true,
        );
      await new Promise((resolve) => setTimeout(resolve, 500));
      operation = await this.#generated(`poll Agent Resource Bundle "${slug}"`, (signal) =>
        chatkitGetAgentResourceBundleProvisioning({
          client: this.#api,
          path: { team_id: this.#teamId, agent_id: slug },
          signal,
        }),
      );
    }
    const mcpServerId = operation.resources.find(
      ({ kind, key }) => kind === "mcp_server" && key === "default",
    )?.id;
    if (!mcpServerId)
      throw new AgentProviderError(
        "provider_unavailable",
        `Tilde returned no MCP server for ${slug}`,
        true,
      );
    let createdSecrets: { apiKey: string; webhookSigningKey: string } | undefined;
    if (operation.outputs_available) {
      const claimed = await this.#generated(
        `claim Agent Resource Bundle outputs "${slug}"`,
        (signal) =>
          chatkitClaimAgentResourceBundleOutputs({
            client: this.#api,
            path: { team_id: this.#teamId, agent_id: slug },
            signal,
          }),
      );
      if (claimed.values?.api_key && claimed.values.webhook_signing_key)
        createdSecrets = {
          apiKey: claimed.values.api_key,
          webhookSigningKey: claimed.values.webhook_signing_key,
        };
    }
    // One-time outputs are irrecoverable after claiming. Persist them before avatar upload,
    // external integrations, or any other fallible reconciliation work.
    await this.#persistAgentSecrets(context, slug, prefix, createdSecrets);
    const agentApiKey = createdSecrets?.apiKey ?? context.environment[apiKeyName]?.trim();
    if (!agentApiKey)
      throw new AgentProviderError(
        "invalid_configuration",
        `The stable machine-user API key is unavailable for ${slug}`,
      );
    const platform = this.platform.connection();
    const agentApi = createTildeApiClient({
      baseUrl: platform.baseUrl,
      apiKey: agentApiKey,
      orgId: platform.orgId,
      throwOnError: false,
    });
    const avatar = renderAgentAvatarPng(slug);
    await this.#generated(`upload avatar for "${slug}"`, (signal) =>
      chatkitUpdateAgentAvatar({
        client: agentApi,
        path: { team_id: this.#teamId, agent_id: slug },
        // The generated OpenAPI type uses number[] for binary bodies, while fetch requires a
        // BodyInit. Preserve the Uint8Array at runtime until the generator models binary input.
        body: avatar as unknown as number[],
        headers: { "Content-Type": "image/png" },
        signal,
      }),
    );
    await persistEnvironment(
      context,
      `${prefix}_MCP_SERVER_ID`,
      mcpServerId,
      `Tilde MCP server ID for ${slug}.`,
    );
    await Promise.all([
      this.#ensureChatKitWorkspaceChannel(slug, slug, context.agentKind ?? "subagent"),
      this.#tools.deployExternalResources(context),
      unsetEnvironment(context, `${prefix}_AGENT_ID`),
      unsetEnvironment(context, `${prefix}_PROVIDER_ID`),
      unsetEnvironment(context, `${prefix}_SKILL_REGISTRY_ID`),
      unsetEnvironment(context, `${prefix}_TILDE_CONTROL_PLANE_TOOL_GROUP_ID`),
    ]);
  }

  async #persistAgentSecrets(
    context: DeploymentContext,
    slug: string,
    prefix: string,
    createdSecrets: { apiKey: string; webhookSigningKey: string } | undefined,
  ): Promise<void> {
    const apiKeyName = `${prefix}_API_KEY`;
    const webhookKeyName = `${prefix}_WEBHOOK_SIGNING_KEY`;
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
  }

  /**
   * Tilde resolves ChatKit workspace sessions through the channel whose default agent matches the
   * requested agent, so every authored agent needs its own channel. The primary agent keeps the
   * original shared channel ID.
   */
  async #ensureChatKitWorkspaceChannel(
    slug: string,
    defaultAgentId: string,
    kind: "primary" | "subagent",
  ): Promise<void> {
    const channelId =
      kind === "primary" ? chatKitRealtimeChannelId : `${chatKitRealtimeChannelId}-${slug}`;
    let nextPageToken: string | undefined;
    let existing: JsonRecord | undefined;
    do {
      const response = await this.#generated("list ChatKit workspace chat channels", (signal) =>
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
      await this.#generated(`create the ChatKit workspace channel for "${slug}"`, (signal) =>
        chatkitRegisterVercelUiChatProvider({
          client: this.#api,
          path: { team_id: this.#teamId },
          body: {
            id: channelId,
            display_name:
              kind === "primary"
                ? "OpenBot ChatKit workspace"
                : `OpenBot ChatKit workspace: ${slug}`,
            default_agent_inbox_id: defaultAgentId,
          },
          signal,
        }),
      );
      return;
    }
    const configuration = jsonRecord(existing.configuration);
    if (configuration?.default_agent_inbox_id === defaultAgentId) return;
    await this.#generated(`repoint the ChatKit workspace channel for "${slug}"`, (signal) =>
      chatkitUpdateChatProvider({
        client: this.#api,
        path: { team_id: this.#teamId, channel_id: channelId },
        body: { default_agent_inbox_id: defaultAgentId },
        signal,
      }),
    );
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

function jsonRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
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
