import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
  signBody,
  TILDE_WEBHOOK_ID_HEADER,
  TILDE_WEBHOOK_SIGNATURE_HEADER,
  TILDE_WEBHOOK_TIMESTAMP_HEADER,
  verifyWebhookRequest,
  WebhookVerificationError,
} from "@trytilde/harness-sdk-vercel-ai-node";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SandboxProvider } from "@openbot/provider-sdk";
import { TildeChatProvider } from "@openbot/providers";
import { hasValidSession, issueSessionCookie, matchesSetupCode } from "./crypto.js";
import { publicOrigin, setupCode } from "./config.js";
import { providerContext, tildeEnvironment } from "./environment.js";
import { ensureInstallation } from "./store.js";
import { configuredProvider } from "./provider-registry.js";
import { loadRepository } from "./repository.js";
import { reconcileRepository } from "./reconcile.js";
import { getAgentPublication, publishAgent } from "./publishing.js";

export const httpApp = new Hono();

httpApp.use("*", secureHeaders());

httpApp.get("/healthz", (context) => context.json({ ok: true, service: "openbot", version: "0.1.0" }));

httpApp.post("/api/setup/unlock", async (context) => {
  const body: { setupCode?: string } = await context.req.json<{ setupCode?: string }>().catch(() => ({}));
  if (!body.setupCode || !matchesSetupCode(body.setupCode, setupCode())) {
    return context.json({ error: "Invalid setup code" }, 401);
  }
  await ensureInstallation(publicOrigin(context.req.raw));
  context.header("Set-Cookie", issueSessionCookie(setupCode(), new URL(context.req.url).protocol === "https:"));
  return context.json({ ok: true });
});

httpApp.get("/api/configuration", async (context) => {
  if (!hasValidSession(context.req.header("cookie") ?? null, setupCode())) return context.json({ error: "Setup session required" }, 401);
  const repository = await loadRepository();
  return context.json({ digest: repository.digest, agents: repository.agents.map(({ id, displayName }) => ({ id, displayName })), skills: repository.skills.map(({ name, description }) => ({ name, description })) });
});

httpApp.post("/api/admin/reconcile", async (context) => {
  if (!hasValidSession(context.req.header("cookie") ?? null, setupCode())) return context.json({ error: "Setup session required" }, 401);
  const report = await reconcileRepository({ origin: publicOrigin(context.req.raw) });
  return context.json(report, report.errors.length ? 502 : 200);
});

httpApp.post("/api/agent-publications", async (context) => {
  if (!hasValidSession(context.req.header("cookie") ?? null, setupCode())) return context.json({ error: "Setup session required" }, 401);
  try {
    const body = await context.req.json<{ id: string; displayName: string; description?: string }>();
    return context.json(await publishAgent(body, context.req.raw.signal), 202);
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : "Unable to publish agent" }, 400);
  }
});

httpApp.get("/api/agent-publications/:id", async (context) => {
  if (!hasValidSession(context.req.header("cookie") ?? null, setupCode())) return context.json({ error: "Setup session required" }, 401);
  const publication = await getAgentPublication(context.req.param("id"));
  return publication ? context.json(publication) : context.json({ error: "Publication not found" }, 404);
});

httpApp.use("/api/chat", async (context, next) => {
  if (!hasValidSession(context.req.header("cookie") ?? null, setupCode())) return context.json({ error: "Setup session required" }, 401);
  await next();
});

httpApp.post("/api/chat", async (context) => {
  const body = await context.req.json<{ agentId?: string; sessionId?: string; text?: string; messages?: unknown[] }>();
  const tilde = await tildeEnvironment();
  if (!tilde) return context.json({ error: "Tilde is not configured" }, 409);
  const agentId = body.agentId || tilde.agentId;
  if (!agentId) return context.json({ error: "A Tilde agent is required" }, 400);
  const text = body.text?.trim() || lastUserText(body.messages);
  if (!text) return context.json({ error: "A user message is required" }, 400);
  const provider = new TildeChatProvider(tilde);
  const session = body.sessionId
    ? { id: body.sessionId }
    : await provider.createSession(agentId, undefined, providerContext(undefined, context.req.raw.signal));
  const messages = await provider.sendMessage(agentId, session.id, text, providerContext(undefined, context.req.raw.signal));
  return context.json({
    sessionId: session.id,
    messages: messages.map((message) => ({ ...message, createdAt: message.createdAt.toISOString() })),
  });
});

httpApp.all("/api/agents/:agentId", (context) => handleAgentEndpoint(context, context.req.param("agentId")));
httpApp.all("/api/tilde/chatkit", (context) => handleAgentEndpoint(context, "openbot"));

async function handleAgentEndpoint(context: Context, agentId: string) {
  if (context.req.method !== "POST") return context.json({ error: "Method not allowed" }, 405);
  const repository = await loadRepository();
  const agent = repository.agents.find((candidate) => candidate.id === agentId);
  if (!agent) return context.json({ error: "Agent endpoint not found" }, 404);
  return agent.POST(context.req.raw);
}

httpApp.all("/api/tilde/tools/sandbox", async (context) => {
  const secrets = await tildeSecrets();
  if (!secrets) return context.json({ error: "Tilde is not configured" }, 503);
  return sandboxToolEndpoint(context.req.raw, secrets.webhookSigningKey);
});

const sandboxExecInput = z.object({
  command: z.string().min(1),
  arguments: z.array(z.string()).default([]),
});

export async function sandboxToolEndpoint(request: Request, webhookSigningKey: string): Promise<Response> {
  if (request.method === "GET") {
    const verificationError = verifySignedDiscovery(request, webhookSigningKey);
    if (verificationError) return Response.json({ type: "error", message: verificationError }, { status: 401 });
    return Response.json({
      provider: {
        name: "OpenBot sandbox",
        description: "Execute bounded commands in the active OpenBot sandbox",
        version: "1.0.0",
      },
      invoke_url: new URL("/api/tilde/tools/sandbox", publicOrigin(request)).toString(),
      tools: [{
        type_id: "sandbox_exec",
        name: "Run sandbox command",
        description: "Run a command in this OpenBot installation's active computer.",
        input_schema: z.toJSONSchema(sandboxExecInput, { target: "draft-7" }),
        output_schema: z.toJSONSchema(z.object({ exitCode: z.number().int(), stdout: z.string(), stderr: z.string() }), { target: "draft-7" }),
      }],
    });
  }

  let verified: Awaited<ReturnType<typeof verifyWebhookRequest>>;
  try {
    verified = await verifyWebhookRequest(request, { webhookSigningKey });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return Response.json({ type: "error", message: error.message }, { status: 401 });
    }
    throw error;
  }

  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const invocation = verified.json;
  if (!isRecord(invocation) || invocation.tool_source_type_id !== "sandbox_exec") {
    return Response.json({ type: "error", message: "Unknown or invalid tool invocation" }, { status: 400 });
  }
  const input = await sandboxExecInput.safeParseAsync(invocation.params);
  if (!input.success) return Response.json({ type: "error", message: z.prettifyError(input.error) });
  try {
    const installation = await ensureInstallation();
    if (!installation.sandboxInstanceId) {
      return Response.json({ type: "error", message: "The OpenBot computer has not been started" });
    }
    const output = await (await configuredProvider<SandboxProvider>("sandbox")).exec(
      installation.sandboxInstanceId,
      input.data.command,
      input.data.arguments,
      { requestId: crypto.randomUUID(), signal: request.signal },
    );
    return Response.json({ ...output, type: "success" });
  } catch (error) {
    return Response.json({ type: "error", message: error instanceof Error ? error.message : "Tool execution failed" });
  }
}

function verifySignedDiscovery(request: Request, webhookSigningKey: string): string | undefined {
  const webhookId = request.headers.get(TILDE_WEBHOOK_ID_HEADER);
  const timestampValue = request.headers.get(TILDE_WEBHOOK_TIMESTAMP_HEADER);
  const signature = request.headers.get(TILDE_WEBHOOK_SIGNATURE_HEADER);
  if (!webhookId) return `Missing ${TILDE_WEBHOOK_ID_HEADER} header`;
  if (!timestampValue) return `Missing ${TILDE_WEBHOOK_TIMESTAMP_HEADER} header`;
  if (!signature) return `Missing ${TILDE_WEBHOOK_SIGNATURE_HEADER} header`;
  if (!/^-?\d+$/.test(timestampValue)) return "Invalid webhook timestamp";
  const timestamp = Number(timestampValue);
  if (!Number.isSafeInteger(timestamp)) return "Invalid webhook timestamp";
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return "Webhook timestamp is outside tolerance";
  const expected = signBody(webhookSigningKey, timestamp, new Uint8Array());
  const receivedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) {
    return "Invalid webhook signature";
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function tildeSecrets() {
  return tildeEnvironment();
}

function lastUserText(messages: unknown[] | undefined): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "user") continue;
    if (typeof message.content === "string") return message.content.trim() || undefined;
    if (!Array.isArray(message.parts)) continue;
    const value = message.parts
      .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();
    if (value) return value;
  }
  return undefined;
}
