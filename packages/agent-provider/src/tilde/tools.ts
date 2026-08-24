import { createHash } from "node:crypto";
import { type Client, type McpServer } from "@trytilde/sdk";
import { TildePlatform } from "@tryopenbot/platform-integrations";
import { tildeErrorMessage } from "@tryopenbot/platform-integrations/tilde/errors";
import type { ProviderInitialization } from "@tryopenbot/runtime-provider";
import { persistEnvironment, type DeploymentContext } from "@tryopenbot/runtime-provider";
import {
  addMcpServerInstanceFunction,
  connectProxiedMcpServer,
  createResourceServerCredential,
  createTildeApiClient,
  createToolGroupInstance,
  getMcpServerInstance,
  deleteProxiedMcpServer,
  enableProxiedMcpServer,
  enableTool,
  encryptResourceServerConfiguration,
  listAvailableToolGroups,
  listProxiedMcpServers,
  listResourceServerCredentials,
  listToolGroupInstances,
  listTools,
  ProxiedMcpAuthMode,
  type ProxiedMcpServerListItem,
  type ResourceServerCredentialSerialized,
  updateToolGroupInstance,
} from "@trytilde/api-client";
import type {
  EnsureToolServerRequest,
  ToolServer,
  ToolReconciliationContext,
} from "./tools-types.js";
import { AgentProviderError } from "../core.js";
import { mapWithConcurrency } from "./concurrency.js";
import { reconciliationSignal } from "./tools-types.js";

export type TildeToolReconcilerConfig = { platform: TildePlatform } | { client: Client };

export const tildeAgentProviderInitialization: ProviderInitialization = {
  id: "tilde-agent-resources",
  label: "Tilde agent resources",
  questions: [],
};

const maxConcurrentRequests = 10;

export class TildeToolReconciler {
  readonly #client: Client;
  readonly #api: ReturnType<typeof createTildeApiClient>;
  readonly #teamId: string;
  constructor(config: TildeToolReconcilerConfig) {
    this.#client = "platform" in config ? config.platform.client() : config.client;
    const connection = this.#client.config;
    this.#teamId = connection.teamId;
    this.#api = createTildeApiClient({
      baseUrl: connection.baseUrl,
      apiKey: connection.apiKey,
      bearerToken: connection.bearerToken,
      orgId: connection.orgId,
      headers: connection.headers,
      fetch: connection.fetch,
      throwOnError: true,
    });
  }

  async ensureServer(
    request: EnsureToolServerRequest,
    context: ToolReconciliationContext,
  ): Promise<ToolServer> {
    reconciliationSignal(context);
    const dynamicToolDiscovery = request.dynamicToolDiscovery ?? true;
    try {
      const server = await this.#client.mcp.getServer({ id: request.id });
      return toolServer(
        server.name === request.name && server.isDynamicToolDiscovery === dynamicToolDiscovery
          ? server
          : await this.#client.mcp.updateServer({
              id: request.id,
              name: request.name,
              isDynamicToolDiscovery: dynamicToolDiscovery,
            }),
      );
    } catch (error) {
      if (!isNotFound(error)) throw toolsError("reconcile", error);
      try {
        return toolServer(
          await this.#client.mcp.createServer({
            id: request.id,
            name: request.name,
            isDynamicToolDiscovery: dynamicToolDiscovery,
          }),
        );
      } catch (createError) {
        throw toolsError("create", createError);
      }
    }
  }

  async deploy(context: DeploymentContext): Promise<void> {
    try {
      await this.#deployResources(context);
    } catch (error) {
      if (error instanceof AgentProviderError) throw error;
      throw toolsError("reconcile Tilde tool resources", error);
    }
  }

  async #deployResources(context: DeploymentContext): Promise<void> {
    const { id } = requireAgent(context);
    const prefix = `AGENT_${id.replaceAll("-", "_").toUpperCase()}`;
    const server = await this.ensureServer(
      {
        id: context.environment[`${prefix}_MCP_SERVER_ID`]?.trim() || `openbot-${id}`,
        name: `OpenBot ${id}`,
        dynamicToolDiscovery: true,
      },
      {
        requestId: `agent-lifecycle:${id}:mcp-server`,
        idempotencyKey: `openbot:${id}:mcp-server`,
      },
    );
    await persistEnvironment(
      context,
      `${prefix}_MCP_SERVER_ID`,
      server.id,
      `Tilde MCP server ID for ${id}.`,
    );
    await Promise.all([
      this.#reconcileTildeControlPlane(context, id, prefix, server.id),
      context.agentKind === "primary" ? this.#reconcileGitHubTools(context) : undefined,
      context.platformIds?.includes("vercel")
        ? this.#reconcileVercelMcp(context, id, prefix)
        : undefined,
    ]);
  }

  /** Enable every GitHub tool on the git-provider's brokered tool group for the primary agent. */
  async #reconcileGitHubTools(context: DeploymentContext): Promise<void> {
    const groupId = context.environment.GIT_GITHUB_TOOL_GROUP_ID?.trim();
    if (!groupId) return;
    try {
      await this.#enableGitHubTools(context, groupId);
    } catch (error) {
      // A stale or replaced tool group is the git provider's to recreate; report and move on.
      if (!isNotFound(error)) throw error;
      context.report({
        event: "agent.github-tools.skipped",
        details: { reason: "The GitHub tool group no longer exists", groupId },
      });
    }
  }

  async #enableGitHubTools(context: DeploymentContext, groupId: string): Promise<void> {
    const [{ data: catalog }, { data: enabled }] = await Promise.all([
      listAvailableToolGroups({
        client: this.#api,
        path: { team_id: this.#teamId },
        query: { page_size: 100, deployment_alias: "latest", include_global: true },
        throwOnError: true,
      }),
      listTools({
        client: this.#api,
        path: { team_id: this.#teamId },
        query: { page_size: 100, tool_group_instance_id: groupId, include_global: false },
        throwOnError: true,
      }),
    ]);
    const source = catalog.items.find((candidate) => candidate.type_id === "github");
    if (!source) return;
    const enabledIds = new Set(enabled.items.map((tool) => tool.tool_source_type_id));
    const missing = source.tools.filter((tool) => !enabledIds.has(tool.type_id));
    await mapWithConcurrency(missing, maxConcurrentRequests, (tool) =>
      enableTool({
        client: this.#api,
        path: {
          team_id: this.#teamId,
          tool_group_instance_id: groupId,
          tool_source_type_id: tool.type_id,
        },
        body: {},
        throwOnError: true,
      }),
    );
  }

  async #reconcileTildeControlPlane(
    context: DeploymentContext,
    agentId: string,
    prefix: string,
    serverId: string,
  ): Promise<void> {
    const desiredId = `openbot-${agentId}-tilde-control-plane`;
    const displayName = `OpenBot ${agentId} Tilde control plane`;
    const { data: listed } = await listToolGroupInstances({
      client: this.#api,
      path: { team_id: this.#teamId },
      query: {
        page_size: 100,
        tool_group_source_type_id: "tilde_control_plane",
        include_global: false,
      },
      throwOnError: true,
    });
    const listedGroup =
      listed.items.find((item) => item.id === desiredId) ??
      listed.items.find((item) => item.display_name === displayName);
    let group: { id: string; displayName: string } | undefined = listedGroup
      ? { id: listedGroup.id, displayName: listedGroup.display_name }
      : undefined;
    if (!group) {
      const { data } = await createToolGroupInstance({
        client: this.#api,
        path: {
          team_id: this.#teamId,
          tool_group_source_type_id: "tilde_control_plane",
          credential_source_type_id: "no_auth",
        },
        body: { display_name: displayName, tool_group_instance_id: desiredId },
        throwOnError: true,
      });
      group = { id: data.id, displayName: data.display_name };
    } else if (group.displayName !== displayName) {
      await updateToolGroupInstance({
        client: this.#api,
        path: { team_id: this.#teamId, tool_group_instance_id: group.id },
        body: { display_name: displayName },
        throwOnError: true,
      });
      group = { id: group.id, displayName };
    }
    if (!group) throw new Error("Tilde control-plane toolkit reconciliation returned no group");

    const [{ data: catalog }, { data: enabled }] = await Promise.all([
      listAvailableToolGroups({
        client: this.#api,
        path: { team_id: this.#teamId },
        query: { page_size: 100, deployment_alias: "latest", include_global: true },
        throwOnError: true,
      }),
      listTools({
        client: this.#api,
        path: { team_id: this.#teamId },
        query: { page_size: 100, tool_group_instance_id: group.id, include_global: false },
        throwOnError: true,
      }),
    ]);
    const source = catalog.items.find((candidate) => candidate.type_id === "tilde_control_plane");
    if (!source) throw new Error("Tilde control-plane toolkit is unavailable");
    const enabledIds = new Set(enabled.items.map((tool) => tool.tool_source_type_id));
    const missing = source.tools.filter((tool) => !enabledIds.has(tool.type_id));
    await mapWithConcurrency(missing, maxConcurrentRequests, (tool) =>
      enableTool({
        client: this.#api,
        path: {
          team_id: this.#teamId,
          tool_group_instance_id: group.id,
          tool_source_type_id: tool.type_id,
        },
        body: {},
        throwOnError: true,
      }),
    );
    // Enabling a tool on the provider does not expose it to the agent: every
    // function must also be mapped onto the agent's runtime MCP server, where
    // the dynamic registry (SEARCH_TOOLS / MULTI_EXECUTE_TOOL) discovers it.
    const { data: instance } = await getMcpServerInstance({
      client: this.#api,
      path: { team_id: this.#teamId, mcp_server_instance_id: serverId },
      throwOnError: true,
    });
    const mapped = new Set(
      (instance.tools ?? [])
        .filter((tool) => tool.tool_group_instance_id === group.id)
        .map((tool) => tool.tool_source_type_id),
    );
    await mapWithConcurrency(
      source.tools.filter((tool) => !mapped.has(tool.type_id)),
      maxConcurrentRequests,
      (tool) =>
        addMcpServerInstanceFunction({
          client: this.#api,
          path: { team_id: this.#teamId, mcp_server_instance_id: serverId },
          body: {
            tool_group_instance_id: group.id,
            tool_group_source_type_id: "tilde_control_plane",
            tool_name: tool.type_id,
            tool_source_type_id: tool.type_id,
          },
          throwOnError: true,
        }),
    );
    await persistEnvironment(
      context,
      `${prefix}_TILDE_CONTROL_PLANE_TOOL_GROUP_ID`,
      group.id,
      `Tilde control-plane toolkit group ID for ${agentId}.`,
    );
  }

  async #reconcileVercelMcp(
    context: DeploymentContext,
    agentId: string,
    prefix: string,
  ): Promise<void> {
    const token = context.environment.VERCEL_TOKEN?.trim();
    if (!token)
      throw new AgentProviderError(
        "invalid_configuration",
        "VERCEL_TOKEN is required to connect the Vercel MCP server",
      );
    const credentialIdName = `${prefix}_VERCEL_MCP_CREDENTIAL_ID`;
    const tokenHashName = `${prefix}_VERCEL_MCP_TOKEN_SHA256`;
    const serverIdName = `${prefix}_VERCEL_MCP_SERVER_ID`;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const previousCredentialId = context.environment[credentialIdName]?.trim();
    const credentialDisplayName = `OpenBot ${agentId} Vercel MCP`;
    const { data: credentials } = await listResourceServerCredentials({
      client: this.#api,
      path: { team_id: this.#teamId },
      query: { page_size: 100 },
      throwOnError: true,
    });
    let credentialId =
      context.environment[tokenHashName] === tokenHash
        ? findVercelCredential(credentials.items, previousCredentialId, credentialDisplayName)?.id
        : undefined;
    if (!credentialId) {
      const { data: encrypted } = await encryptResourceServerConfiguration({
        client: this.#api,
        path: { team_id: this.#teamId, credential_source_type_id: "api_key" },
        body: {
          dek_alias: `team:${this.#teamId}:default`,
          value: { api_key: token },
        },
        throwOnError: true,
      });
      const { data } = await createResourceServerCredential({
        client: this.#api,
        path: { team_id: this.#teamId, credential_source_type_id: "api_key" },
        body: {
          dek_alias: `team:${this.#teamId}:default`,
          metadata: { display_name: credentialDisplayName },
          resource_server_configuration: encrypted,
        },
        throwOnError: true,
      });
      credentialId = data.id;
    }

    const displayName = `OpenBot ${agentId} Vercel`;
    const { data: servers } = await listProxiedMcpServers({
      client: this.#api,
      path: { team_id: this.#teamId },
      query: { page_size: 100 },
      throwOnError: true,
    });
    let existing = findVercelServer(
      servers.items,
      context.environment[serverIdName]?.trim(),
      displayName,
    );
    if (existing && !sameVercelServer(existing, displayName, credentialId)) {
      await deleteProxiedMcpServer({
        client: this.#api,
        path: { team_id: this.#teamId, tool_group_instance_id: existing.tool_group_instance.id },
        throwOnError: true,
      });
      existing = undefined;
    }
    if (!existing) {
      const { data } = await connectProxiedMcpServer({
        client: this.#api,
        path: { team_id: this.#teamId },
        body: {
          name: displayName,
          url: "https://mcp.vercel.com",
          auth_mode: ProxiedMcpAuthMode.BEARER_TOKEN,
          api_key_header_name: "Authorization",
          api_key_header_prefix: "Bearer ",
          resource_server_credential_id: credentialId,
          local_running_endpoint: false,
        },
        throwOnError: true,
      });
      existing = {
        server: {
          id: data.tool_group_instance.id,
          display_name: displayName,
          endpoint_configuration: {},
          auth_mode: ProxiedMcpAuthMode.BEARER_TOKEN,
          status: "active",
        },
        tool_group_instance: data.tool_group_instance,
        tool_count: data.discovered_tool_count,
      } as ProxiedMcpServerListItem;
    } else if (existing.server.status !== "active") {
      await enableProxiedMcpServer({
        client: this.#api,
        path: { team_id: this.#teamId, tool_group_instance_id: existing.tool_group_instance.id },
        throwOnError: true,
      });
    }
    await persistEnvironment(
      context,
      credentialIdName,
      credentialId,
      `Vercel MCP credential ID for ${agentId}.`,
    );
    await persistEnvironment(
      context,
      tokenHashName,
      tokenHash,
      `Vercel MCP credential fingerprint for ${agentId}.`,
    );
    await persistEnvironment(
      context,
      serverIdName,
      existing.tool_group_instance.id,
      `Tilde proxied Vercel MCP server ID for ${agentId}.`,
    );
  }
}

function findVercelCredential(
  credentials: readonly ResourceServerCredentialSerialized[],
  configuredId: string | undefined,
  displayName: string,
): ResourceServerCredentialSerialized | undefined {
  return (
    credentials.find((credential) => credential.id === configuredId) ??
    credentials.find((credential) => credential.metadata.display_name === displayName)
  );
}

function findVercelServer(
  servers: readonly ProxiedMcpServerListItem[],
  configuredId: string | undefined,
  displayName: string,
): ProxiedMcpServerListItem | undefined {
  return (
    servers.find((item) => item.tool_group_instance.id === configuredId) ??
    servers.find((item) => item.server.display_name === displayName)
  );
}

function sameVercelServer(
  server: ProxiedMcpServerListItem,
  displayName: string,
  credentialId: string,
): boolean {
  const endpoint = server.server.endpoint_configuration as Record<string, unknown>;
  return (
    server.server.display_name === displayName &&
    server.tool_group_instance.display_name === displayName &&
    server.server.auth_mode === ProxiedMcpAuthMode.BEARER_TOKEN &&
    endpoint.url === "https://mcp.vercel.com" &&
    endpoint.api_key_header_name === "Authorization" &&
    endpoint.api_key_header_prefix === "Bearer " &&
    server.tool_group_instance.resource_server_credential_id === credentialId
  );
}

function requireAgent(context: DeploymentContext): { id: string; path: string } {
  if (!context.agentId || !context.agentPath)
    throw new AgentProviderError(
      "invalid_configuration",
      "The agent resource lifecycle requires an agent ID and absolute path",
    );
  return { id: context.agentId, path: context.agentPath };
}

function toolServer(server: McpServer): ToolServer {
  return { id: server.id };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("status" in error && error.status === 404) ||
      ("response" in error && (error.response as Response | undefined)?.status === 404))
  );
}

function toolsError(operation: string, error: unknown): AgentProviderError {
  return new AgentProviderError(
    "provider_unavailable",
    `Unable to ${operation} Tilde MCP server: ${tildeErrorMessage(error, "unknown error")}`,
    true,
  );
}
