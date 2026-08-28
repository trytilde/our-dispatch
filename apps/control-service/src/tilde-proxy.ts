import type { Context, Hono } from "hono";

const defaultTildeBaseUrl = "https://api.trytilde.ai";

const proxyPrefix = "/api/tilde/";
const hopByHopHeaders = new Set([
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type AllowedMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface AllowedRoute {
  methods: ReadonlySet<AllowedMethod>;
  pattern: RegExp;
}

const methods = (...values: AllowedMethod[]): ReadonlySet<AllowedMethod> => new Set(values);

/**
 * Owner-facing Tilde resources that OpenBot renders but does not own. This is
 * deliberately an operation allowlist rather than an unrestricted API proxy.
 */
const allowedRoutes: readonly AllowedRoute[] = [
  { pattern: /^openbot\/plugins\/catalog$/, methods: methods("GET") },
  { pattern: /^provider-setup\/catalog$/, methods: methods("GET") },
  { pattern: /^provider-setup\/start$/, methods: methods("POST") },
  { pattern: /^provider-setup\/[^/]+\/resume$/, methods: methods("POST") },
  { pattern: /^automations$/, methods: methods("GET") },
  { pattern: /^automations\/[^/]+$/, methods: methods("GET", "PUT", "DELETE") },
  { pattern: /^automations\/[^/]+\/run$/, methods: methods("POST") },
  { pattern: /^signals\/providers$/, methods: methods("GET") },
  { pattern: /^signals\/instances$/, methods: methods("GET", "POST") },
  { pattern: /^signals\/instances\/[^/]+$/, methods: methods("GET", "PATCH", "DELETE") },
  { pattern: /^signals\/instances\/[^/]+\/test$/, methods: methods("POST") },
  { pattern: /^signals\/deliveries$/, methods: methods("GET") },
  { pattern: /^signals\/deliveries\/[^/]+$/, methods: methods("GET") },
  { pattern: /^signals\/deliveries\/[^/]+\/retry$/, methods: methods("POST") },
  { pattern: /^mcp\/provider-catalog$/, methods: methods("GET") },
  { pattern: /^mcp\/provider-catalog\/[^/]+\/connect$/, methods: methods("POST") },
  { pattern: /^mcp\/proxied-mcp-servers$/, methods: methods("GET", "POST") },
  { pattern: /^mcp\/proxied-mcp-servers\/oauth\/start$/, methods: methods("POST") },
  { pattern: /^mcp\/proxied-mcp-servers\/[^/]+$/, methods: methods("GET", "DELETE") },
  { pattern: /^mcp\/tool-group\/[^/]+$/, methods: methods("GET", "DELETE") },
  {
    pattern: /^mcp\/tool-group\/[^/]+\/tools\/enable-and-bind$/,
    methods: methods("POST"),
  },
  { pattern: /^mcp\/mcp-server\/[^/]+\/tool-group\/[^/]+$/, methods: methods("DELETE") },
  { pattern: /^skill-registry\/[^/]+\/provider-skills$/, methods: methods("POST") },
  { pattern: /^skill-registry\/[^/]+$/, methods: methods("PATCH") },
  {
    pattern: /^credential\/source\/[^/]+\/resource-server(?:\/encrypt)?$/,
    methods: methods("POST"),
  },
];

export interface TildeProxyOptions {
  apiKey: string;
  orgId: string;
  teamId: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

/** Raw, same-origin bridge for Tilde-owned settings resources. */
export function registerTildeProxy(app: Hono, configuredOptions?: TildeProxyOptions): void {
  app.all("/api/tilde/*", async (context) => {
    const options = configuredOptions ?? optionsFromEnvironment();
    if (!options)
      return context.json(
        { error: "Tilde is unavailable because its server credentials are not configured" },
        503,
      );

    const relativePath = safeRelativePath(context.req.path.slice(proxyPrefix.length));
    const method = context.req.method as AllowedMethod;
    if (!relativePath || !isAllowed(relativePath, method))
      return context.json({ error: "Unsupported Tilde operation" }, 404);

    const incomingUrl = new URL(context.req.url);
    const upstreamUrl = new URL(
      `/api/v1/team/${encodeURIComponent(options.teamId)}/${relativePath}`,
      options.baseUrl ?? defaultTildeBaseUrl,
    );
    upstreamUrl.search = incomingUrl.search;

    try {
      const upstream = await (options.fetch ?? globalThis.fetch)(upstreamUrl, {
        method,
        headers: upstreamHeaders(context, options),
        body: await requestBody(context),
        signal: context.req.raw.signal,
        redirect: "manual",
      });
      const headers = responseHeaders(upstream.headers);
      headers.set("cache-control", "no-store");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (error) {
      if (context.req.raw.signal.aborted) throw error;
      return context.json(
        {
          error: "Tilde request failed",
          detail: error instanceof Error ? error.message : "Unknown upstream failure",
        },
        502,
      );
    }
  });
}

function optionsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): TildeProxyOptions | undefined {
  const apiKey = environment.TILDE_API_KEY?.trim();
  const orgId = environment.TILDE_ORG_ID?.trim();
  const teamId = environment.TILDE_TEAM_ID?.trim();
  if (!apiKey || !orgId || !teamId) return undefined;
  return {
    apiKey,
    orgId,
    teamId,
    baseUrl: environment.TILDE_BASE_URL?.trim() || undefined,
  };
}

function safeRelativePath(value: string): string | undefined {
  if (!value || value.startsWith("/") || value.includes("\\")) return undefined;
  for (const segment of value.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return undefined;
    }
    if (!decoded || decoded === "." || decoded === ".." || decoded.includes("\\")) return undefined;
  }
  return value;
}

function isAllowed(path: string, method: AllowedMethod): boolean {
  return allowedRoutes.some((route) => route.methods.has(method) && route.pattern.test(path));
}

function upstreamHeaders(context: Context, options: TildeProxyOptions): Headers {
  const headers = new Headers();
  for (const [name, value] of context.req.raw.headers) {
    const lowerName = name.toLowerCase();
    if (
      hopByHopHeaders.has(lowerName) ||
      lowerName === "authorization" ||
      lowerName === "cookie" ||
      lowerName === "x-api-key" ||
      lowerName === "x-tilde-org-id" ||
      lowerName === "x-tilde-team-id"
    )
      continue;
    headers.append(name, value);
  }
  headers.set("x-api-key", options.apiKey);
  headers.set("x-tilde-org-id", options.orgId);
  headers.set("x-tilde-team-id", options.teamId);
  headers.set("accept-encoding", "identity");
  return headers;
}

async function requestBody(context: Context): Promise<ArrayBuffer | undefined> {
  if (context.req.method === "GET" || context.req.method === "HEAD") return undefined;
  return await context.req.raw.arrayBuffer();
}

function responseHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of upstream) {
    const lowerName = name.toLowerCase();
    if (
      hopByHopHeaders.has(lowerName) ||
      lowerName === "set-cookie" ||
      lowerName === "content-encoding" ||
      lowerName === "content-length"
    )
      continue;
    headers.append(name, value);
  }
  return headers;
}
