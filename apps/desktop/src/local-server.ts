import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export interface RendererServer {
  origin: string;
  close(): Promise<void>;
}

export interface RendererServerOptions {
  accessToken?: () => Promise<string | undefined>;
  tildeBaseUrl?: string;
  webOrigin?: string;
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export async function startRendererServer(
  staticRoot: string,
  controlOrigin: string,
  options: RendererServerOptions = {},
): Promise<RendererServer> {
  const normalizedRoot = resolve(staticRoot);
  const upstreamOrigin = new URL(controlOrigin).origin;
  const tildeSocketOrigin = websocketOrigin(options.tildeBaseUrl ?? "https://api.trytilde.ai");
  const server = createServer((request, response) => {
    void handleRequest(
      request,
      response,
      normalizedRoot,
      upstreamOrigin,
      tildeSocketOrigin,
      options,
    ).catch((error: unknown) => {
      if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
      else {
        response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "The OpenBot control server is unavailable." }));
      }
    });
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Electron renderer server did not bind to loopback");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      }),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  staticRoot: string,
  controlOrigin: string,
  tildeSocketOrigin: string,
  options: RendererServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://openbot.local");
  if (isControlPath(url.pathname)) {
    await proxyRequest(
      request,
      response,
      new URL(`${url.pathname}${url.search}`, controlOrigin),
      await options.accessToken?.(),
    );
    return;
  }
  if (options.webOrigin) {
    await proxyRequest(
      request,
      response,
      new URL(`${url.pathname}${url.search}`, options.webOrigin),
    );
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" });
    response.end();
    return;
  }

  const relativePath = decodeURIComponent(
    url.pathname === "/" ? "index.html" : url.pathname.slice(1),
  );
  let path = resolve(staticRoot, relativePath);
  if (path !== staticRoot && !path.startsWith(`${staticRoot}${sep}`)) {
    response.writeHead(400);
    response.end();
    return;
  }
  let content: Buffer;
  try {
    content = await readFile(path);
  } catch {
    path = resolve(staticRoot, "index.html");
    content = await readFile(path);
  }
  response.writeHead(200, {
    "cache-control": path.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "content-security-policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; connect-src 'self' ${tildeSocketOrigin}; frame-src http: https:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'`,
    "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

function websocketOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Tilde base URL must use HTTP or HTTPS");
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  return url.origin;
}

function isControlPath(pathname: string): boolean {
  return pathname === "/healthz" || pathname.startsWith("/api/") || pathname.startsWith("/auth/");
}

async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  upstream: URL,
  accessToken?: string,
): Promise<void> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name === "host" || name === "content-length") continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  headers.set("accept-encoding", "identity");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : new Uint8Array(await requestBody(request));
  const upstreamResponse = await fetch(upstream, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(5 * 60_000),
  });

  const responseHeaders: Record<string, string | string[]> = {};
  upstreamResponse.headers.forEach((value, name) => {
    if (name !== "set-cookie" && name !== "content-length" && name !== "content-encoding")
      responseHeaders[name] = value;
  });
  const setCookies =
    (upstreamResponse.headers as Headers & { getSetCookie?(): string[] }).getSetCookie?.() ??
    (upstreamResponse.headers.get("set-cookie")
      ? [upstreamResponse.headers.get("set-cookie")!]
      : []);
  if (setCookies.length) {
    // The proxy only listens on loopback. Keep HttpOnly/SameSite protections,
    // but Secure cannot be sent back to its random plain-HTTP loopback origin.
    responseHeaders["set-cookie"] = setCookies.map((cookie) => cookie.replace(/;\s*Secure/gi, ""));
  }
  response.writeHead(upstreamResponse.status, responseHeaders);
  if (!upstreamResponse.body || request.method === "HEAD") {
    response.end();
    return;
  }
  const reader = upstreamResponse.body.getReader();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    if (!response.write(part.value))
      await new Promise<void>((resolvePromise) => response.once("drain", resolvePromise));
  }
  response.end();
}

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  return Buffer.concat(parts);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
}
