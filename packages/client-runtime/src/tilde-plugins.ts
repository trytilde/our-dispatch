import { z } from "zod";
import type {
  McpProviderCatalogEntry,
  McpServerInstanceSerializedWithFunctions,
  ProxiedMcpServerListItem,
  ProxiedSkillProvider,
  Skill,
  SkillRegistry,
  ToolGroupInstanceListItem,
  ToolGroupSourceSerialized,
} from "@trytilde/api-client/generated";
import { PluginsCatalogSchema, type PluginsCatalog } from "./contracts/plugins.js";
import {
  ConnectorAccountSchema,
  CreateConnectorAccountResultSchema,
  type CreateConnectorAccountInput,
} from "./contracts/connectors.js";

type RequestJson = (path: string, init?: RequestInit) => Promise<unknown>;

const RecordSchema = z.record(z.string(), z.unknown());
const NativeResourcePageSchema = z.object({
  items: z.array(RecordSchema),
  next_page_token: z.string().nullish(),
});
const ManagedProviderPageSchema = z.object({ items: z.array(RecordSchema) });

type NativeResource<T> = T & Record<string, unknown>;

interface TildePluginResources {
  tool_providers: NativeResource<ToolGroupSourceSerialized>[];
  tool_accounts: NativeResource<ToolGroupInstanceListItem>[];
  mcp_servers: NativeResource<McpServerInstanceSerializedWithFunctions>[];
  proxied_mcp_servers: NativeResource<ProxiedMcpServerListItem>[];
  skills: NativeResource<Skill>[];
  skill_providers: NativeResource<ProxiedSkillProvider>[];
  skill_registries: NativeResource<SkillRegistry>[];
}

export function createTildePluginsClient(requestJson: RequestJson) {
  const listToolProviders = () =>
    listNativeResources<ToolGroupSourceSerialized>(
      requestJson,
      "/api/tilde/mcp/available-tool-groups",
      {
        deployment_alias: "latest",
        include_global: "true",
      },
    );
  const listToolAccounts = () =>
    listNativeResources<ToolGroupInstanceListItem>(requestJson, "/api/tilde/mcp/tool-group", {
      include_global: "false",
    });
  const listMcpServers = () =>
    listNativeResources<McpServerInstanceSerializedWithFunctions>(
      requestJson,
      "/api/tilde/mcp/mcp-server",
      { include_global: "false" },
    );
  const listProxiedMcpServers = () =>
    listNativeResources<ProxiedMcpServerListItem>(
      requestJson,
      "/api/tilde/mcp/proxied-mcp-servers",
      { include_catalog_managed: "false" },
    );
  const listSkills = () => listNativeResources<Skill>(requestJson, "/api/tilde/skill");
  const listSkillProviders = () =>
    listNativeResources<ProxiedSkillProvider>(requestJson, "/api/tilde/skill-providers", {}, false);
  const listSkillRegistries = () =>
    listNativeResources<SkillRegistry>(requestJson, "/api/tilde/skill-registry");

  async function catalog() {
    const [
      toolProviders,
      toolAccounts,
      mcpServers,
      proxiedMcpServers,
      skills,
      skillProviders,
      skillRegistries,
    ] = await Promise.all([
      listToolProviders(),
      listToolAccounts(),
      listMcpServers(),
      listProxiedMcpServers(),
      listSkills(),
      listSkillProviders(),
      listSkillRegistries(),
    ]);
    return {
      tool_providers: toolProviders,
      tool_accounts: toolAccounts,
      mcp_servers: mcpServers,
      proxied_mcp_servers: proxiedMcpServers,
      skills,
      skill_providers: skillProviders,
      skill_registries: skillRegistries,
    } satisfies TildePluginResources;
  }

  async function getPluginsCatalog(): Promise<PluginsCatalog> {
    const [resources, managed] = await Promise.all([
      catalog(),
      requestJson("/api/tilde/mcp/provider-catalog"),
    ]);
    return PluginsCatalogSchema.parse(
      projectPlugins(
        resources,
        ManagedProviderPageSchema.parse(managed).items as NativeResource<McpProviderCatalogEntry>[],
      ),
    );
  }

  return {
    getPluginsCatalog,

    async listConnectorProviders() {
      return (await getPluginsCatalog()).tools
        .map((group) => group.provider)
        .filter((provider) => provider.can_add_account !== false);
    },

    async listConnectorAccounts(providerTypeId?: string) {
      return (await getPluginsCatalog()).tools
        .filter((group) => !providerTypeId || group.provider.type_id === providerTypeId)
        .flatMap((group) => group.accounts);
    },

    async waitForConnectorAccount(accountId: string) {
      const response = RecordSchema.parse(
        await requestJson(
          `/api/tilde/mcp/tool-group/${encodeURIComponent(accountId)}?wait_for_status=active&timeout_ms=30000`,
        ),
      );
      return ConnectorAccountSchema.parse(record(response.tool_group_instance));
    },

    async createNativeConnectorAccount(input: CreateConnectorAccountInput) {
      if (input.providerTypeId.startsWith("managed_mcp:")) {
        return await createManagedConnectorAccount(requestJson, input);
      }
      const setup = RecordSchema.parse(
        await requestJson("/api/tilde/provider-setup/start", {
          method: "POST",
          body: JSON.stringify({
            domain: "mcp",
            provider_id: input.providerTypeId,
            auth_method_id: input.credentialSourceTypeId,
            form_values: {
              displayName: input.displayName,
              ...input.resourceServerValues,
              ...input.userCredentialValues,
            },
            return_url: input.returnUrl ?? null,
          }),
        }),
      );
      const account = serializeAccount(record(setup.resource) ?? {});
      const nextAction = record(setup.next_action);
      const authorizationUrl = nextAction?.type === "redirect" ? text(nextAction.url) : "";
      return CreateConnectorAccountResultSchema.parse(
        authorizationUrl
          ? { status: "authorize", account, authorization_url: authorizationUrl }
          : { status: "created", account },
      );
    },

    async deleteConnectorAccounts(accountIds: readonly string[]): Promise<void> {
      const proxied = await listProxiedMcpServers();
      const proxiedIds = new Set(proxied.map((item) => text(record(item.tool_group_instance)?.id)));
      await Promise.all(
        accountIds.map((accountId) =>
          requestJson(
            proxiedIds.has(accountId)
              ? `/api/tilde/mcp/proxied-mcp-servers/${encodeURIComponent(accountId)}`
              : `/api/tilde/mcp/tool-group/${encodeURIComponent(accountId)}`,
            { method: "DELETE" },
          ),
        ),
      );
    },

    async setToolAccountForAgent(
      accountId: string,
      agentId: string,
      enabled: boolean,
    ): Promise<void> {
      const server = (await listMcpServers()).find(
        (candidate) => text(candidate.agent_id) === agentId,
      );
      const serverId = text(server?.id);
      if (!serverId) throw new Error("This bot has no Tilde MCP server");
      if (enabled) {
        const result = RecordSchema.parse(
          await requestJson(
            `/api/tilde/mcp/tool-group/${encodeURIComponent(accountId)}/tools/enable-and-bind`,
            {
              method: "POST",
              body: JSON.stringify({
                all_tools: true,
                tool_source_type_ids: [],
                mcp_server_instance_ids: [serverId],
              }),
            },
          ),
        );
        if (result.complete !== true) throw new Error("Tilde could not enable and bind every tool");
        return;
      }
      await requestJson(
        `/api/tilde/mcp/mcp-server/${encodeURIComponent(serverId)}/tool-group/${encodeURIComponent(accountId)}`,
        { method: "DELETE" },
      );
    },

    async setSkillForAgent(skillId: string, agentId: string, enabled: boolean): Promise<void> {
      const [availableSkills, providers, registries] = await Promise.all([
        listSkills(),
        listSkillProviders(),
        listSkillRegistries(),
      ]);
      const registry = registries.find((candidate) => text(candidate.agent_id) === agentId);
      const registryId = text(registry?.id);
      if (!registryId) throw new Error("This bot has no Tilde skill registry");
      const currentIds = records(registry?.skills)
        .map((skill) => text(skill.id))
        .filter(Boolean);
      const trusted = parseTrustedCatalogSkillId(skillId);
      if (trusted) {
        const provider = providers.find((candidate) => text(candidate.id) === trusted.providerId);
        const providerSkill = records(provider?.skills).find(
          (candidate) => text(candidate.id) === trusted.skillId,
        );
        if (!provider || !providerSkill) throw new Error("Unknown skill");
        const materialized = availableSkills.find(
          (candidate) =>
            text(candidate.source_provider_id) === trusted.providerId &&
            text(candidate.source_path) === text(providerSkill.source_path),
        );
        const materializedId = text(materialized?.id);
        if (enabled) {
          if (materializedId && currentIds.includes(materializedId)) return;
          await requestJson(
            `/api/tilde/skill-registry/${encodeURIComponent(registryId)}/provider-skills`,
            {
              method: "POST",
              body: JSON.stringify({
                provider_id: trusted.providerId,
                skill_ids: [trusted.skillId],
              }),
            },
          );
          return;
        }
        if (!materializedId || !currentIds.includes(materializedId)) return;
        await replaceRegistrySkills(
          requestJson,
          registryId,
          currentIds.filter((id) => id !== materializedId),
        );
        return;
      }
      if (!availableSkills.some((candidate) => text(candidate.id) === skillId))
        throw new Error("Unknown skill");
      await replaceRegistrySkills(
        requestJson,
        registryId,
        enabled
          ? [...new Set([...currentIds, skillId])]
          : currentIds.filter((id) => id !== skillId),
      );
    },
  };
}

async function listNativeResources<T extends object>(
  requestJson: RequestJson,
  path: string,
  filters: Readonly<Record<string, string>> = {},
  paginated = true,
): Promise<NativeResource<T>[]> {
  const items: Record<string, unknown>[] = [];
  let nextPageToken: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams(filters);
    if (paginated) query.set("page_size", "100");
    if (nextPageToken) query.set("next_page_token", nextPageToken);
    const response = NativeResourcePageSchema.parse(
      await requestJson(query.size > 0 ? `${path}?${query.toString()}` : path),
    );
    items.push(...response.items);
    if (!paginated || !response.next_page_token) return items as NativeResource<T>[];
    nextPageToken = response.next_page_token;
  }
  throw new Error(`Tilde pagination exceeded 100 pages for ${path}`);
}

async function createManagedConnectorAccount(
  requestJson: RequestJson,
  input: CreateConnectorAccountInput,
) {
  const catalogId = input.providerTypeId.slice("managed_mcp:".length);
  const providers = ManagedProviderPageSchema.parse(
    await requestJson("/api/tilde/mcp/provider-catalog"),
  ).items;
  const provider = providers.find(
    (candidate) =>
      text(candidate.id) === catalogId &&
      (text(candidate.tool_provider_type_id) || `managed_mcp:${text(candidate.id)}`) ===
        input.providerTypeId,
  );
  if (!provider) throw new Error("Unknown managed MCP provider");
  const connectionMethod = text(provider.connection_method);
  if (connectionMethod !== "manual") {
    return managedConnectorResult(
      await requestJson(
        `/api/tilde/mcp/provider-catalog/${encodeURIComponent(catalogId)}/connect`,
        {
          method: "POST",
          body: JSON.stringify({
            display_name: input.displayName,
            return_url: input.returnUrl ?? null,
          }),
        },
      ),
      input.providerTypeId,
    );
  }

  if (text(provider.suggested_auth_mode) === "oauth_authorization_code") {
    const clientId = text(input.resourceServerValues?.client_id);
    const clientSecret = text(input.resourceServerValues?.client_secret);
    if (!clientId || !clientSecret) throw new Error("Client ID and client secret are required");
    return managedConnectorResult(
      {
        status: "authorization_required",
        oauth: await requestJson("/api/tilde/mcp/proxied-mcp-servers/oauth/start", {
          method: "POST",
          body: JSON.stringify({
            catalog_provider_id: catalogId,
            name: input.displayName,
            url: text(provider.endpoint_url),
            auth_uri: text(provider.oauth_authorization_endpoint),
            token_uri: text(provider.oauth_token_endpoint),
            client_id: clientId,
            client_secret: clientSecret,
            scopes: strings(provider.oauth_scopes),
            return_url: input.returnUrl ?? null,
          }),
        }),
      },
      input.providerTypeId,
    );
  }

  const secret = text(input.resourceServerValues?.api_key);
  if (!secret) throw new Error("API key or bearer token is required");
  const session = z
    .object({ tilde: z.object({ team_id: z.string().min(1) }) })
    .parse(await requestJson("/auth/session"));
  const dekAlias = `team:${session.tilde.team_id}:default`;
  const encrypted = await requestJson(
    "/api/tilde/credential/source/api_key/resource-server/encrypt",
    {
      method: "POST",
      body: JSON.stringify({ dek_alias: dekAlias, value: { api_key: secret } }),
    },
  );
  const credential = RecordSchema.parse(
    await requestJson("/api/tilde/credential/source/api_key/resource-server", {
      method: "POST",
      body: JSON.stringify({
        dek_alias: dekAlias,
        resource_server_configuration: encrypted,
        metadata: null,
      }),
    }),
  );
  const credentialId = text(credential.id);
  if (!credentialId) throw new Error("Tilde returned no credential id");
  const connection = await requestJson("/api/tilde/mcp/proxied-mcp-servers", {
    method: "POST",
    body: JSON.stringify({
      catalog_provider_id: catalogId,
      name: input.displayName,
      url: text(provider.endpoint_url),
      auth_mode: text(provider.suggested_auth_mode),
      api_key_location: text(provider.api_key_location) || "header",
      api_key_header_name: text(provider.api_key_header_name) || "Authorization",
      api_key_header_prefix: text(provider.api_key_header_prefix) || null,
      api_key_query_param_name: text(provider.api_key_query_param_name) || "api_key",
      local_running_endpoint: false,
      oauth_scopes: [],
      resource_server_credential_id: credentialId,
      user_credential_id: null,
    }),
  });
  return managedConnectorResult({ status: "connected", connection }, input.providerTypeId);
}

function managedConnectorResult(value: unknown, providerTypeId: string) {
  const result = record(value);
  const source =
    result?.status === "authorization_required" ? record(result.oauth) : record(result?.connection);
  const account = record(source?.tool_group_instance);
  if (!account?.id) throw new Error("Tilde returned no connector account");
  const serialized = { ...serializeAccount(account), provider_type_id: providerTypeId };
  if (result?.status !== "authorization_required")
    return CreateConnectorAccountResultSchema.parse({ status: "created", account: serialized });
  const authorizationUrl = brokerRedirectUrl(source?.broker_response);
  if (!authorizationUrl) throw new Error("Tilde returned no authorization URL");
  return CreateConnectorAccountResultSchema.parse({
    status: "authorize",
    account: serialized,
    authorization_url: authorizationUrl,
  });
}

function brokerRedirectUrl(value: unknown): string | undefined {
  const response = record(value);
  if (response?.type === "redirect") return text(response.url) || undefined;
  const redirect = record(record(response?.action)?.Redirect);
  return text(redirect?.url) || undefined;
}

async function replaceRegistrySkills(
  requestJson: RequestJson,
  registryId: string,
  skillIds: readonly string[],
): Promise<void> {
  await requestJson(`/api/tilde/skill-registry/${encodeURIComponent(registryId)}`, {
    method: "PATCH",
    body: JSON.stringify({ skill_ids: skillIds }),
  });
}

function projectPlugins(
  catalog: TildePluginResources,
  managedProviders: NativeResource<McpProviderCatalogEntry>[],
): PluginsCatalog {
  const agentServers = new Map(
    catalog.mcp_servers.flatMap((server) => {
      const agentId = text(server.agent_id);
      return agentId ? [[agentId, server] as const] : [];
    }),
  );
  const agentRegistries = new Map(
    catalog.skill_registries.flatMap((registry) => {
      const agentId = text(registry.agent_id);
      return agentId ? [[agentId, registry] as const] : [];
    }),
  );
  const agentIds = [...new Set([...agentServers.keys(), ...agentRegistries.keys()])];
  const proxiedSourceIds = new Set(
    catalog.proxied_mcp_servers.map((item) => text(record(item.server)?.tool_group_source_type_id)),
  );
  const tools: PluginsCatalog["tools"] = catalog.tool_providers
    .filter((provider) => !proxiedSourceIds.has(text(provider.type_id)))
    .map((provider) => ({
      provider: serializeProvider(provider),
      accounts: catalog.tool_accounts
        .filter((account) => text(account.tool_group_source_type_id) === text(provider.type_id))
        .map((account) => ({
          ...serializeAccount(account),
          assigned_agent_ids: assignedAgentIds(text(account.id), agentServers),
        })),
    }));

  for (const provider of managedProviders) {
    const providerId = text(provider.tool_provider_type_id) || `managed_mcp:${text(provider.id)}`;
    const connections = catalog.proxied_mcp_servers.filter(
      (item) =>
        text(record(record(item.server)?.endpoint_configuration)?.catalog_provider_id) ===
        text(provider.id),
    );
    tools.push({
      provider: {
        type_id: providerId,
        name: text(provider.name) || text(provider.id),
        documentation: text(provider.description),
        icon_slug: text(provider.id),
        categories: strings(provider.categories),
        credential_sources: [managedCredentialSource(provider)],
      },
      accounts: connections.map((item) => {
        const account = record(item.tool_group_instance) ?? {};
        return {
          ...serializeAccount(account),
          display_name: text(record(item.server)?.display_name) || text(account.id),
          provider_type_id: providerId,
          assigned_agent_ids: assignedAgentIds(text(account.id), agentServers),
        };
      }),
    });
  }

  const unmanagedProxied = new Map<string, Record<string, unknown>[]>();
  for (const item of catalog.proxied_mcp_servers) {
    const endpoint = record(record(item.server)?.endpoint_configuration);
    if (text(endpoint?.catalog_provider_id)) continue;
    const url = normalizedUrl(text(endpoint?.url));
    if (!url) continue;
    const group = unmanagedProxied.get(url) ?? [];
    group.push(item);
    unmanagedProxied.set(url, group);
  }
  for (const [url, items] of unmanagedProxied) {
    const name = proxiedProviderName(url, items, agentIds);
    const providerId = `proxied-mcp:${url}`;
    tools.push({
      provider: {
        type_id: providerId,
        name,
        documentation: url,
        icon_slug: new URL(url).hostname.includes("vercel") ? "vercel" : name,
        categories: ["other"],
        credential_sources: [],
        can_add_account: false,
      },
      accounts: items.map((item) => {
        const account = record(item.tool_group_instance) ?? {};
        return {
          ...serializeAccount(account),
          display_name: text(record(item.server)?.display_name) || text(account.id),
          provider_type_id: providerId,
          assigned_agent_ids: assignedAgentIds(text(account.id), agentServers),
        };
      }),
    });
  }

  return {
    tools,
    skills: serializeSkills(catalog, agentIds, agentRegistries),
  };
}

function serializeSkills(
  catalog: TildePluginResources,
  agentIds: string[],
  agentRegistries: ReadonlyMap<string, Record<string, unknown>>,
) {
  const materializedTrustedIds = new Set<string>();
  const trusted = catalog.skill_providers.map((provider) => ({
    id: text(provider.id),
    name: text(provider.name),
    description: text(provider.description),
    categories: strings(provider.categories).length ? strings(provider.categories) : ["other"],
    icon_key: trustedProviderIconKey(provider),
    skills: records(provider.skills).map((trustedSkill) => {
      const materialized = catalog.skills.find(
        (skill) =>
          text(skill.source_provider_id) === text(provider.id) &&
          text(skill.source_path) === text(trustedSkill.source_path),
      );
      const materializedId = text(materialized?.id);
      if (materializedId) materializedTrustedIds.add(materializedId);
      return {
        id: trustedCatalogSkillId(text(provider.id), text(trustedSkill.id)),
        name: text(trustedSkill.name),
        description: text(trustedSkill.description),
        assigned_agent_ids: materializedId
          ? assignedSkillAgentIds(materializedId, agentRegistries)
          : [],
      };
    }),
  }));

  const grouped = new Map<string, ReturnType<typeof teamSkillProvider>>();
  for (const skill of catalog.skills.filter(
    (candidate) => !materializedTrustedIds.has(text(candidate.id)),
  )) {
    const category = skillCategory(skill);
    const sourceProvider = catalog.tool_providers.find(
      (provider) => text(provider.type_id) === text(skill.source_provider_id),
    );
    const group = grouped.get(category) ?? teamSkillProvider(category, skill, sourceProvider);
    group.skills.push({
      id: text(skill.id),
      name: displaySkillName(text(skill.name), agentIds),
      description: text(skill.description),
      assigned_agent_ids: assignedSkillAgentIds(text(skill.id), agentRegistries),
    });
    grouped.set(category, group);
  }
  return [...trusted, ...grouped.values()];
}

function teamSkillProvider(
  category: string,
  skill: Record<string, unknown>,
  sourceProvider: Record<string, unknown> | undefined,
) {
  const iconUrl = imageUrl(
    skill.icon_url,
    record(skill.metadata)?.icon_url,
    sourceProvider?.icon_url,
  );
  const iconKey = firstText(
    skill.provider_icon_key,
    record(skill.metadata)?.provider_icon_key,
    sourceProvider?.icon_slug,
    skill.source_provider_id,
  );
  return {
    id: `team:${category}`,
    name: category,
    description: `Skills available from ${category}.`,
    categories: [category],
    ...(iconUrl ? { icon_url: iconUrl } : {}),
    ...(iconKey ? { icon_key: iconKey } : {}),
    skills: [] as Array<{
      id: string;
      name: string;
      description: string;
      assigned_agent_ids: string[];
    }>,
  };
}

function serializeProvider(provider: Record<string, unknown>) {
  const metadata = record(provider.metadata);
  const iconUrl = imageUrl(
    provider.icon_url,
    metadata?.icon_url,
    metadata?.logo_url,
    metadata?.icon,
  );
  const iconSlug = firstText(provider.icon_slug, metadata?.icon_slug, metadata?.icon);
  const typeId = text(provider.type_id);
  const categories = strings(provider.categories);
  return {
    type_id: typeId,
    name: text(provider.name) || typeId,
    ...(text(provider.documentation) ? { documentation: text(provider.documentation) } : {}),
    ...(iconUrl ? { icon_url: iconUrl } : {}),
    ...(iconSlug ? { icon_slug: iconSlug } : {}),
    categories:
      systemProvider(typeId, text(provider.name)) || categories.length === 0
        ? [systemProvider(typeId, text(provider.name)) ? "system" : "other"]
        : categories,
    credential_sources: records(provider.credential_sources).map((source) => ({
      type_id: text(source.type_id),
      name: text(source.display_name) || text(source.name) || text(source.type_id),
      ...(text(source.documentation) ? { documentation: text(source.documentation) } : {}),
      requires_brokering: source.requires_brokering === true,
      supports_auto_display_name: source.supports_auto_display_name === true,
      ...(text(source.display_name_description)
        ? { display_name_description: text(source.display_name_description) }
        : {}),
      resource_server_schema: record(source.configuration_schema)?.resource_server ?? null,
      user_credential_schema: record(source.configuration_schema)?.user_credential ?? null,
    })),
  };
}

function managedCredentialSource(provider: Record<string, unknown>) {
  const emptySchema = { type: "object", properties: {}, additionalProperties: false };
  const name = text(provider.name);
  const connectionMethod = text(provider.connection_method);
  if (connectionMethod !== "manual") {
    const oauth = connectionMethod === "oauth_dynamic_client_registration";
    return {
      type_id: oauth ? "managed_mcp_oauth" : "managed_mcp_no_auth",
      name: oauth ? "Sign in with your browser" : "No authentication",
      documentation: oauth
        ? "Sign in with your provider account."
        : "This provider does not require credentials.",
      requires_brokering: oauth,
      supports_auto_display_name: false,
      display_name_description: `A label for this ${name} connection.`,
      resource_server_schema: emptySchema,
      user_credential_schema: emptySchema,
    };
  }
  const oauth = text(provider.suggested_auth_mode) === "oauth_authorization_code";
  const bearer = text(provider.suggested_auth_mode) === "bearer_token";
  const label = bearer ? "Bearer token" : "API key";
  return {
    type_id: oauth ? "oauth_auth_flow" : "api_key",
    name: oauth ? "OAuth application" : label,
    documentation: oauth
      ? "Enter the OAuth application registered with this provider."
      : `Enter the ${label.toLowerCase()} for this provider.`,
    requires_brokering: oauth,
    supports_auto_display_name: false,
    display_name_description: `A label for this ${name} connection.`,
    resource_server_schema: oauth
      ? {
          type: "object",
          properties: {
            client_id: { type: "string", title: "Client ID" },
            client_secret: { type: "string", title: "Client secret", format: "password" },
          },
          required: ["client_id", "client_secret"],
          additionalProperties: false,
        }
      : {
          type: "object",
          properties: { api_key: { type: "string", title: label, format: "password" } },
          required: ["api_key"],
          additionalProperties: false,
        },
    user_credential_schema: emptySchema,
  };
}

function serializeAccount(account: Record<string, unknown>) {
  return {
    id: text(account.id),
    display_name: text(account.display_name) || text(account.id),
    status: text(account.status) || "unknown",
    ...(text(account.tool_group_source_type_id)
      ? { provider_type_id: text(account.tool_group_source_type_id) }
      : {}),
    ...(text(account.credential_source_type_id)
      ? { credential_source_type_id: text(account.credential_source_type_id) }
      : {}),
  };
}

function assignedAgentIds(
  accountId: string,
  agentServers: ReadonlyMap<string, Record<string, unknown>>,
): string[] {
  return [...agentServers].flatMap(([agentId, server]) =>
    records(server.tools).some((tool) => text(tool.tool_group_instance_id) === accountId)
      ? [agentId]
      : [],
  );
}

function assignedSkillAgentIds(
  skillId: string,
  registries: ReadonlyMap<string, Record<string, unknown>>,
): string[] {
  return [...registries].flatMap(([agentId, registry]) =>
    records(registry.skills).some((skill) => text(skill.id) === skillId) ? [agentId] : [],
  );
}

function trustedCatalogSkillId(providerId: string, skillId: string): string {
  return `trusted:${JSON.stringify([providerId, skillId])}`;
}

function parseTrustedCatalogSkillId(
  value: string,
): { providerId: string; skillId: string } | undefined {
  if (!value.startsWith("trusted:")) return undefined;
  try {
    const parsed: unknown = JSON.parse(value.slice("trusted:".length));
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((item) => !text(item)))
      return undefined;
    return { providerId: parsed[0] as string, skillId: parsed[1] as string };
  } catch {
    return undefined;
  }
}

function trustedProviderIconKey(provider: Record<string, unknown>): string {
  const identity = `${text(provider.name)} ${text(provider.repository_url)}`.toLowerCase();
  if (/\baws\b|amazon/.test(identity)) return "aws";
  if (identity.includes("cloudflare")) return "cloudflare";
  return text(provider.name);
}

function skillCategory(skill: Record<string, unknown>): string {
  const value =
    text(skill.category) ||
    text(record(skill.metadata)?.category) ||
    text(skill.source_provider_id) ||
    text(skill.source_kind);
  return value ? displayCategory(value) : "Other";
}

function displaySkillName(name: string, agentIds: readonly string[]): string {
  const owner = agentIds.find((agentId) => name.startsWith(`${agentId}-`));
  return owner ? name.slice(owner.length + 1) : name;
}

function proxiedProviderName(
  url: string,
  items: readonly Record<string, unknown>[],
  agentIds: readonly string[],
): string {
  const inferred = items
    .map((item) => {
      const displayName = text(record(item.server)?.display_name);
      const owner = agentIds.find((agentId) => displayName.startsWith(`OpenBot ${agentId} `));
      return owner ? displayName.slice(`OpenBot ${owner} `.length).trim() : "";
    })
    .filter(Boolean);
  if (inferred[0] && inferred.every((value) => value === inferred[0])) return inferred[0];
  const hostname = new URL(url).hostname;
  return displayCategory(
    hostname.split(".").find((part) => !["api", "mcp", "www"].includes(part)) || hostname,
  );
}

function normalizedUrl(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

const hiddenSystemProviders = new Set([
  "chatkit_internal_agent",
  "message_agent",
  "tilde_browser",
  "tilde_control_plane",
  "tilde_human_approval",
  "tilde_memory",
  "tilde_memory_bank",
  "tilde_skill_registry",
  "tilde_wallet",
  "tilde_wiki",
]);

function systemProvider(id: string, name: string): boolean {
  return hiddenSystemProviders.has(id.toLowerCase()) || name.toLowerCase().startsWith("tilde ");
}

function displayCategory(value: string): string {
  const display = value
    .trim()
    .replaceAll(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return display.toLowerCase() === "openbot" ? "OpenBot" : display;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((item) => (record(item) ? [record(item)!] : [])) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function imageUrl(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string =>
      typeof value === "string" && /^(?:https?:\/\/|data:image\/)/.test(value),
  );
}

function firstText(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && !!value.trim());
}
