import type { Context, Hono } from "hono";

const proxyPrefix = "/api/chat/";
const rootChatKitPrefix = "_root/";
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

export interface TildeChatProxyOptions {
  apiKey: string;
  orgId: string;
  teamId: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Temporary same-origin bridge for Tilde ChatKit. It intentionally preserves
 * raw request bodies, response bodies, and SSE streams instead of projecting
 * them into OpenBot's narrower control RPC contract.
 */
export function registerTildeChatProxy(app: Hono, configuredOptions?: TildeChatProxyOptions): void {
  app.all("/api/chat/*", async (context) => {
    const options = configuredOptions ?? optionsFromEnvironment();
    if (!options) {
      return context.json(
        { error: "Tilde chat is unavailable because its server credentials are not configured" },
        503,
      );
    }

    const relativePath = context.req.path.slice(proxyPrefix.length);
    if (relativePath === "_upload") {
      return await proxySignedAttachmentUpload(context, options);
    }
    if (!isSafeChatKitPath(relativePath)) {
      return context.json({ error: "Invalid Tilde ChatKit path" }, 400);
    }

    const incomingUrl = new URL(context.req.url);
    const upstreamPath = resolveUpstreamPath(relativePath, options);
    if (!upstreamPath) {
      return context.json({ error: "Invalid Tilde ChatKit root path" }, 400);
    }
    const upstreamUrl = new URL(upstreamPath, options.baseUrl ?? "https://api.trytilde.ai");
    upstreamUrl.search = incomingUrl.search;

    try {
      const upstream = await (options.fetch ?? globalThis.fetch)(upstreamUrl, {
        method: context.req.method,
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
          error: "Tilde ChatKit request failed",
          detail: error instanceof Error ? error.message : "Unknown upstream failure",
        },
        502,
      );
    }
  });
}

async function proxySignedAttachmentUpload(
  context: Context,
  options: TildeChatProxyOptions,
): Promise<Response> {
  const target = new URL(context.req.url).searchParams.get("url");
  const uploadUrl = target ? allowedAttachmentUploadUrl(target, options) : undefined;
  if (!uploadUrl || context.req.method !== "PUT") {
    return context.json({ error: "Invalid Tilde attachment upload URL" }, 400);
  }
  try {
    const upstream = await (options.fetch ?? globalThis.fetch)(uploadUrl, {
      method: "PUT",
      headers: storageUploadHeaders(context),
      body: await requestBody(context),
      signal: context.req.raw.signal,
      redirect: "manual",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream.headers),
    });
  } catch (error) {
    if (context.req.raw.signal.aborted) throw error;
    return context.json(
      {
        error: "Tilde attachment upload failed",
        detail: error instanceof Error ? error.message : "Unknown storage failure",
      },
      502,
    );
  }
}

function allowedAttachmentUploadUrl(
  value: string,
  options: Pick<TildeChatProxyOptions, "orgId" | "teamId">,
): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const allowedHost =
    url.protocol === "https:" && url.hostname.endsWith(".r2.cloudflarestorage.com");
  const requiredPath = `/chatkit/org/${encodeURIComponent(options.orgId)}/team/${encodeURIComponent(options.teamId)}/`;
  return allowedHost && url.pathname.includes(requiredPath) ? url : undefined;
}

function resolveUpstreamPath(
  relativePath: string,
  options: Pick<TildeChatProxyOptions, "orgId" | "teamId">,
): string | undefined {
  if (!relativePath.startsWith(rootChatKitPrefix)) {
    return `/api/v1/team/${encodeURIComponent(options.teamId)}/chatkit/${relativePath}`;
  }
  const rootPath = relativePath.slice(rootChatKitPrefix.length);
  const requiredPrefix = `org/${encodeURIComponent(options.orgId)}/team/${encodeURIComponent(options.teamId)}/`;
  return rootPath.startsWith(requiredPrefix) ? `/api/v1/chatkit/${rootPath}` : undefined;
}

function optionsFromEnvironment(): TildeChatProxyOptions | undefined {
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

function isSafeChatKitPath(value: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (!decoded || decoded.startsWith("/") || decoded.includes("\\")) return false;
  return decoded.split("/").every((segment) => segment !== "." && segment !== "..");
}

function upstreamHeaders(context: Context, options: TildeChatProxyOptions): Headers {
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
    ) {
      continue;
    }
    headers.append(name, value);
  }
  headers.set("x-api-key", options.apiKey);
  headers.set("x-tilde-org-id", options.orgId);
  headers.set("x-tilde-team-id", options.teamId);
  headers.set("accept-encoding", "identity");
  return headers;
}

function storageUploadHeaders(context: Context): Headers {
  const headers = new Headers();
  for (const [name, value] of context.req.raw.headers) {
    const lowerName = name.toLowerCase();
    if (
      hopByHopHeaders.has(lowerName) ||
      lowerName === "authorization" ||
      lowerName === "cookie" ||
      lowerName === "x-api-key" ||
      lowerName === "content-length"
    ) {
      continue;
    }
    headers.append(name, value);
  }
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
    ) {
      continue;
    }
    headers.append(name, value);
  }
  return headers;
}
