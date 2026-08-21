import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import type { Hono } from "hono";
import { ComputerService } from "@tryopenbot/computer-service-proto";
import { agentIdFromName } from "@tryopenbot/utilities";

export interface AgentCreationOptions {
  environment?: NodeJS.ProcessEnv;
  execute?: AgentCreationExecutor;
  awaitExecution?: AgentCreationWaiter;
}

export interface AgentCreationRequest {
  agentId: string;
  command: string;
  arguments: string[];
  cwd: string;
  timeoutMilliseconds: number;
  background: boolean;
}

export interface AgentCreationResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  jobId?: string;
  running?: boolean;
}

export type AgentCreationExecutor = (
  request: AgentCreationRequest,
  options: { authorization: string; signal: AbortSignal },
) => Promise<AgentCreationResult>;

export type AgentCreationWaiter = (
  request: { agentId: string; jobId: string; timeoutMilliseconds: number },
  options: { authorization: string; signal: AbortSignal },
) => Promise<AgentCreationResult>;

const agentNamePattern = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,71}$/u;
const backgroundJobPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const createTimeoutMs = 600_000;

/**
 * Owner-facing agent creation: scaffold and register a new agent by running the repository CLI
 * inside the trusted development sandbox, where the writable checkout lives.
 */
export function registerAgentCreation(app: Hono, options: AgentCreationOptions = {}): void {
  app.post("/api/agents", async (context) => {
    const environment = options.environment ?? process.env;
    const serviceUrl = environment.DEVELOPMENT_SANDBOX_SERVICE_URL?.trim();
    const apiKey = environment.COMPUTER_SERVICE_API_KEY?.trim();
    if (!serviceUrl || !apiKey)
      return context.json({ error: "The development sandbox is not available" }, 503);
    let name: string;
    try {
      const body = (await context.req.json()) as { name?: unknown };
      name = typeof body.name === "string" ? body.name.trim() : "";
    } catch {
      name = "";
    }
    if (!agentNamePattern.test(name)) return context.json({ error: "Invalid agent name" }, 400);
    let agentId: string;
    try {
      agentId = agentIdFromName(name);
    } catch {
      return context.json({ error: "Invalid agent name" }, 400);
    }

    const execute = options.execute ?? connectExecutor(serviceUrl);
    const response = await execute(
      {
        agentId: "factory",
        command: "bash",
        arguments: [
          "-lc",
          `source /workspace/.openbot/development/profile.sh && cd /workspace/openbot && pnpm openbot new-agent ${shellQuote(name)} --json`,
        ],
        cwd: "",
        timeoutMilliseconds: createTimeoutMs,
        background: true,
      },
      {
        authorization: `Bearer ${apiKey}`,
        signal: context.req.raw.signal,
      },
    );
    if (response.exitCode !== 0) {
      const error = commandError(response);
      return context.json({ error }, error.includes("already exists") ? 409 : 502);
    }
    if (!response.running || !response.jobId)
      return context.json({ error: "Agent creation did not start" }, 502);
    return context.json(
      { status: "setting_up", job_id: response.jobId, agent: { id: agentId, name } },
      202,
    );
  });

  app.get("/api/agents/setup/:jobId", async (context) => {
    const environment = options.environment ?? process.env;
    const serviceUrl = environment.DEVELOPMENT_SANDBOX_SERVICE_URL?.trim();
    const apiKey = environment.COMPUTER_SERVICE_API_KEY?.trim();
    if (!serviceUrl || !apiKey)
      return context.json({ error: "The development sandbox is not available" }, 503);
    const jobId = context.req.param("jobId");
    if (!backgroundJobPattern.test(jobId)) return context.json({ error: "Invalid setup job" }, 400);
    const wait = options.awaitExecution ?? connectWaiter(serviceUrl);
    const response = await wait(
      { agentId: "factory", jobId, timeoutMilliseconds: 0 },
      { authorization: `Bearer ${apiKey}`, signal: context.req.raw.signal },
    );
    if (response.running) return context.json({ status: "setting_up" });
    if (response.exitCode !== 0)
      return context.json({ status: "failed", error: commandError(response) });
    const created = parseCreatedAgent(response.stdout);
    if (!created)
      return context.json({ status: "failed", error: "Agent creation returned no result" });
    return context.json({ status: "ready", agent: created });
  });
}

function commandError(response: AgentCreationResult): string {
  const stderr = lastLine(response.stderr);
  if (stderr) return stderr;
  for (const line of response.stdout.split("\n").reverse()) {
    try {
      const parsed = JSON.parse(line) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    } catch {
      // JSON mode may still include non-JSON process output before the result.
    }
  }
  return "Agent creation failed";
}

function connectExecutor(serviceUrl: string): AgentCreationExecutor {
  const service = createClient(
    ComputerService,
    createConnectTransport({ baseUrl: serviceUrl, httpVersion: "1.1" }),
  );
  return async (request, options) =>
    await service.exec(request, {
      headers: { authorization: options.authorization },
      signal: options.signal,
    });
}

function connectWaiter(serviceUrl: string): AgentCreationWaiter {
  const service = createClient(
    ComputerService,
    createConnectTransport({ baseUrl: serviceUrl, httpVersion: "1.1" }),
  );
  return async (request, options) =>
    await service.awaitExec(request, {
      headers: { authorization: options.authorization },
      signal: options.signal,
    });
}

function parseCreatedAgent(stdout: string): { id: string; name: string } | undefined {
  for (const line of stdout.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        ok?: boolean;
        agent?: { id?: unknown; name?: unknown };
      };
      if (
        parsed.ok &&
        typeof parsed.agent?.id === "string" &&
        typeof parsed.agent.name === "string"
      )
        return { id: parsed.agent.id, name: parsed.agent.name };
    } catch {
      // Not the JSON result line; keep scanning.
    }
  }
  return undefined;
}

function lastLine(output: string): string {
  return (
    output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
