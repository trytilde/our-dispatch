import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import { discoverAgents, globalInstrumentationPath, type AgentSource } from "./discovery.js";

interface AgentModule {
  default?: (request: Request) => Response | Promise<Response>;
}
interface InstrumentationModule {
  default?: { setup?: (context: { agentName: string }) => void | Promise<void> };
}

export async function createAgentServiceApp(
  repositoryRoot: string,
  options: { health?: boolean } = {},
): Promise<Hono> {
  const app = new Hono();
  if (options.health !== false)
    app.get("/healthz", (context) => context.json({ ok: true, service: "openbot-agents" }));
  for (const agent of await discoverAgents(repositoryRoot)) {
    await runInstrumentation(globalInstrumentationPath(repositoryRoot), agent);
    if (agent.instrumentationPath) await runInstrumentation(agent.instrumentationPath, agent);
    const module = (await import(
      `${pathToFileURL(agent.path).href}?openbot=${Date.now()}`
    )) as AgentModule;
    if (typeof module.default !== "function")
      throw new Error(`${agent.path} must default export chatKitEndpoint(...)`);
    app.post(`/api/agents/${agent.slug}`, async (context) =>
      observeAgentResponse(agent.slug, context.req.raw, module.default!),
    );
  }
  return app;
}

/** Preserve the authored-agent stack, including failures raised after a streaming response starts. */
async function observeAgentResponse(
  agentId: string,
  request: Request,
  endpoint: NonNullable<AgentModule["default"]>,
): Promise<Response> {
  const startedAt = Date.now();
  console.info("[openbot-agent] request received", {
    agentId,
    method: request.method,
    path: new URL(request.url).pathname,
  });
  try {
    const response = await endpoint(request);
    if (response.status >= 500)
      logAgentFailure(
        agentId,
        request,
        startedAt,
        "response",
        new Error(`Agent returned ${response.status}`),
        {
          status: response.status,
        },
      );
    if (!response.body) {
      logAgentCompletion(agentId, request, startedAt, response.status);
      return response;
    }

    const reader = response.body.getReader();
    let settled = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            if (!settled) {
              settled = true;
              logAgentCompletion(agentId, request, startedAt, response.status);
            }
            controller.close();
          } else controller.enqueue(next.value);
        } catch (error) {
          settled = true;
          logAgentFailure(agentId, request, startedAt, "stream", error);
          controller.error(error);
        }
      },
      async cancel(reason) {
        settled = true;
        console.info("[openbot-agent] response cancelled", {
          agentId,
          elapsedMs: Date.now() - startedAt,
          method: request.method,
          path: new URL(request.url).pathname,
        });
        await reader.cancel(reason);
      },
    });
    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    logAgentFailure(agentId, request, startedAt, "handler", error);
    throw error;
  }
}

function logAgentCompletion(
  agentId: string,
  request: Request,
  startedAt: number,
  status: number,
): void {
  console.info("[openbot-agent] request completed", {
    agentId,
    elapsedMs: Date.now() - startedAt,
    method: request.method,
    path: new URL(request.url).pathname,
    status,
  });
}

function logAgentFailure(
  agentId: string,
  request: Request,
  startedAt: number,
  phase: "handler" | "response" | "stream",
  error: unknown,
  extra: Record<string, unknown> = {},
): void {
  const failure = error instanceof Error ? error : new Error(String(error));
  console.error(
    "[openbot-agent] request failed",
    {
      agentId,
      elapsedMs: Date.now() - startedAt,
      method: request.method,
      path: new URL(request.url).pathname,
      phase,
      ...extra,
    },
    failure,
  );
}

async function runInstrumentation(path: string, agent: AgentSource): Promise<void> {
  try {
    const module = (await import(
      `${pathToFileURL(path).href}?openbot=${Date.now()}`
    )) as InstrumentationModule;
    if (module.default?.setup) await module.default.setup({ agentName: agent.slug });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") return;
    throw error;
  }
}
