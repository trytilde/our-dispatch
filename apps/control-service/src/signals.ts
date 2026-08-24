import type { Hono } from "hono";
import {
  defaultTildeBaseUrl,
  tildeJson,
  tildeOptionsFromEnvironment,
  tildeUnavailable,
  tildeUnpagedItems,
  tildeUpstreamFailure,
  pageItems,
  text,
  valueRecord,
  type TildeRouteOptions,
} from "./tilde-upstream.js";

export type SignalRouteOptions = TildeRouteOptions;

interface UpstreamSignalType {
  type_id: string;
  name?: string;
  documentation?: string;
  categories?: string[];
  default_session_key_template?: string;
  default_session_title_template?: string | null;
}

interface UpstreamCredentialSource {
  type_id: string;
  name?: string;
  requires_brokering?: boolean;
  display_name_description?: string;
}

interface UpstreamSignalProvider {
  type_id: string;
  name?: string;
  documentation?: string;
  instructions?: string;
  auth_methods?: string[];
  route_descriptors?: Array<{ path?: string }>;
  signal_types?: UpstreamSignalType[];
  credential_sources?: UpstreamCredentialSource[];
  interpolation_variables?: Array<{ key?: string; description?: string; example?: string }>;
  metadata?: Record<string, unknown>;
  webhook_verification?: {
    verification_method?: string;
    requires_signing_key?: boolean;
    signing_key_description?: string | null;
  } | null;
}

interface UpstreamSignalInstance {
  id: string;
  display_name?: string;
  signal_provider_source_type_id?: string;
  status?: string;
  ingress_mode?: string;
  configuration?: Record<string, unknown>;
  polling_state?: Record<string, unknown>;
  poll_interval_seconds?: number | null;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface UpstreamSignalDelivery {
  id: string;
  signal_provider_instance_id?: string;
  signal_type?: string;
  summary?: string | null;
  status?: string;
  chatkit_session_id?: string | null;
  error_message?: string | null;
  matched_rule_ids?: string[];
  created_at?: string;
}

interface CreateInstanceBody {
  providerType: string;
  displayName: string;
  signingSecret?: string;
  credentialSourceTypeId?: string;
  configuration?: Record<string, unknown>;
  ingressMode: string;
}

interface UpdateInstanceBody {
  displayName?: string;
  status?: string;
  signingSecret?: string;
  configuration?: Record<string, unknown>;
}

/**
 * Owner-facing signal provider management: catalog, provider instances with
 * OpenBot-computed webhook URLs and write-only signing secrets, test-fire, and
 * recent deliveries.
 */
export function registerSignalRoutes(app: Hono, configuredOptions?: SignalRouteOptions): void {
  const options = (): SignalRouteOptions | undefined =>
    configuredOptions ?? tildeOptionsFromEnvironment();

  app.get("/api/signals/providers", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Signals");
    try {
      const providers = await listProviders(resolved);
      return context.json({ items: providers.map(serializeProvider) });
    } catch (error) {
      return tildeUpstreamFailure(context, "signals", error);
    }
  });

  app.get("/api/signals/instances", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Signals");
    try {
      const [instances, providers] = await Promise.all([
        tildeUnpagedItems(resolved, "/signals/instances") as Promise<UpstreamSignalInstance[]>,
        listProviders(resolved),
      ]);
      const routes = routePathsByProvider(providers);
      return context.json({
        items: instances.map((instance) => serializeInstance(resolved, instance, routes)),
      });
    } catch (error) {
      return tildeUpstreamFailure(context, "signals", error);
    }
  });

  app.post("/api/signals/instances", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Signals");
    let body: CreateInstanceBody;
    try {
      body = parseCreateInstanceBody(await context.req.json());
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "Invalid body" }, 400);
    }
    try {
      const providers = await listProviders(resolved);
      const provider = providers.find((candidate) => candidate.type_id === body.providerType);
      if (!provider) return context.json({ error: "Unknown signal provider" }, 404);
      const credentialSourceTypeId =
        body.credentialSourceTypeId ??
        provider.credential_sources?.find((source) => source.requires_brokering !== true)?.type_id;
      if (!credentialSourceTypeId)
        return context.json({ error: "credential_source_type_id is required" }, 400);
      const id = `spi_${crypto.randomUUID()}`;
      const configuration = {
        ...body.configuration,
        ...(body.signingSecret ? { provider_webhook_signing_key: body.signingSecret } : {}),
      };
      const instance = (await tildeJson(resolved, "/signals/instances", {
        method: "POST",
        body: {
          id,
          display_name: body.displayName,
          signal_provider_source_type_id: body.providerType,
          credential_source_type_id: credentialSourceTypeId,
          ingress_mode: body.ingressMode,
          configuration,
        },
      })) as UpstreamSignalInstance;
      return context.json(
        serializeInstance(resolved, instance, routePathsByProvider(providers)),
        201,
      );
    } catch (error) {
      return tildeUpstreamFailure(context, "signals", error);
    }
  });

  app.patch("/api/signals/instances/:id", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Signals");
    const id = context.req.param("id");
    let body: UpdateInstanceBody;
    try {
      body = parseUpdateInstanceBody(await context.req.json());
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "Invalid body" }, 400);
    }
    try {
      const existing = (await tildeJson(
        resolved,
        `/signals/instances/${encodeURIComponent(id)}`,
      )) as UpstreamSignalInstance;
      const configuration = {
        ...withoutRedactedValues(body.configuration ?? existing.configuration ?? {}),
        ...(body.signingSecret ? { provider_webhook_signing_key: body.signingSecret } : {}),
      };
      const updated = (await tildeJson(resolved, `/signals/instances/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: {
          display_name: body.displayName ?? existing.display_name ?? id,
          status: body.status ?? existing.status ?? "enabled",
          configuration,
          polling_state: existing.polling_state ?? {},
          ...(existing.poll_interval_seconds != null
            ? { poll_interval_seconds: existing.poll_interval_seconds }
            : {}),
        },
      })) as UpstreamSignalInstance;
      const providers = await listProviders(resolved);
      return context.json(serializeInstance(resolved, updated, routePathsByProvider(providers)));
    } catch (error) {
      return tildeUpstreamFailure(context, "signals", error);
    }
  });

  app.delete("/api/signals/instances/:id", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Signals");
    const id = context.req.param("id");
    try {
      await tildeJson(resolved, `/signals/instances/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      return context.json({ deleted: true });
    } catch (error) {
      return tildeUpstreamFailure(context, "signals", error);
    }
  });

  app.post("/api/signals/instances/:id/test", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Signals");
    const id = context.req.param("id");
    const record = valueRecord(await context.req.json().catch(() => undefined)) ?? {};
    try {
      const response = (await tildeJson(
        resolved,
        `/signals/instances/${encodeURIComponent(id)}/test`,
        {
          method: "POST",
          body: {
            ...(text(record.signal_type) ? { signal_type: text(record.signal_type) } : {}),
            ...(text(record.summary) ? { summary: text(record.summary) } : {}),
            data: record.data ?? {},
          },
        },
      )) as { accepted?: number; delivery_ids?: string[] };
      return context.json({
        accepted: response.accepted ?? 0,
        delivery_ids: response.delivery_ids ?? [],
      });
    } catch (error) {
      return tildeUpstreamFailure(context, "signals", error);
    }
  });

  app.get("/api/signals/deliveries", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Signals");
    const instanceId = context.req.query("instance_id")?.trim();
    if (!instanceId) return context.json({ error: "instance_id is required" }, 400);
    try {
      // Deliveries are display-only run history: one small unpaginated page.
      const page = (await tildeJson(
        resolved,
        `/signals/deliveries?page_size=20&instance_id=${encodeURIComponent(instanceId)}`,
      )) as Record<string, unknown>;
      const deliveries = pageItems(page) as UpstreamSignalDelivery[];
      return context.json({ items: deliveries.map(serializeDelivery) });
    } catch (error) {
      return tildeUpstreamFailure(context, "signals", error);
    }
  });
}

async function listProviders(options: SignalRouteOptions): Promise<UpstreamSignalProvider[]> {
  return (await tildeUnpagedItems(options, "/signals/providers")) as UpstreamSignalProvider[];
}

function serializeProvider(provider: UpstreamSignalProvider) {
  const authMethods = provider.auth_methods ?? [];
  const verification = provider.webhook_verification ?? null;
  const signingKeyDescription =
    verification?.signing_key_description ?? provider.metadata?.signing_key_description;
  return {
    type_id: provider.type_id,
    name: provider.name ?? provider.type_id,
    documentation: provider.documentation ?? "",
    instructions: provider.instructions ?? "",
    auth_methods: authMethods,
    // Only the upstream descriptor knows whether a provider signs its webhooks;
    // webhook capability alone does not imply a signing key.
    requires_signing_key: verification?.requires_signing_key ?? false,
    signing_key_description:
      typeof signingKeyDescription === "string" ? signingKeyDescription : null,
    route_path: provider.route_descriptors?.[0]?.path ?? "",
    signal_types: (provider.signal_types ?? []).map((signalType) => ({
      type_id: signalType.type_id,
      name: signalType.name ?? signalType.type_id,
      documentation: signalType.documentation ?? "",
      categories: signalType.categories ?? [],
      default_session_key_template: signalType.default_session_key_template ?? "",
      default_session_title_template: signalType.default_session_title_template ?? null,
    })),
    credential_sources: (provider.credential_sources ?? []).map((source) => ({
      type_id: source.type_id,
      name: source.name ?? source.type_id,
      requires_brokering: source.requires_brokering ?? false,
      display_name_description: source.display_name_description ?? "",
    })),
    interpolation_variables: (provider.interpolation_variables ?? []).map((variable) => ({
      key: variable.key ?? "",
      description: variable.description ?? "",
      example: variable.example ?? "",
    })),
  };
}

function routePathsByProvider(providers: UpstreamSignalProvider[]): Map<string, string> {
  const routes = new Map<string, string>();
  for (const provider of providers) {
    const path = provider.route_descriptors?.[0]?.path;
    if (typeof path === "string" && path) routes.set(provider.type_id, path);
  }
  return routes;
}

function serializeInstance(
  options: SignalRouteOptions,
  instance: UpstreamSignalInstance,
  routes: Map<string, string>,
) {
  const providerType = instance.signal_provider_source_type_id ?? "";
  const ingressMode = instance.ingress_mode ?? "webhook";
  return {
    id: instance.id,
    display_name: instance.display_name ?? instance.id,
    provider_type: providerType,
    status: instance.status ?? "enabled",
    ingress_mode: ingressMode,
    webhook_url:
      ingressMode === "webhook"
        ? webhookUrl(options, providerType, instance.id, routes.get(providerType))
        : null,
    poll_interval_seconds: instance.poll_interval_seconds ?? null,
    last_error: instance.last_error ?? null,
    created_at: instance.created_at ?? "",
    updated_at: instance.updated_at ?? "",
  };
}

function webhookUrl(
  options: SignalRouteOptions,
  providerType: string,
  instanceId: string,
  routePath: string | undefined,
): string | null {
  if (!providerType || !routePath) return null;
  const base = (options.baseUrl ?? defaultTildeBaseUrl).replace(/\/+$/, "");
  return `${base}/api/v1/webhooks/${providerType}-signals-${instanceId}/${routePath}`;
}

/** Drop upstream-redacted secret placeholders so they never round-trip as values. */
function withoutRedactedValues(configuration: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(configuration).filter(([, value]) => value !== "********"),
  );
}

function serializeDelivery(delivery: UpstreamSignalDelivery) {
  return {
    id: delivery.id,
    instance_id: delivery.signal_provider_instance_id ?? "",
    signal_type: delivery.signal_type ?? "",
    summary: delivery.summary ?? null,
    status: delivery.status ?? "pending",
    session_id: delivery.chatkit_session_id ?? null,
    error_message: delivery.error_message ?? null,
    // Clients filter run history by rule, so the matched rules must survive.
    matched_rule_ids: delivery.matched_rule_ids ?? [],
    created_at: delivery.created_at ?? "",
  };
}

function parseCreateInstanceBody(value: unknown): CreateInstanceBody {
  const record = valueRecord(value);
  if (!record) throw new Error("Invalid signal instance request");
  const providerType = text(record.provider_type);
  const displayName = text(record.display_name);
  if (!providerType || !displayName) throw new Error("provider_type and display_name are required");
  const ingressMode = record.ingress_mode === undefined ? "webhook" : text(record.ingress_mode);
  if (ingressMode !== "webhook") throw new Error('ingress_mode must be "webhook"');
  const signingSecret = text(record.signing_secret);
  const credentialSourceTypeId = text(record.credential_source_type_id);
  return {
    providerType,
    displayName,
    ingressMode,
    ...(signingSecret ? { signingSecret } : {}),
    ...(credentialSourceTypeId ? { credentialSourceTypeId } : {}),
    ...(valueRecord(record.configuration)
      ? { configuration: valueRecord(record.configuration) }
      : {}),
  };
}

function parseUpdateInstanceBody(value: unknown): UpdateInstanceBody {
  const record = valueRecord(value);
  if (!record) throw new Error("Invalid signal instance request");
  const displayName = record.display_name === undefined ? undefined : text(record.display_name);
  if (displayName === "") throw new Error("display_name must not be empty");
  const status = record.status === undefined ? undefined : text(record.status);
  if (status !== undefined && status !== "enabled" && status !== "disabled")
    throw new Error('status must be "enabled" or "disabled"');
  const signingSecret = text(record.signing_secret);
  return {
    ...(displayName !== undefined ? { displayName } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(signingSecret ? { signingSecret } : {}),
    ...(record.configuration !== undefined
      ? { configuration: valueRecord(record.configuration) ?? {} }
      : {}),
  };
}
