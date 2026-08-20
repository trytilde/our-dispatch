import type { Context, Hono } from "hono";

const defaultBaseUrl = "https://api.trytilde.ai";
const defaultDekAlias = "default";

export interface ConnectorRouteOptions {
  apiKey: string;
  orgId: string;
  teamId: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
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
  categories?: string[];
  credential_sources?: UpstreamCredentialSource[];
}

interface UpstreamAccount {
  id: string;
  display_name?: string;
  status?: string;
  tool_group_source_type_id?: string;
  credential_source_type_id?: string;
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
      const accounts = await listAccounts(resolved);
      const filtered = provider
        ? accounts.filter((account) => account.tool_group_source_type_id === provider)
        : accounts;
      return context.json({ items: filtered.map(serializeAccount) });
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
      const providers = await listProviders(resolved);
      const provider = providers.find((candidate) => candidate.type_id === body.providerTypeId);
      const credentialSource = provider?.credential_sources?.find(
        (candidate) => candidate.type_id === body.credentialSourceTypeId,
      );
      if (!provider || !credentialSource)
        return context.json({ error: "Unknown connector provider or credential source" }, 404);

      const resourceServerCredentialId = await maybeCreateCredential(
        resolved,
        credentialSource.type_id,
        "resource-server",
        credentialSource.configuration_schema?.resource_server,
        body.resourceServerValues,
      );
      const userCredentialId = credentialSource.requires_brokering
        ? undefined
        : await maybeCreateCredential(
            resolved,
            credentialSource.type_id,
            "user-credential",
            credentialSource.configuration_schema?.user_credential,
            body.userCredentialValues,
          );

      const account = (await tildeJson(
        resolved,
        `/mcp/available-tool-groups/${encodeURIComponent(body.providerTypeId)}/available-credentials/${encodeURIComponent(body.credentialSourceTypeId)}`,
        {
          display_name: body.displayName,
          resource_server_credential_id: resourceServerCredentialId ?? null,
          user_credential_id: userCredentialId ?? null,
          return_on_successful_brokering: body.returnUrl
            ? { type: "url", url: body.returnUrl }
            : null,
        },
      )) as UpstreamAccount;

      if (!credentialSource.requires_brokering)
        return context.json({ status: "created", account: serializeAccount(account) }, 201);

      const brokered = (await tildeJson(
        resolved,
        `/credential/source/${encodeURIComponent(body.credentialSourceTypeId)}/user-credential/broker`,
        {
          owner_type: "tool_group_instance",
          owner_id: account.id,
          resource_server_credential_id: resourceServerCredentialId ?? null,
        },
      )) as Record<string, unknown>;
      const authorizationUrl = brokerRedirectUrl(brokered);
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
}

interface CreateAccountBody {
  providerTypeId: string;
  credentialSourceTypeId: string;
  displayName: string;
  resourceServerValues?: Record<string, unknown>;
  userCredentialValues?: Record<string, unknown>;
  returnUrl?: string;
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
  const encrypted = await tildeJson(options, `${basePath}/encrypt`, {
    dek_alias: defaultDekAlias,
    value: values,
  });
  const bodyKey =
    kind === "resource-server" ? "resource_server_configuration" : "user_credential_configuration";
  const created = (await tildeJson(options, basePath, {
    dek_alias: defaultDekAlias,
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

async function listProviders(options: ConnectorRouteOptions): Promise<UpstreamProvider[]> {
  const page = (await tildeJson(options, "/mcp/available-tool-groups?page_size=200")) as Record<
    string,
    unknown
  >;
  return pageItems(page) as UpstreamProvider[];
}

async function listAccounts(options: ConnectorRouteOptions): Promise<UpstreamAccount[]> {
  const page = (await tildeJson(options, "/mcp/tool-group?page_size=200")) as Record<
    string,
    unknown
  >;
  return pageItems(page) as UpstreamAccount[];
}

function pageItems(page: Record<string, unknown>): unknown[] {
  if (Array.isArray(page.items)) return page.items;
  if (Array.isArray(page.data)) return page.data;
  if (Array.isArray(page)) return page as unknown[];
  return [];
}

function serializeProvider(provider: UpstreamProvider) {
  return {
    type_id: provider.type_id,
    name: provider.name ?? provider.type_id,
    ...(provider.documentation ? { documentation: provider.documentation } : {}),
    categories: provider.categories ?? [],
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
): Promise<unknown> {
  const url = new URL(
    `/api/v1/team/${encodeURIComponent(options.teamId)}${teamPath}`,
    options.baseUrl ?? defaultBaseUrl,
  );
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-api-key": options.apiKey,
      "x-tilde-org-id": options.orgId,
      "x-tilde-team-id": options.teamId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
