import type { DeploymentContext, DeploymentPlan } from "@tryopenbot/runtime-provider";
import {
  persistEnvironment,
  persistSecret,
  unsetEnvironment,
  unsetSecret,
} from "@tryopenbot/runtime-provider";
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
  chatkitDeleteAgent,
  chatkitDeleteChatProvider,
  chatkitGetAgent,
  chatkitGetAgentResourceBundleProvisioning,
  chatkitListChatProviders,
  chatkitProvisionAgentResourceBundle,
  chatkitUpdateChatProvider,
  chatkitUpdateAgentAvatar,
  chatkitUpdateAgentOwnership,
  chatkitUpdateAgentVisibility,
  chatkitRegisterVercelUiChatProvider,
  chatkitSetAgentPermissions,
  AgentCredentialStrategy,
  AgentProvisioningStatus,
  ChatKitAgentConcurrencyPolicy,
  ResourceAccessMode,
  ChatKitAutomaticMemoryMode,
  UserToolFederationMode,
  createTildeApiClient,
  type TildeApiClient,
  type AgentPermissions,
} from "@trytilde/sdk/api";
import type { AgentProvider } from "../core.js";
import { AgentProviderError } from "../core.js";
import { TildeSkillReconciler } from "./skills.js";
import { TildeToolReconciler, tildeAgentProviderInitialization } from "./tools.js";
import { fetchWithConcurrency } from "./concurrency.js";
import { renderAgentAvatarPng } from "./avatar.js";

export { tildeAgentProviderInitialization } from "./tools.js";

export interface TildeAgentProviderConfig extends TildePlatformConfig {}

export interface TildeAgentResourcePolicy {
  authorization?: {
    ownership?: ResourceAccessMode;
    visibility?: ResourceAccessMode;
  };
  enableExternalTools?: boolean;
  enableMcpServer?: boolean;
  enableMcpDynamicToolDiscovery?: boolean;
  enableNonSystemMappedMcpTools?: boolean;
  enableTildeControlPlane?: boolean;
  enableSkillRegistry?: boolean;
  permissions?: AgentPermissions;
}

export interface TildeAgentProviderOptions {
  resourcePolicy?: (agent: {
    id: string;
    kind: "primary" | "subagent";
  }) => TildeAgentResourcePolicy;
}

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
  readonly remove = (context: DeploymentContext) => this.#remove(context);
  readonly #api: TildeApiClient;
  readonly #teamId: string;
  readonly #skills: TildeSkillReconciler;
  readonly #tools: TildeToolReconciler;
  readonly #resourcePolicy: NonNullable<TildeAgentProviderOptions["resourcePolicy"]>;

  constructor(
    platformOrConfig: TildePlatform | TildeAgentProviderConfig,
    options: TildeAgentProviderOptions = {},
  ) {
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
    this.#resourcePolicy = options.resourcePolicy ?? (() => ({}));
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
    const policy = this.#resourcePolicy({
      id: agent.id,
      kind: context.agentKind ?? "subagent",
    });
    return {
      summary: `Reconcile authored agent ${agent.id} with Tilde`,
      steps: [
        "Create missing ChatKit agents",
        "Create the shared OpenBot ChatKit workspace channel when missing",
        "Reconcile Vercel AI SDK endpoint URLs and enabled status",
        "Upload the agent's canonical avatar",
        "Provision automatic memory for ordinary agents without recursive synthesizer memory",
        policy.enableSkillRegistry === false
          ? "Remove the agent skill registry"
          : "Synchronize authored skills and exact registry membership",
        policy.enableMcpServer === false
          ? "Remove the dynamic MCP server and its remote tools"
          : policy.enableMcpDynamicToolDiscovery === false &&
              policy.enableNonSystemMappedMcpTools === false &&
              policy.enableTildeControlPlane === false &&
              policy.enableExternalTools === false
            ? "Reconcile a fixed MCP server for process-local tools only"
            : "Reconcile dynamic MCP, Tilde control-plane, and deployment-platform tools",
        context.devMode
          ? "Enable Tilde local-runtime tunneling"
          : "Use the deployed public agent-service URL",
      ],
    };
  }

  async #deploy(context: DeploymentContext): Promise<void> {
    const { id: slug } = requireAgent(context);
    const policy = this.#resourcePolicy({
      id: slug,
      kind: context.agentKind ?? "subagent",
    });
    const origin = context.agentServiceOrigin ?? context.environment.AGENT_SERVICE_ORIGIN;
    if (!origin)
      throw new AgentProviderError(
        "invalid_configuration",
        `The agent service origin is unavailable for ${slug}`,
      );
    const localRunningEndpoint = context.devMode;
    const prefix = `AGENT_${slug.replaceAll("-", "_").toUpperCase()}`;
    const displayName = context.environment[`${prefix}_NAME`]?.trim() || slug;
    const synthesisOnly = slug === "memory-catcher";
    const memoryMode = synthesisOnly
      ? ChatKitAutomaticMemoryMode.NONE
      : automaticMemoryMode(context.environment, prefix);
    const apiKeyName = `${prefix}_API_KEY`;
    const webhookKeyName = `${prefix}_WEBHOOK_SIGNING_KEY`;
    const endpointUrl = new URL(`/api/agents/${slug}`, `${origin}/`);
    const hasCredentials =
      Boolean(context.environment[apiKeyName]) && Boolean(context.environment[webhookKeyName]);
    const enabledSkills =
      policy.enableSkillRegistry === false
        ? { custom: [], managed: [] }
        : await this.#skills.bundleSkills(context);
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
            automatic_memory_mode: memoryMode,
            credential_strategy: hasCredentials
              ? AgentCredentialStrategy.PRESERVE
              : AgentCredentialStrategy.ROTATE,
          },
          mcp_server:
            policy.enableMcpServer === false
              ? { enabled: false }
              : {
                  enabled: true,
                  id: context.environment[`${prefix}_MCP_SERVER_ID`]?.trim() || `openbot-${slug}`,
                  name: `OpenBot ${slug}`,
                  dynamic_tool_discovery: policy.enableMcpDynamicToolDiscovery ?? true,
                  enable_tilde_control_plane: policy.enableTildeControlPlane ?? true,
                  user_tool_federation_mode: personalToolFederationMode(context.environment),
                  user_tool_federation_selections: [],
                },
          skill_registry:
            policy.enableSkillRegistry === false
              ? { enabled: false }
              : {
                  enabled: true,
                  id: context.environment[`${prefix}_SKILL_REGISTRY_ID`]?.trim(),
                  name: `OpenBot ${slug}`,
                  description: `Skills available to the ${slug} OpenBot agent.`,
                  enabled_skills: enabledSkills,
                },
          ...(synthesisOnly
            ? {}
            : {
                memory: {
                  bank:
                    memoryMode === ChatKitAutomaticMemoryMode.PERSONAL_PLUS_AGENT
                      ? {
                          enabled: true,
                          name: `OpenBot ${slug} memory`,
                          description: `Memory owned by the ${slug} OpenBot agent.`,
                          synthesizer_agent_id: "memory-catcher",
                        }
                      : { enabled: false },
                },
              }),
        },
        signal,
      }),
    );
    for (let attempt = 0; operation.status !== AgentProvisioningStatus.ACTIVE; attempt += 1) {
      if (
        operation.status === AgentProvisioningStatus.ERROR &&
        !isRetryableProvisioningError(operation.error_message)
      )
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
    const mcpServerId =
      policy.enableMcpServer === false
        ? undefined
        : operation.resources.find(({ kind, key }) => kind === "mcp_server" && key === "default")
            ?.id;
    if (policy.enableMcpServer !== false && !mcpServerId)
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
        `The stable agent API key is unavailable for ${slug}`,
      );
    const avatar = renderAgentAvatarPng(slug);
    await this.#generated(`upload avatar for "${slug}"`, (signal) =>
      chatkitUpdateAgentAvatar({
        client: this.#api,
        path: { team_id: this.#teamId, agent_id: slug },
        // The generated OpenAPI type uses number[] for binary bodies, while fetch requires a
        // BodyInit. Preserve the Uint8Array at runtime until the generator models binary input.
        body: avatar as unknown as number[],
        headers: { "Content-Type": "image/png" },
        signal,
      }),
    );
    if (mcpServerId) {
      await persistEnvironment(
        context,
        `${prefix}_MCP_SERVER_ID`,
        mcpServerId,
        `Tilde MCP server ID for ${slug}.`,
      );
    } else {
      await unsetEnvironment(context, `${prefix}_MCP_SERVER_ID`);
    }
    if (mcpServerId && policy.enableNonSystemMappedMcpTools === false) {
      await this.#tools.removeNonSystemMappedTools(mcpServerId);
    }
    if (policy.permissions) {
      await this.#generated(`set permissions for "${slug}"`, (signal) =>
        chatkitSetAgentPermissions({
          client: this.#api,
          path: { team_id: this.#teamId, agent_id: slug },
          body: policy.permissions!,
          signal,
        }),
      );
    }
    await Promise.all([
      policy.authorization?.visibility
        ? this.#generated(`set visibility for "${slug}"`, (signal) =>
            chatkitUpdateAgentVisibility({
              client: this.#api,
              path: { team_id: this.#teamId, agent_id: slug },
              body: { mode: policy.authorization!.visibility! },
              signal,
            }),
          )
        : undefined,
      policy.authorization?.ownership
        ? this.#generated(`set ownership for "${slug}"`, (signal) =>
            chatkitUpdateAgentOwnership({
              client: this.#api,
              path: { team_id: this.#teamId, agent_id: slug },
              body: { mode: policy.authorization!.ownership! },
              signal,
            }),
          )
        : undefined,
    ]);
    await Promise.all([
      this.#ensureChatKitWorkspaceChannel(slug, slug, context.agentKind ?? "subagent"),
      policy.enableExternalTools === false
        ? undefined
        : this.#tools.deployExternalResources(context),
      unsetEnvironment(context, `${prefix}_AGENT_ID`),
      unsetEnvironment(context, `${prefix}_PROVIDER_ID`),
      unsetEnvironment(context, `${prefix}_SKILL_REGISTRY_ID`),
      unsetEnvironment(context, `${prefix}_TILDE_CONTROL_PLANE_TOOL_GROUP_ID`),
    ]);
  }

  async #remove(context: DeploymentContext): Promise<void> {
    const { id: slug } = requireAgent(context);
    const prefix = `AGENT_${slug.replaceAll("-", "_").toUpperCase()}`;
    const channelId = `${chatKitRealtimeChannelId}-${slug}`;
    await this.#tools.removeExternalResources(context);
    await this.#ignoreMissing(`delete ChatKit workspace channel for "${slug}"`, (signal) =>
      chatkitDeleteChatProvider({
        client: this.#api,
        path: { team_id: this.#teamId, channel_id: channelId },
        signal,
      }),
    );
    await this.#ignoreMissing(`delete Agent Resource Bundle "${slug}"`, (signal) =>
      chatkitDeleteAgent({
        client: this.#api,
        path: { team_id: this.#teamId, agent_id: slug },
        signal,
      }),
    );
    for (let attempt = 0; attempt < 1_200; attempt += 1) {
      try {
        await this.#generated(`check deleted agent "${slug}"`, (signal) =>
          chatkitGetAgent({
            client: this.#api,
            path: { team_id: this.#teamId, agent_id: slug },
            signal,
          }),
        );
      } catch (error) {
        if (error instanceof AgentProviderError && error.code === "not_found") break;
        throw error;
      }
      if (attempt === 1_199)
        throw new AgentProviderError(
          "deadline_exceeded",
          `Timed out deleting Agent Resource Bundle "${slug}"`,
          true,
        );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await Promise.all([
      unsetSecret(context, `${prefix}_API_KEY`),
      unsetSecret(context, `${prefix}_WEBHOOK_SIGNING_KEY`),
      ...[
        "NAME",
        "COMPUTER_SERVICE_URL",
        "MCP_SERVER_ID",
        "AGENT_ID",
        "PROVIDER_ID",
        "SKILL_REGISTRY_ID",
        "TILDE_CONTROL_PLANE_TOOL_GROUP_ID",
        "VERCEL_MCP_CREDENTIAL_ID",
        "VERCEL_MCP_TOKEN_SHA256",
        "VERCEL_MCP_SERVER_ID",
      ].map((suffix) => unsetEnvironment(context, `${prefix}_${suffix}`)),
    ]);
  }

  async #ignoreMissing<T>(
    operationName: string,
    operation: (signal: AbortSignal) => Promise<{ data?: T; error?: unknown; response?: Response }>,
  ): Promise<void> {
    try {
      await this.#generated(operationName, operation);
    } catch (error) {
      if (error instanceof AgentProviderError && error.code === "not_found") return;
      throw error;
    }
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

/** Return whether Tilde reported the one known worker checkpoint that can heal while polling. */
function isRetryableProvisioningError(errorMessage: string | null | undefined): boolean {
  const message = errorMessage?.trim().toLowerCase();
  const checkpoint = "memory bindings are still synchronizing";
  return message === checkpoint || message === `service unavailable: ${checkpoint}`;
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

function personalToolFederationMode(
  environment: Record<string, string | undefined>,
): UserToolFederationMode {
  const value = environment.OPENBOT_PERSONAL_TOOL_FEDERATION_MODE?.trim().toLowerCase();
  if (value === "all") return UserToolFederationMode.ALL;
  if (value === "selected") return UserToolFederationMode.SELECTED;
  return UserToolFederationMode.NONE;
}

function automaticMemoryMode(
  environment: Record<string, string | undefined>,
  agentPrefix: string,
): ChatKitAutomaticMemoryMode {
  const value = (
    environment[`${agentPrefix}_AUTOMATIC_MEMORY_MODE`] ?? environment.OPENBOT_AUTOMATIC_MEMORY_MODE
  )
    ?.trim()
    .toLowerCase();
  if (!value || value === "none") return ChatKitAutomaticMemoryMode.NONE;
  if (value === "personal") return ChatKitAutomaticMemoryMode.PERSONAL;
  if (value === "personal_plus_agent") return ChatKitAutomaticMemoryMode.PERSONAL_PLUS_AGENT;
  if (value === "team") return ChatKitAutomaticMemoryMode.TEAM;
  throw new AgentProviderError(
    "invalid_configuration",
    "OPENBOT_AUTOMATIC_MEMORY_MODE must be none, personal, personal_plus_agent, or team",
  );
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
