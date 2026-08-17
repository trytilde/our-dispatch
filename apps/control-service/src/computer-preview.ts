import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { ComputerProviderError, type ComputerProvider } from "@tryopenbot/computer-provider";

export interface ComputerPreviewOptions {
  devMode?: boolean;
  environment?: NodeJS.ProcessEnv;
}

export function registerComputerPreview(
  app: Hono,
  provider?: ComputerProvider,
  options: ComputerPreviewOptions = {},
): void {
  app.get("/api/computer/:agentId/preview", async (context) => {
    if (!provider) return context.json({ error: "Computer preview is not configured" }, 503);
    const agentId = context.req.param("agentId");
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(agentId))
      return context.json({ error: "Invalid agent" }, 400);
    try {
      const endpoint = await provider.previewAgentDesktop(agentId, {
        requestId: randomUUID(),
        ...(options.devMode ? { devMode: true } : {}),
        ...(options.environment ? { environment: options.environment } : {}),
        signal: context.req.raw.signal,
      });
      const response = context.redirect(endpoint.url.toString(), 307);
      response.headers.set("cache-control", "no-store");
      response.headers.set("referrer-policy", "no-referrer");
      return response;
    } catch (error) {
      if (context.req.raw.signal.aborted) return new Response(null, { status: 499 });
      if (!(error instanceof ComputerProviderError)) throw error;
      return context.json(
        { error: error.message },
        error.code === "not_found" ? 404 : error.code === "permission_denied" ? 403 : 503,
      );
    }
  });
}
