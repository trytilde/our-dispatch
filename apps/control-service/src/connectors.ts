import type { Context, Hono } from "hono";

const defaultBaseUrl = "https://api.trytilde.ai";

function teamDefaultDekAlias(teamId: string): string {
  return `team:${teamId}:default`;
}

export interface ConnectorRouteOptions {
  apiKey: string;
  orgId: string;
  teamId: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  environment?: NodeJS.ProcessEnv;
}

interface UpstreamCredentialSource {
  type_id: string;
  name?: string;
  display_name?: string;
  documentation?: string;
  requires_brokering?: boolean;
  supports_auto_display_name?: boolean;
  display_name_description?: string;
  configuration_schema?: { resource_server?: unknown; user_credential?: unknown };
}

interface UpstreamProvider {
  type_id: string;
  name?: string;
  documentation?: string;
  icon_url?: string;
  icon_slug?: string;
  categories?: string[];
  credential_sources?: UpstreamCredentialSource[];
  metadata?: Record<string, unknown>;
  tools?: UpstreamToolSource[];
}

interface UpstreamToolSource {
  type_id: string;
  name?: string;
  documentation?: string;
}

interface UpstreamAccount {
  id: string;
  display_name?: string;
  status?: string;
  tool_group_source_type_id?: string;
  credential_source_type_id?: string;
}

interface UpstreamMappedTool {
  tool_source_type_id: string;
  tool_group_source_type_id: string;
  tool_group_instance_id: string;
}

interface UpstreamMcpServer {
  id: string;
  name?: string;
  tools?: UpstreamMappedTool[];
}

interface UpstreamProxiedMcpServerListItem {
  server: {
    id: string;
    display_name: string;
    endpoint_configuration: unknown;
    status: string;
    tool_group_instance_id: string;
    tool_group_source_type_id: string;
  };
  tool_group_instance: UpstreamAccount;
  tool_count: number;
}

interface UpstreamManagedMcpProvider {
  id: string;
  name: string;
  description: string;
  endpoint_url: string;
  categories: string[];
  connection_method: "manual" | "no_auth" | "oauth_dynamic_client_registration";
  suggested_auth_mode?: "api_key" | "bearer_token" | "oauth_authorization_code" | null;
  api_key_location?: "header" | "query_parameter" | null;
  api_key_header_name?: string | null;
  api_key_header_prefix?: string | null;
  api_key_query_param_name?: string | null;
  oauth_authorization_endpoint?: string | null;
  oauth_token_endpoint?: string | null;
  oauth_scopes?: string[];
  tool_provider_type_id?: string;
}

interface UpstreamSkill {
  id: string;
  name: string;
  description?: string;
  category?: string;
  source_kind?: string;
  source_provider_id?: string;
  source_path?: string;
  icon_url?: string;
  provider_icon_key?: string;
  providerIconKey?: string;
  metadata?: Record<string, unknown>;
}

interface UpstreamTrustedSkill {
  id: string;
  name: string;
  description: string;
  source_path: string;
}

interface UpstreamTrustedSkillProvider {
  id: string;
  name: string;
  description: string;
  categories?: string[];
  repository_url: string;
  trust_status: string;
  skills: UpstreamTrustedSkill[];
}

interface UpstreamSkillRegistry {
  id: string;
  name: string;
  description?: string;
  skills?: UpstreamSkill[];
}

/**
 * Owner-facing connector (Tilde tool-provider) configuration. Keeps credential
 * values on a server-side round trip to Tilde — encrypt, create, broker — so
 * secrets never travel through the chat transcript or reach the agent.
 */
export function registerConnectorRoutes(
  app: Hono,
  configuredOptions?: ConnectorRouteOptions,
): void {
  const options = (): ConnectorRouteOptions | undefined =>
    configuredOptions ?? optionsFromEnvironment();

  // Universal OAuth return target. Tilde redirects the authorization tab here
  // after brokering succeeds; the page carries no state or secrets — clients
  // learn the outcome by polling the account status — so it stays public. The
  // desktop flow lands in the system browser and is bounced to the openbot://
  // deep link, which focuses the app window.
  app.get("/connectors/authorized", (context) => {
    const requested = context.req.query("client");
    const client =
      requested === "electron" || requested === "mobile" ? requested : ("web" as const);
    context.header("cache-control", "no-store");
    return context.html(connectorAuthorizedPage(client));
  });

  app.get("/api/connectors/providers", async (context) => {
    const resolved = options();
    if (!resolved) return unavailable(context);
    try {
      const providers = await listProviders(resolved);
      return context.json({ items: providers.map(serializeProvider) });
    } catch (error) {
      return upstreamFailure(context, error);
    }
  });

  app.get("/api/connectors/accounts", async (context) => {
    const resolved = options();
    if (!resolved) return unavailable(context);
    const provider = context.req.query("provider")?.trim();
    try {
      const managedProviderId = provider ? managedMcpProviderId(provider) : undefined;
      if (managedProviderId) {
        const proxiedServers = await listProxiedMcpServers(resolved, context.req.raw.signal);
        return context.json({
          items: proxiedServers
            .filter((item) => managedMcpCatalogId(item) === managedProviderId)
            .map((item) => ({
              ...serializeAccount(item.tool_group_instance),
              display_name: item.server.display_name,
              provider_type_id: provider,
            })),
        });
      }
      const accounts = await listAccounts(resolved);
      const filtered = provider
        ? accounts.filter((account) => account.tool_group_source_type_id === provider)
        : accounts;
      return context.json({ items: filtered.map(serializeAccount) });
    } catch (error) {
      return upstreamFailure(context, error);
    }
  });

  app.get("/api/connectors/accounts/:id/wait", async (context) => {
    const resolved = options();
    if (!resolved) return unavailable(context);
    try {
      const response = valueRecord(
        await tildeJson(
          resolved,
          `/mcp/tool-group/${encodeURIComponent(context.req.param("id"))}?wait_for_status=active&timeout_ms=30000`,
        ),
      );
      const account = valueRecord(response?.tool_group_instance);
      if (!account?.id)
        throw new ConnectorUpstreamError("Tilde returned no connector account", 502);
      return context.json(serializeAccount(account as unknown as UpstreamAccount));
    } catch (error) {
      return upstreamFailure(context, error);
    }
  });

  app.post("/api/connectors/accounts", async (context) => {
    const resolved = options();
    if (!resolved) return unavailable(context);
    let body: CreateAccountBody;
    try {
      body = parseCreateAccountBody(await context.req.json());
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "Invalid body" }, 400);
    }
    try {
      const managedProviderId = managedMcpProviderId(body.providerTypeId);
      if (managedProviderId) {
        return await createManagedMcpAccount(context, resolved, managedProviderId, body);
      }
      const setup = valueRecord(
        await tildeJson(resolved, "/provider-setup/start", {
          domain: "mcp",
          provider_id: body.providerTypeId,
          auth_method_id: body.credentialSourceTypeId,
          form_values: {
            displayName: body.displayName,
            ...body.resourceServerValues,
            ...body.userCredentialValues,
          },
          return_url: body.returnUrl ?? null,
        }),
      );
      const account = valueRecord(setup?.resource) as UpstreamAccount | undefined;
      if (!account?.id)
        throw new ConnectorUpstreamError("Tilde returned no connector account", 502);
      const nextAction = valueRecord(setup?.next_action);
      const authorizationUrl = nextAction?.type === "redirect" ? text(nextAction.url) : "";
      if (!authorizationUrl)
        return context.json({ status: "created", account: serializeAccount(account) }, 201);
      return context.json(
        {
          status: "authorize",
          account: serializeAccount(account),
          authorization_url: authorizationUrl,
        },
        201,
      );
    } catch (error) {
      return upstreamFailure(context, error);
    }
  });

  app.delete("/api/connectors/accounts", async (context) => {
    const resolved = options();
    if (!resolved) return unavailable(context);
    let accountIds: string[];
    try {
      accountIds = parseDeleteAccountIds(await context.req.json());
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "Invalid body" }, 400);
    }
    try {
      await deleteConnectorAccounts(resolved, accountIds, context.req.raw.signal);
      return context.json({ ok: true });
    } catch (error) {
      return upstreamFailure(context, error);
    }
  });

  app.get("/api/plugins", async (context) => {
    const resolved = options();
    if (!resolved) return unavailable(context);
    const agentIds = [
      ...new Set((context.req.queries("agent_id") ?? []).map((id) => id.trim()).filter(Boolean)),
    ];
    try {
      const [catalog, managedProviders] = await Promise.all([
        listOpenBotPluginsCatalog(resolved, context.req.raw.signal),
        listManagedMcpProviders(resolved, context.req.raw.signal),
      ]);
      const providers = catalog.tool_providers as UpstreamProvider[];
      const accounts = catalog.tool_accounts as UpstreamAccount[];
      const servers = catalog.mcp_servers as UpstreamMcpServer[];
      const proxiedServers = catalog.proxied_mcp_servers as UpstreamProxiedMcpServerListItem[];
      const skills = catalog.skills as UpstreamSkill[];
      const trustedSkillProviders = catalog.skill_providers as UpstreamTrustedSkillProvider[];
      const registries = catalog.skill_registries as UpstreamSkillRegistry[];
      const agentServers = new Map(
        agentIds.map((agentId) => [agentId, resolveMcpServer(resolved, servers, agentId)]),
      );
      const agentRegistries = new Map(
        agentIds.map((agentId) => [agentId, resolveSkillRegistry(resolved, registries, agentId)]),
      );
      return context.json({
        tools: serializeToolsCatalog(
          resolved,
          providers,
          managedProviders,
          accounts,
          proxiedServers,
          agentIds,
          agentServers,
        ),
        skills: serializeSkillsCatalog(
          skills,
          trustedSkillProviders,
          providers,
          agentIds,
          agentRegistries,
        ),
      });
    } catch (error) {
      return upstreamFailure(context, error);
    }
  });

  app.post("/api/plugins/tools/:accountId/agents/:agentId", async (context) => {
    const resolved = options();
    if (!resolved) return unavailable(context);
    try {
      await assignToolAccount(
        resolved,
        context.req.param("accountId"),
        context.req.param("agentId"),
        context.req.raw.signal,
      );
      return context.json({ ok: true });
    } catch (error) {
      return upstreamFailure(context, error);
    }
  });

  app.delete("/api/plugins/tools/:accountId/agents/:agentId", async (context) => {
    const resolved = options();
    if (!resolved) return unavailable(context);
    try {
      await removeToolAccount(
        resolved,
        context.req.param("accountId"),
        context.req.param("agentId"),
        context.req.raw.signal,
      );
      return context.json({ ok: true });
    } catch (error) {
      return upstreamFailure(context, error);
    }
  });

  app.post("/api/plugins/skills/:skillId/agents/:agentId", async (context) => {
    const resolved = options();
    if (!resolved) return unavailable(context);
    try {
      await setSkillAssignment(
        resolved,
        context.req.param("skillId"),
        context.req.param("agentId"),
        true,
        context.req.raw.signal,
      );
      return context.json({ ok: true });
    } catch (error) {
      return upstreamFailure(context, error);
    }
  });

  app.delete("/api/plugins/skills/:skillId/agents/:agentId", async (context) => {
    const resolved = options();
    if (!resolved) return unavailable(context);
    try {
      await setSkillAssignment(
        resolved,
        context.req.param("skillId"),
        context.req.param("agentId"),
        false,
        context.req.raw.signal,
      );
      return context.json({ ok: true });
    } catch (error) {
      return upstreamFailure(context, error);
    }
  });

  app.post("/api/connectors/bind", async (context) => {
    const resolved = options();
    if (!resolved) return unavailable(context);
    const body = valueRecord(await context.req.json().catch(() => undefined));
    const agentId = text(body?.agent_id);
    const accountId = text(body?.account_id);
    if (!agentId || !accountId)
      return context.json({ error: "agent_id and account_id are required" }, 400);
    try {
      await assignToolAccount(resolved, accountId, agentId, context.req.raw.signal);
      return context.json({ bound: true });
    } catch (error) {
      return upstreamFailure(context, error);
    }
  });
}

interface CreateAccountBody {
  providerTypeId: string;
  credentialSourceTypeId: string;
  displayName: string;
  resourceServerValues?: Record<string, unknown>;
  userCredentialValues?: Record<string, unknown>;
  returnUrl?: string;
}

async function createManagedMcpAccount(
  context: Context,
  options: ConnectorRouteOptions,
  providerId: string,
  body: CreateAccountBody,
): Promise<Response> {
  const provider = (await listManagedMcpProviders(options, context.req.raw.signal)).find(
    (candidate) =>
      candidate.id === providerId && managedMcpProviderTypeId(candidate) === body.providerTypeId,
  );
  if (!provider) return context.json({ error: "Unknown managed MCP provider" }, 404);

  if (provider.connection_method !== "manual") {
    const result = (await tildeJson(
      options,
      `/mcp/provider-catalog/${encodeURIComponent(provider.id)}/connect`,
      { display_name: body.displayName, return_url: body.returnUrl ?? null },
      context.req.raw.signal,
    )) as Record<string, unknown>;
    return managedMcpAccountResponse(context, result);
  }

  if (provider.suggested_auth_mode === "oauth_authorization_code") {
    const values = body.resourceServerValues;
    const clientId = text(values?.client_id);
    const clientSecret = text(values?.client_secret);
    if (!clientId || !clientSecret) {
      throw new ConnectorUpstreamError("Client ID and client secret are required", 400);
    }
    const oauth = (await tildeJson(
      options,
      "/mcp/proxied-mcp-servers/oauth/start",
      {
        catalog_provider_id: provider.id,
        name: body.displayName,
        url: provider.endpoint_url,
        auth_uri: provider.oauth_authorization_endpoint,
        token_uri: provider.oauth_token_endpoint,
        client_id: clientId,
        client_secret: clientSecret,
        scopes: provider.oauth_scopes ?? [],
        return_url: body.returnUrl ?? null,
      },
      context.req.raw.signal,
    )) as Record<string, unknown>;
    return managedMcpAuthorizationResponse(context, oauth);
  }

  const credentialSource = managedMcpCredentialSource(provider);
  const resourceServerCredentialId = await maybeCreateCredential(
    options,
    credentialSource.type_id,
    "resource-server",
    credentialSource.configuration_schema?.resource_server,
    body.resourceServerValues,
  );
  const connection = (await tildeJson(
    options,
    "/mcp/proxied-mcp-servers",
    {
      catalog_provider_id: provider.id,
      name: body.displayName,
      url: provider.endpoint_url,
      auth_mode: provider.suggested_auth_mode,
      api_key_location: provider.api_key_location ?? "header",
      api_key_header_name: provider.api_key_header_name ?? "Authorization",
      api_key_header_prefix: provider.api_key_header_prefix ?? null,
      api_key_query_param_name: provider.api_key_query_param_name ?? "api_key",
      local_running_endpoint: false,
      oauth_scopes: [],
      resource_server_credential_id: resourceServerCredentialId ?? null,
      user_credential_id: null,
    },
    context.req.raw.signal,
  )) as Record<string, unknown>;
  return managedMcpCreatedResponse(context, connection);
}

function managedMcpAccountResponse(context: Context, result: Record<string, unknown>): Response {
  if (result.status === "authorization_required" && isRecord(result.oauth)) {
    return managedMcpAuthorizationResponse(context, result.oauth);
  }
  if (result.status === "connected" && isRecord(result.connection)) {
    return managedMcpCreatedResponse(context, result.connection);
  }
  throw new ConnectorUpstreamError("Tilde returned an invalid managed provider response", 502);
}

function managedMcpAuthorizationResponse(
  context: Context,
  oauth: Record<string, unknown>,
): Response {
  const account = valueRecord(oauth.tool_group_instance);
  const broker = valueRecord(oauth.broker_response);
  if (!account || !broker) {
    throw new ConnectorUpstreamError("Tilde returned an invalid OAuth response", 502);
  }
  const authorizationUrl = brokerRedirectUrl(broker);
  if (!authorizationUrl) {
    throw new ConnectorUpstreamError("Tilde returned no authorization URL", 502);
  }
  return context.json(
    {
      status: "authorize",
      account: serializeAccount(account as unknown as UpstreamAccount),
      authorization_url: authorizationUrl,
    },
    201,
  );
}

function managedMcpCreatedResponse(
  context: Context,
  connection: Record<string, unknown>,
): Response {
  const account = valueRecord(connection.tool_group_instance);
  if (!account) throw new ConnectorUpstreamError("Tilde returned no managed provider account", 502);
  return context.json(
    { status: "created", account: serializeAccount(account as unknown as UpstreamAccount) },
    201,
  );
}

function parseCreateAccountBody(value: unknown): CreateAccountBody {
  if (typeof value !== "object" || value === null) throw new Error("Invalid connector request");
  const record = value as Record<string, unknown>;
  const providerTypeId = text(record.provider_type_id);
  const credentialSourceTypeId = text(record.credential_source_type_id);
  const displayName = text(record.display_name);
  if (!providerTypeId || !credentialSourceTypeId || !displayName)
    throw new Error("provider_type_id, credential_source_type_id, and display_name are required");
  const returnUrl = text(record.return_url);
  if (returnUrl && !/^https?:\/\//.test(returnUrl))
    throw new Error("return_url must be an absolute http(s) URL");
  return {
    providerTypeId,
    credentialSourceTypeId,
    displayName,
    resourceServerValues: valueRecord(record.resource_server_values),
    userCredentialValues: valueRecord(record.user_credential_values),
    ...(returnUrl ? { returnUrl } : {}),
  };
}

function parseDeleteAccountIds(value: unknown): string[] {
  const record = valueRecord(value);
  if (!record || !Array.isArray(record.account_ids)) throw new Error("account_ids is required");
  const accountIds = [
    ...new Set(
      record.account_ids.map((accountId) => text(accountId)).filter((accountId) => accountId),
    ),
  ];
  if (accountIds.length === 0) throw new Error("account_ids must contain at least one account");
  return accountIds;
}

async function deleteConnectorAccounts(
  options: ConnectorRouteOptions,
  accountIds: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  const proxiedServers = await listProxiedMcpServers(options, signal);
  const proxiedAccountIds = new Set(
    proxiedServers.map((item) => item.server.tool_group_instance_id),
  );
  await Promise.all(
    accountIds.map((accountId) => {
      const path = proxiedAccountIds.has(accountId)
        ? `/mcp/proxied-mcp-servers/${encodeURIComponent(accountId)}`
        : `/mcp/tool-group/${encodeURIComponent(accountId)}`;
      return tildeRequest(options, path, "DELETE", undefined, signal);
    }),
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function valueRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Encrypt then persist one credential; skipped when its schema declares no fields. */
async function maybeCreateCredential(
  options: ConnectorRouteOptions,
  credentialSourceTypeId: string,
  kind: "resource-server" | "user-credential",
  schema: unknown,
  values: Record<string, unknown> | undefined,
): Promise<string | undefined> {
  if (!schemaHasProperties(schema)) return undefined;
  if (!values || Object.keys(values).length === 0) {
    throw new ConnectorUpstreamError(
      `The ${kind === "resource-server" ? "app" : "account"} credential form is required for this connector`,
      400,
    );
  }
  const basePath = `/credential/source/${encodeURIComponent(credentialSourceTypeId)}/${kind}`;
  const dekAlias = teamDefaultDekAlias(options.teamId);
  const encrypted = await tildeJson(options, `${basePath}/encrypt`, {
    dek_alias: dekAlias,
    value: values,
  });
  const bodyKey =
    kind === "resource-server" ? "resource_server_configuration" : "user_credential_configuration";
  const created = (await tildeJson(options, basePath, {
    dek_alias: dekAlias,
    [bodyKey]: encrypted,
    metadata: null,
  })) as { id?: unknown };
  const id = typeof created.id === "string" ? created.id : undefined;
  if (!id) throw new ConnectorUpstreamError("Tilde returned no credential id", 502);
  return id;
}
export function schemaHasProperties(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  const properties = (schema as { properties?: unknown }).properties;
  return (
    typeof properties === "object" && properties !== null && Object.keys(properties).length > 0
  );
}

export function brokerRedirectUrl(response: Record<string, unknown>): string | undefined {
  if (response.type !== "broker_state") return undefined;
  const action = response.action;
  if (typeof action !== "object" || action === null) return undefined;
  const redirect = (action as { Redirect?: { url?: unknown } }).Redirect;
  return typeof redirect?.url === "string" ? redirect.url : undefined;
}

async function listProviders(
  options: ConnectorRouteOptions,
  signal?: AbortSignal,
): Promise<UpstreamProvider[]> {
  const catalog = valueRecord(
    await tildeJson(options, "/provider-setup/catalog?domain=mcp", undefined, signal),
  );
  const providers = Array.isArray(catalog?.providers)
    ? catalog.providers.map(valueRecord).filter((item): item is Record<string, unknown> => !!item)
    : [];
  return providers.map((provider) => ({
    type_id: text(provider.provider_id),
    name: text(provider.display_name),
    documentation: text(provider.description),
    categories: Array.isArray(provider.categories)
      ? provider.categories.filter((value): value is string => typeof value === "string")
      : [],
    metadata: {
      ...(text(provider.icon_url) ? { icon_url: text(provider.icon_url) } : {}),
      ...(text(provider.icon_slug) ? { icon_slug: text(provider.icon_slug) } : {}),
    },
    credential_sources: (Array.isArray(provider.auth_methods) ? provider.auth_methods : [])
      .map(valueRecord)
      .filter((item): item is Record<string, unknown> => !!item)
      .map((source) => ({
        type_id: text(source.credential_source_type_id) || text(source.id),
        display_name: text(source.display_name),
        documentation: text(source.description),
        requires_brokering: text(source.setup_kind).includes("oauth"),
        supports_auto_display_name: source.supports_auto_display_name === true,
        configuration_schema: {
          resource_server: setupFieldsSchema(source.fields),
          user_credential: null,
        },
      })),
  }));
}

async function listOpenBotPluginsCatalog(
  options: ConnectorRouteOptions,
  signal?: AbortSignal,
): Promise<{
  tool_providers: unknown[];
  tool_accounts: unknown[];
  mcp_servers: unknown[];
  proxied_mcp_servers: unknown[];
  skills: unknown[];
  skill_providers: unknown[];
  skill_registries: unknown[];
}> {
  return (await tildeJson(options, "/openbot/plugins/catalog", undefined, signal)) as {
    tool_providers: unknown[];
    tool_accounts: unknown[];
    mcp_servers: unknown[];
    proxied_mcp_servers: unknown[];
    skills: unknown[];
    skill_providers: unknown[];
    skill_registries: unknown[];
  };
}

async function listManagedMcpProviders(
  options: ConnectorRouteOptions,
  signal?: AbortSignal,
): Promise<UpstreamManagedMcpProvider[]> {
  const page = (await tildeJson(options, "/mcp/provider-catalog", undefined, signal)) as Record<
    string,
    unknown
  >;
  return pageItems(page) as UpstreamManagedMcpProvider[];
}

async function listAccounts(
  options: ConnectorRouteOptions,
  signal?: AbortSignal,
): Promise<UpstreamAccount[]> {
  const catalog = valueRecord(
    await tildeJson(options, "/provider-setup/catalog?domain=mcp", undefined, signal),
  );
  return (Array.isArray(catalog?.resources) ? catalog.resources : [])
    .map(valueRecord)
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item) => item as unknown as UpstreamAccount);
}

function setupFieldsSchema(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const fields = value.map(valueRecord).filter((item): item is Record<string, unknown> => !!item);
  return {
    type: "object",
    properties: Object.fromEntries(
      fields.map((field) => [
        text(field.name),
        {
          type: "string",
          title: text(field.label) || text(field.name),
          ...(text(field.help_text) ? { description: text(field.help_text) } : {}),
          ...(text(field.field_type) === "password" ? { format: "password" } : {}),
        },
      ]),
    ),
    required: fields.filter((field) => field.required === true).map((field) => text(field.name)),
  };
}

async function listProxiedMcpServers(
  options: ConnectorRouteOptions,
  signal?: AbortSignal,
): Promise<UpstreamProxiedMcpServerListItem[]> {
  const page = (await tildeJson(
    options,
    "/mcp/proxied-mcp-servers?page_size=500&include_catalog_managed=true",
    undefined,
    signal,
  )) as Record<string, unknown>;
  return pageItems(page) as UpstreamProxiedMcpServerListItem[];
}

async function listSkills(
  options: ConnectorRouteOptions,
  signal?: AbortSignal,
): Promise<UpstreamSkill[]> {
  const page = (await tildeJson(options, "/skill?page_size=500", undefined, signal)) as Record<
    string,
    unknown
  >;
  return pageItems(page) as UpstreamSkill[];
}

async function listTrustedSkillProviders(
  options: ConnectorRouteOptions,
  signal?: AbortSignal,
): Promise<UpstreamTrustedSkillProvider[]> {
  const response = (await tildeJson(options, "/skill-providers", undefined, signal)) as Record<
    string,
    unknown
  >;
  return pageItems(response) as UpstreamTrustedSkillProvider[];
}

async function listSkillRegistries(
  options: ConnectorRouteOptions,
  signal?: AbortSignal,
): Promise<UpstreamSkillRegistry[]> {
  const page = (await tildeJson(
    options,
    "/skill-registry?page_size=500",
    undefined,
    signal,
  )) as Record<string, unknown>;
  return pageItems(page) as UpstreamSkillRegistry[];
}

function agentEnvironmentPrefix(agentId: string): string {
  return `AGENT_${agentId.replaceAll("-", "_").toUpperCase()}`;
}

function resolveMcpServer(
  options: ConnectorRouteOptions,
  servers: readonly UpstreamMcpServer[],
  agentId: string,
): UpstreamMcpServer | undefined {
  const configured = (options.environment ?? process.env)[
    `${agentEnvironmentPrefix(agentId)}_MCP_SERVER_ID`
  ]?.trim();
  return servers.find((server) => server.id === (configured || `openbot-${agentId}`));
}

function resolveSkillRegistry(
  options: ConnectorRouteOptions,
  registries: readonly UpstreamSkillRegistry[],
  agentId: string,
): UpstreamSkillRegistry | undefined {
  const configured = (options.environment ?? process.env)[
    `${agentEnvironmentPrefix(agentId)}_SKILL_REGISTRY_ID`
  ]?.trim();
  return registries.find(
    (registry) =>
      registry.id === configured || (!configured && registry.name === `OpenBot ${agentId}`),
  );
}

function displaySkillName(name: string, agentIds: readonly string[]): string {
  const owner = agentIds.find((agentId) => name.startsWith(`${agentId}-`));
  return owner ? name.slice(owner.length + 1) : name;
}

function serializeToolsCatalog(
  options: ConnectorRouteOptions,
  providers: readonly UpstreamProvider[],
  managedProviders: readonly UpstreamManagedMcpProvider[],
  accounts: readonly UpstreamAccount[],
  proxiedServers: readonly UpstreamProxiedMcpServerListItem[],
  agentIds: readonly string[],
  agentServers: ReadonlyMap<string, UpstreamMcpServer | undefined>,
) {
  const proxiedSourceIds = new Set(
    proxiedServers.map((item) => item.server.tool_group_source_type_id),
  );
  const toolkitProviders = providers
    .filter((provider) => !proxiedSourceIds.has(provider.type_id))
    .map((provider) => ({
      provider: serializeProvider(provider),
      accounts: accounts
        .filter((account) => account.tool_group_source_type_id === provider.type_id)
        .map((account) => ({
          ...serializeAccount(account),
          assigned_agent_ids: assignedAgentIds(account.id, agentIds, agentServers),
        })),
    }));
  const managedMcpProviders = managedProviders.map((provider) => {
    const providerId = managedMcpProviderTypeId(provider);
    const connections = proxiedServers.filter((item) => managedMcpCatalogId(item) === provider.id);
    return {
      provider: serializeProvider(managedMcpProviderSource(provider)),
      accounts: connections.map((item) => ({
        ...serializeAccount(item.tool_group_instance),
        display_name: item.server.display_name,
        provider_type_id: providerId,
        assigned_agent_ids: assignedAgentIds(item.tool_group_instance.id, agentIds, agentServers),
      })),
    };
  });
  const groups = new Map<string, UpstreamProxiedMcpServerListItem[]>();
  for (const item of proxiedServers) {
    if (managedMcpCatalogId(item)) continue;
    const url = proxiedMcpUrl(item);
    if (!url) continue;
    const group = groups.get(url) ?? [];
    group.push(item);
    groups.set(url, group);
  }
  const proxiedProviders = [...groups].map(([url, items]) => {
    const name = proxiedMcpProviderName(url, items, agentIds);
    const providerId = `proxied-mcp:${url}`;
    return {
      provider: {
        type_id: providerId,
        name,
        documentation: url,
        icon_slug: proxiedMcpIconKey(url, name),
        categories: ["other"],
        credential_sources: [],
        can_add_account: false,
      },
      accounts: items.map((item) => ({
        ...serializeAccount(item.tool_group_instance),
        display_name: item.server.display_name,
        provider_type_id: providerId,
        assigned_agent_ids: agentIds.filter(
          (agentId) =>
            assignedAgentIds(item.tool_group_instance.id, [agentId], agentServers).length > 0 ||
            configuredProxiedServerId(options, agentId) === item.tool_group_instance.id,
        ),
      })),
    };
  });
  return [...toolkitProviders, ...managedMcpProviders, ...proxiedProviders];
}

const managedMcpPrefix = "managed_mcp:";

function managedMcpProviderTypeId(provider: UpstreamManagedMcpProvider): string {
  return provider.tool_provider_type_id || `${managedMcpPrefix}${provider.id}`;
}

function managedMcpProviderId(typeId: string): string | undefined {
  return typeId.startsWith(managedMcpPrefix) ? typeId.slice(managedMcpPrefix.length) : undefined;
}

function managedMcpCatalogId(item: UpstreamProxiedMcpServerListItem): string | undefined {
  if (!isRecord(item.server.endpoint_configuration)) return undefined;
  return firstText(item.server.endpoint_configuration.catalog_provider_id);
}

function managedMcpProviderSource(provider: UpstreamManagedMcpProvider): UpstreamProvider {
  return {
    type_id: managedMcpProviderTypeId(provider),
    name: provider.name,
    documentation: provider.description,
    icon_slug: provider.id,
    categories: provider.categories,
    credential_sources: [managedMcpCredentialSource(provider)],
  };
}

function managedMcpCredentialSource(
  provider: UpstreamManagedMcpProvider,
): UpstreamCredentialSource {
  const emptySchema = { type: "object", properties: {}, additionalProperties: false };
  if (provider.connection_method !== "manual") {
    const oauth = provider.connection_method === "oauth_dynamic_client_registration";
    return {
      type_id: oauth ? "managed_mcp_oauth" : "managed_mcp_no_auth",
      display_name: oauth ? "Sign in with your browser" : "No authentication",
      documentation: oauth
        ? "Sign in with your provider account."
        : "This provider does not require credentials.",
      requires_brokering: oauth,
      supports_auto_display_name: false,
      display_name_description: `A label for this ${provider.name} connection.`,
      configuration_schema: { resource_server: emptySchema, user_credential: emptySchema },
    };
  }

  if (provider.suggested_auth_mode === "oauth_authorization_code") {
    return {
      type_id: "oauth_auth_flow",
      display_name: "OAuth application",
      documentation: "Enter the OAuth application registered with this provider.",
      requires_brokering: true,
      supports_auto_display_name: false,
      display_name_description: `A label for this ${provider.name} connection.`,
      configuration_schema: {
        resource_server: {
          type: "object",
          properties: {
            client_id: { type: "string", title: "Client ID" },
            client_secret: { type: "string", title: "Client secret", format: "password" },
          },
          required: ["client_id", "client_secret"],
          additionalProperties: false,
        },
        user_credential: emptySchema,
      },
    };
  }

  const bearer = provider.suggested_auth_mode === "bearer_token";
  const label = bearer ? "Bearer token" : "API key";
  return {
    type_id: "api_key",
    display_name: label,
    documentation: `Enter the ${label.toLowerCase()} for this provider.`,
    requires_brokering: false,
    supports_auto_display_name: false,
    display_name_description: `A label for this ${provider.name} connection.`,
    configuration_schema: {
      resource_server: {
        type: "object",
        properties: { api_key: { type: "string", title: label, format: "password" } },
        required: ["api_key"],
        additionalProperties: false,
      },
      user_credential: emptySchema,
    },
  };
}

function assignedAgentIds(
  accountId: string,
  agentIds: readonly string[],
  agentServers: ReadonlyMap<string, UpstreamMcpServer | undefined>,
): string[] {
  return agentIds.filter((agentId) =>
    agentServers.get(agentId)?.tools?.some((tool) => tool.tool_group_instance_id === accountId),
  );
}

function configuredProxiedServerId(
  options: ConnectorRouteOptions,
  agentId: string,
): string | undefined {
  return (options.environment ?? process.env)[
    `${agentEnvironmentPrefix(agentId)}_VERCEL_MCP_SERVER_ID`
  ]?.trim();
}

function proxiedMcpUrl(item: UpstreamProxiedMcpServerListItem): string | undefined {
  if (!isRecord(item.server.endpoint_configuration)) return undefined;
  const value = item.server.endpoint_configuration.url;
  if (typeof value !== "string" || !value.trim()) return undefined;
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

function proxiedMcpProviderName(
  url: string,
  items: readonly UpstreamProxiedMcpServerListItem[],
  agentIds: readonly string[],
): string {
  const inferred = items
    .map((item) => {
      const owner = agentIds.find((agentId) =>
        item.server.display_name.startsWith(`OpenBot ${agentId} `),
      );
      return owner ? item.server.display_name.slice(`OpenBot ${owner} `.length).trim() : undefined;
    })
    .filter((value): value is string => Boolean(value));
  const firstInferred = inferred[0];
  if (firstInferred && inferred.every((value) => value === firstInferred)) return firstInferred;
  const hostname = new URL(url).hostname;
  const label = hostname
    .split(".")
    .find((part) => !["api", "mcp", "www"].includes(part.toLowerCase()));
  return displayCategory(label || hostname);
}

function proxiedMcpIconKey(url: string, name: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.includes("vercel")) return "vercel";
  return name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeSkillsCatalog(
  skills: readonly UpstreamSkill[],
  trustedProviders: readonly UpstreamTrustedSkillProvider[],
  toolProviders: readonly UpstreamProvider[],
  agentIds: readonly string[],
  agentRegistries: ReadonlyMap<string, UpstreamSkillRegistry | undefined>,
) {
  const materializedTrustedSkillIds = new Set<string>();
  const trustedSkillProviders = trustedProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    description: provider.description,
    categories: provider.categories?.length ? provider.categories : ["other"],
    icon_key: trustedProviderIconKey(provider),
    skills: provider.skills.map((trustedSkill) => {
      const materialized = findMaterializedTrustedSkill(
        skills,
        provider.id,
        trustedSkill.source_path,
      );
      if (materialized) materializedTrustedSkillIds.add(materialized.id);
      return {
        id: trustedCatalogSkillId(provider.id, trustedSkill.id),
        name: trustedSkill.name,
        description: trustedSkill.description,
        assigned_agent_ids: materialized
          ? agentIds.filter((agentId) =>
              agentRegistries
                .get(agentId)
                ?.skills?.some((candidate) => candidate.id === materialized.id),
            )
          : [],
      };
    }),
  }));
  const teamSkills = skills
    .filter((skill) => !materializedTrustedSkillIds.has(skill.id))
    .map((skill) => {
      const sourceProvider = toolProviders.find(
        (provider) => provider.type_id === skill.source_provider_id,
      );
      const iconUrl = skillIconUrl(skill) ?? (sourceProvider && providerIconUrl(sourceProvider));
      const iconKey = skillIconKey(skill) ?? (sourceProvider && providerIconKey(sourceProvider));
      return {
        id: skill.id,
        name: displaySkillName(skill.name, agentIds),
        description: skill.description ?? "",
        provider: skillCategory(skill),
        ...(iconUrl ? { iconUrl } : {}),
        ...(iconKey ? { iconKey } : {}),
        assigned_agent_ids: agentIds.filter((agentId) =>
          agentRegistries.get(agentId)?.skills?.some((candidate) => candidate.id === skill.id),
        ),
      };
    });
  const teamSkillProviders = new Map<
    string,
    {
      id: string;
      name: string;
      description: string;
      categories: string[];
      icon_url?: string;
      icon_key?: string;
      skills: { id: string; name: string; description: string; assigned_agent_ids: string[] }[];
    }
  >();
  for (const skill of teamSkills) {
    const existing = teamSkillProviders.get(skill.provider);
    if (existing) {
      existing.skills.push(skill);
      continue;
    }
    teamSkillProviders.set(skill.provider, {
      id: `team:${skill.provider}`,
      name: skill.provider,
      description: `Skills available from ${skill.provider}.`,
      categories: [skill.provider],
      ...(skill.iconUrl ? { icon_url: skill.iconUrl } : {}),
      ...(skill.iconKey ? { icon_key: skill.iconKey } : {}),
      skills: [skill],
    });
  }
  return [...trustedSkillProviders, ...teamSkillProviders.values()];
}

function findMaterializedTrustedSkill(
  skills: readonly UpstreamSkill[],
  providerId: string,
  sourcePath: string,
): UpstreamSkill | undefined {
  return skills.find(
    (skill) => skill.source_provider_id === providerId && skill.source_path === sourcePath,
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
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      parsed.some((item) => typeof item !== "string" || item.length === 0)
    )
      return undefined;
    return { providerId: parsed[0] as string, skillId: parsed[1] as string };
  } catch {
    return undefined;
  }
}

function trustedProviderIconKey(provider: UpstreamTrustedSkillProvider): string {
  const identity = `${provider.name} ${provider.repository_url}`.toLowerCase();
  if (/\baws\b|amazon/.test(identity)) return "aws";
  if (identity.includes("cloudflare")) return "cloudflare";
  return provider.name;
}

async function assignToolAccount(
  options: ConnectorRouteOptions,
  accountId: string,
  agentId: string,
  signal?: AbortSignal,
): Promise<void> {
  const serverId =
    (options.environment ?? process.env)[
      `${agentEnvironmentPrefix(agentId)}_MCP_SERVER_ID`
    ]?.trim() || `openbot-${agentId}`;

  const result = await tildeRequest(
    options,
    `/mcp/tool-group/${encodeURIComponent(accountId)}/tools/enable-and-bind`,
    "POST",
    {
      all_tools: true,
      tool_source_type_ids: [],
      mcp_server_instance_ids: [serverId],
    },
    signal,
  );
  if (
    typeof result !== "object" ||
    result === null ||
    (result as { complete?: unknown }).complete !== true
  ) {
    throw new ConnectorUpstreamError("Tilde could not enable and bind every tool", 502);
  }
}

async function removeToolAccount(
  options: ConnectorRouteOptions,
  accountId: string,
  agentId: string,
  signal?: AbortSignal,
): Promise<void> {
  const serverId =
    (options.environment ?? process.env)[
      `${agentEnvironmentPrefix(agentId)}_MCP_SERVER_ID`
    ]?.trim() || `openbot-${agentId}`;
  await tildeRequest(
    options,
    `/mcp/mcp-server/${encodeURIComponent(serverId)}/tool-group/${encodeURIComponent(accountId)}`,
    "DELETE",
    undefined,
    signal,
  );
}

async function setSkillAssignment(
  options: ConnectorRouteOptions,
  skillId: string,
  agentId: string,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const [skills, trustedSkillProviders, registries] = await Promise.all([
    listSkills(options, signal),
    listTrustedSkillProviders(options, signal),
    listSkillRegistries(options, signal),
  ]);
  const registry = resolveSkillRegistry(options, registries, agentId);
  if (!registry) throw new ConnectorUpstreamError("This bot has no Tilde skill registry", 404);
  const currentIds = (registry.skills ?? []).map((skill) => skill.id);
  const trustedReference = parseTrustedCatalogSkillId(skillId);
  if (trustedReference) {
    const provider = trustedSkillProviders.find(
      (candidate) => candidate.id === trustedReference.providerId,
    );
    const trustedSkill = provider?.skills.find(
      (candidate) => candidate.id === trustedReference.skillId,
    );
    if (!provider || !trustedSkill) throw new ConnectorUpstreamError("Unknown skill", 404);
    const materialized = findMaterializedTrustedSkill(
      skills,
      provider.id,
      trustedSkill.source_path,
    );
    if (enabled) {
      if (materialized && currentIds.includes(materialized.id)) return;
      await tildeRequest(
        options,
        `/skill-registry/${encodeURIComponent(registry.id)}/provider-skills`,
        "POST",
        { provider_id: provider.id, skill_ids: [trustedSkill.id] },
        signal,
      );
      return;
    }
    if (!materialized || !currentIds.includes(materialized.id)) return;
    await replaceRegistrySkills(
      options,
      registry.id,
      currentIds.filter((id) => id !== materialized.id),
      signal,
    );
    return;
  }
  if (!skills.some((skill) => skill.id === skillId))
    throw new ConnectorUpstreamError("Unknown skill", 404);
  const skillIds = enabled
    ? [...new Set([...currentIds, skillId])]
    : currentIds.filter((id) => id !== skillId);
  await replaceRegistrySkills(options, registry.id, skillIds, signal);
}

async function replaceRegistrySkills(
  options: ConnectorRouteOptions,
  registryId: string,
  skillIds: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  await tildeRequest(
    options,
    `/skill-registry/${encodeURIComponent(registryId)}`,
    "PATCH",
    { skill_ids: skillIds },
    signal,
  );
}

function pageItems(page: Record<string, unknown>): unknown[] {
  if (Array.isArray(page.items)) return page.items;
  if (Array.isArray(page.data)) return page.data;
  if (Array.isArray(page)) return page as unknown[];
  return [];
}

function serializeProvider(provider: UpstreamProvider) {
  const iconUrl = providerIconUrl(provider);
  const iconSlug = providerIconKey(provider);
  return {
    type_id: provider.type_id,
    name: provider.name ?? provider.type_id,
    ...(provider.documentation ? { documentation: provider.documentation } : {}),
    // Provider branding straight from Tilde catalog metadata.
    ...(iconUrl ? { icon_url: iconUrl } : {}),
    ...(iconSlug ? { icon_slug: iconSlug } : {}),
    categories: toolProviderCategories(provider),
    credential_sources: (provider.credential_sources ?? []).map((source) => ({
      type_id: source.type_id,
      name: source.display_name || source.name || source.type_id,
      ...(source.documentation ? { documentation: source.documentation } : {}),
      requires_brokering: source.requires_brokering ?? false,
      supports_auto_display_name: source.supports_auto_display_name ?? false,
      ...(source.display_name_description
        ? { display_name_description: source.display_name_description }
        : {}),
      resource_server_schema: source.configuration_schema?.resource_server ?? null,
      user_credential_schema: source.configuration_schema?.user_credential ?? null,
    })),
  };
}

const otherToolCategoryIds = new Set([
  "custom",
  "custom_tool",
  "custom_tools",
  "custom_tool_provider",
  "proxied_mcp",
  "proxied_mcp_server",
]);

function toolProviderCategories(provider: UpstreamProvider): string[] {
  if (systemToolProvider(provider)) return ["system"];
  const categories = provider.categories ?? [];
  const isCustomProvider = provider.type_id.startsWith("custom_tool_provider:");
  const belongsInOther = categories.some((category) =>
    otherToolCategoryIds.has(
      category
        .trim()
        .toLowerCase()
        .replaceAll(/[\s-]+/g, "_"),
    ),
  );
  return isCustomProvider || belongsInOther || categories.length === 0 ? ["other"] : categories;
}

const hiddenSystemProviderIds = new Set([
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
const hiddenSystemProviderNames = new Set([
  "message agent",
  "message internal agent",
  "tilde browser",
  "tilde control plane",
  "tilde human approval",
  "tilde memory bank",
  "tilde skill registry",
  "tilde pay",
  "tilde wiki",
]);

function systemToolProvider(provider: UpstreamProvider): boolean {
  const id = provider.type_id.toLowerCase();
  return (
    hiddenSystemProviderIds.has(id) ||
    hiddenSystemProviderNames.has((provider.name ?? "").trim().toLowerCase())
  );
}

function providerIconUrl(provider: UpstreamProvider): string | undefined {
  return imageUrl(
    provider.icon_url,
    provider.metadata?.icon_url,
    provider.metadata?.iconUrl,
    provider.metadata?.logo_url,
    provider.metadata?.logoUrl,
    provider.metadata?.icon,
  );
}

function providerIconKey(provider: UpstreamProvider): string | undefined {
  return firstText(
    provider.icon_slug,
    provider.metadata?.icon_slug,
    provider.metadata?.iconSlug,
    provider.metadata?.icon,
  );
}

function skillIconUrl(skill: UpstreamSkill): string | undefined {
  return imageUrl(
    skill.icon_url,
    skill.metadata?.icon_url,
    skill.metadata?.iconUrl,
    skill.metadata?.logo_url,
    skill.metadata?.logoUrl,
  );
}

function skillIconKey(skill: UpstreamSkill): string | undefined {
  return firstText(
    skill.provider_icon_key,
    skill.providerIconKey,
    skill.metadata?.provider_icon_key,
    skill.metadata?.providerIconKey,
    skill.metadata?.icon_slug,
    skill.metadata?.iconSlug,
    skill.source_provider_id,
  );
}

function imageUrl(...candidates: unknown[]): string | undefined {
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && /^(?:https?:\/\/|data:image\/)/.test(candidate),
  );
}

function firstText(...candidates: unknown[]): string | undefined {
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
}

function skillCategory(skill: UpstreamSkill): string {
  const metadataCategory = skill.metadata?.category;
  const category =
    skill.category ||
    (typeof metadataCategory === "string" ? metadataCategory : undefined) ||
    skill.source_provider_id ||
    skill.source_kind;
  const display = category ? displayCategory(category) : "";
  return display || "Other";
}

function displayCategory(value: string): string {
  const display = value
    .trim()
    .replaceAll(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return display.toLowerCase() === "openbot" ? "OpenBot" : display;
}

function serializeAccount(account: UpstreamAccount) {
  return {
    id: account.id,
    display_name: account.display_name ?? account.id,
    status: account.status ?? "unknown",
    ...(account.tool_group_source_type_id
      ? { provider_type_id: account.tool_group_source_type_id }
      : {}),
    ...(account.credential_source_type_id
      ? { credential_source_type_id: account.credential_source_type_id }
      : {}),
  };
}

class ConnectorUpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function tildeJson(
  options: ConnectorRouteOptions,
  teamPath: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return tildeRequest(options, teamPath, body === undefined ? "GET" : "POST", body, signal);
}

async function tildeRequest(
  options: ConnectorRouteOptions,
  teamPath: string,
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = new URL(
    `/api/v1/team/${encodeURIComponent(options.teamId)}${teamPath}`,
    options.baseUrl ?? defaultBaseUrl,
  );
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method,
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-api-key": options.apiKey,
      "x-tilde-org-id": options.orgId,
      "x-tilde-team-id": options.teamId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null
        ? ((payload as { error?: string; message?: string }).error ??
          (payload as { message?: string }).message)
        : undefined;
    throw new ConnectorUpstreamError(
      detail ?? `Tilde connector request failed (${response.status})`,
      response.status >= 500 ? 502 : response.status,
    );
  }
  return payload;
}

function unavailable(context: Context): Response {
  return context.json(
    { error: "Connectors are unavailable because Tilde server credentials are not configured" },
    503,
  );
}

function upstreamFailure(context: Context, error: unknown): Response {
  if (error instanceof ConnectorUpstreamError)
    return context.json({ error: error.message }, error.status as 400);
  return context.json(
    {
      error: "Tilde connector request failed",
      detail: error instanceof Error ? error.message : "Unknown upstream failure",
    },
    502,
  );
}

function connectorAuthorizedPage(client: "electron" | "mobile" | "web"): string {
  // The desktop and mobile apps both register the openbot:// scheme; bouncing
  // to it brings the app forward while its dialog polls the account status.
  const deepLinked = client === "electron" || client === "mobile";
  const hint = deepLinked
    ? "Returning you to OpenBot… If nothing happens, switch back to the OpenBot app."
    : "You can close this tab and return to OpenBot.";
  const redirect = deepLinked
    ? '<script>setTimeout(function () { location.replace("openbot://connectors/authorized"); }, 150);</script>'
    : "";
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8" /><title>OpenBot</title>',
    "<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#171718;background:#fafafb}main{text-align:center;max-width:26rem}h1{font-size:1.1rem}p{color:#666;font-size:.9rem}</style>",
    "</head><body><main>",
    "<h1>Authorization complete</h1>",
    `<p>${hint}</p>`,
    "</main>",
    redirect,
    "</body></html>",
  ].join("");
}

function optionsFromEnvironment(): ConnectorRouteOptions | undefined {
  const apiKey = process.env.TILDE_API_KEY?.trim();
  const orgId = process.env.TILDE_ORG_ID?.trim();
  const teamId = process.env.TILDE_TEAM_ID?.trim();
  if (!apiKey || !orgId || !teamId) return undefined;
  return {
    apiKey,
    orgId,
    teamId,
    baseUrl: process.env.TILDE_BASE_URL?.trim() || undefined,
  };
}
