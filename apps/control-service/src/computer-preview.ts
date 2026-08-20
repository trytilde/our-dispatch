import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import {
  ComputerProviderError,
  type ComputerProvider,
} from "@tryopenbot/computer-service-provider";

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
    const requestedTraceId = context.req.query("trace_id")?.trim();
    const requestId =
      requestedTraceId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestedTraceId)
        ? requestedTraceId
        : randomUUID();
    const startedAt = Date.now();
    console.info("[openbot-vnc] preview requested", { agentId, requestId });
    try {
      const endpoint = await provider.previewAgentDesktop(agentId, {
        requestId,
        ...(options.devMode ? { devMode: true } : {}),
        ...(options.environment ? { environment: options.environment } : {}),
        signal: context.req.raw.signal,
      });
      console.info("[openbot-vnc] preview redirect ready", {
        agentId,
        elapsedMs: Date.now() - startedAt,
        endpointOrigin: endpoint.url.origin,
        endpointPath: endpoint.url.pathname,
        expiresAt: endpoint.expiresAt.toISOString(),
        requestId,
      });
      const response = context.redirect(endpoint.url.toString(), 307);
      response.headers.set("cache-control", "no-store");
      response.headers.set("referrer-policy", "no-referrer");
      response.headers.set("x-openbot-vnc-trace-id", requestId);
      return response;
    } catch (error) {
      if (context.req.raw.signal.aborted) {
        console.info("[openbot-vnc] preview request aborted", {
          agentId,
          elapsedMs: Date.now() - startedAt,
          requestId,
        });
        return new Response(null, { status: 499 });
      }
      console.error(
        "[openbot-vnc] preview request failed",
        { agentId, elapsedMs: Date.now() - startedAt, requestId },
        error instanceof Error ? error : new Error(String(error)),
      );
      if (!(error instanceof ComputerProviderError)) throw error;
      return context.json(
        { error: error.message },
        error.code === "not_found" ? 404 : error.code === "permission_denied" ? 403 : 503,
      );
    }
  });
}
