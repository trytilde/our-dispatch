import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AuthProvider } from "@tryopenbot/auth-provider";
import type { ComputerProvider } from "@tryopenbot/computer-provider";
import { registerTildeChatProxy, type TildeChatProxyOptions } from "./chat-proxy.js";
import { registerComputerPreview } from "./computer-preview.js";
import { registerOwnerAuth, requireOwner } from "./auth.js";
const sourceWebRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
const workingDirectoryWebRoot = resolve(process.cwd(), "apps/web/dist");
const defaultWebRoot =
  process.env.WEB_ROOT ?? (existsSync(sourceWebRoot) ? sourceWebRoot : workingDirectoryWebRoot);

export interface AppOptions {
  webRoot?: string;
  computerProvider?: ComputerProvider;
  devMode?: boolean;
  environment?: NodeJS.ProcessEnv;
  tildeChatProxy?: TildeChatProxyOptions;
  authProvider?: AuthProvider;
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();
  const webRoot = options.webRoot ?? defaultWebRoot;
  app.use("*", secureHeaders());
  app.get("/healthz", (context) => context.json({ ok: true, service: "openbot" }));
  if (options.authProvider) {
    registerOwnerAuth(app, options.authProvider);
    const middleware = requireOwner(options.authProvider);
    app.use("/api/chat/*", middleware);
    app.use("/api/computer/*", middleware);
  }
  registerComputerPreview(app, options.computerProvider, {
    devMode: options.devMode,
    environment: options.environment,
  });
  registerTildeChatProxy(app, options.tildeChatProxy);
  if (existsSync(webRoot)) {
    const cacheHeaders = (
      path: string,
      context: { header(name: string, value: string): void },
    ): void => {
      context.header(
        "cache-control",
        path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
      );
    };
    app.get("*", serveStatic({ root: webRoot, onFound: cacheHeaders }));
    app.get("*", async (context) => {
      const index = await readFile(resolve(webRoot, "index.html"), "utf8");
      context.header("cache-control", "no-cache");
      context.header("content-type", "text/html; charset=utf-8");
      return context.body(index);
    });
  }

  return app;
}

export const app = createApp();

export default app;
