import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import WebSocket, { type RawData } from "ws";

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
  app.get("/api/chat/mission-control/events", (context) => {
    const options = configuredOptions ?? optionsFromEnvironment();
    if (!options) {
      return context.json(
        { error: "Tilde chat is unavailable because its server credentials are not configured" },
        503,
      );
    }
    return streamMissionControlEvents(context, options);
  });

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

    const startedAt = Date.now();
    try {
      const upstream = await (options.fetch ?? globalThis.fetch)(upstreamUrl, {
        method: context.req.method,
        headers: upstreamHeaders(context, options),
        body: await requestBody(context),
        signal: context.req.raw.signal,
        redirect: "manual",
      });
      if (upstream.status >= 500)
        void logUpstreamFailure(context, relativePath, upstream.clone(), startedAt);
      const headers = responseHeaders(upstream.headers);
      headers.set("cache-control", "no-store");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (error) {
      if (context.req.raw.signal.aborted) throw error;
      console.error(
        "[openbot-chat-proxy] upstream request threw",
        {
          elapsedMs: Date.now() - startedAt,
          method: context.req.method,
          path: relativePath,
        },
        error,
      );
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

function streamMissionControlEvents(context: Context, options: TildeChatProxyOptions): Response {
  return streamSSE(context, async (stream) => {
    const upstreamUrl = new URL(
      `/api/v1/team/${encodeURIComponent(options.teamId)}/chatkit/mission-control/ws`,
      options.baseUrl ?? "https://api.trytilde.ai",
    );
    upstreamUrl.protocol = upstreamUrl.protocol === "http:" ? "ws:" : "wss:";

    const socket = new WebSocket(upstreamUrl, {
      headers: {
        "x-api-key": options.apiKey,
        "x-tilde-org-id": options.orgId,
        "x-tilde-team-id": options.teamId,
      },
    });
    const close = (): void => socket.close();
    context.req.raw.signal.addEventListener("abort", close, { once: true });
    stream.onAbort(close);

    let pendingWrite = Promise.resolve();
    socket.on("message", (payload) => {
      const event = missionControlSocketEvent(webSocketText(payload));
      if (!event) return;
      pendingWrite = pendingWrite.then(() =>
        stream.writeSSE({
          event: event.type,
          ...(event.id ? { id: event.id } : {}),
          data: JSON.stringify(event.data),
        }),
      );
    });
    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ jsonrpc: "2.0", method: "ping", params: {} }));
      pendingWrite = pendingWrite.then(async () => {
        await stream.write(": keepalive\n\n");
      });
    }, 20_000);

    await new Promise<void>((resolve, reject) => {
      socket.once("close", resolve);
      socket.once("error", reject);
    }).finally(() => {
      clearInterval(heartbeat);
      context.req.raw.signal.removeEventListener("abort", close);
    });
    await pendingWrite;
  });
}

function webSocketText(value: RawData): string {
  if (Array.isArray(value)) return Buffer.concat(value).toString("utf8");
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString("utf8");
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8");
}

function missionControlSocketEvent(
  value: string,
): { type: string; id?: string; data: unknown } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const message = parsed as { method?: unknown; params?: { event?: unknown } };
  const event = message.params?.event;
  if (typeof message.method !== "string" || event === undefined) return undefined;
  const id =
    event && typeof event === "object" && "id" in event && typeof event.id === "string"
      ? event.id
      : undefined;
  return { type: message.method, ...(id ? { id } : {}), data: event };
}

async function logUpstreamFailure(
  context: Context,
  path: string,
  response: Response,
  startedAt: number,
): Promise<void> {
  let detail = "";
  try {
    const text = (await response.text()).slice(0, 2_000);
    if (text) {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        detail = [parsed.error, parsed.detail, parsed.message]
          .filter((value): value is string => typeof value === "string")
          .join(": ")
          .slice(0, 500);
      } catch {
        if (response.headers.get("content-type")?.startsWith("text/plain"))
          detail = text.slice(0, 500);
      }
    }
  } catch {
    // Preserve the upstream response even when its diagnostic clone cannot be consumed.
  }
  console.error("[openbot-chat-proxy] upstream request failed", {
    elapsedMs: Date.now() - startedAt,
    method: context.req.method,
    path,
    status: response.status,
    ...(detail ? { detail } : {}),
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
