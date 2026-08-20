import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import type { Hono } from "hono";
import { ComputerService } from "@tryopenbot/computer-service-proto";

export interface AgentCreationOptions {
  environment?: NodeJS.ProcessEnv;
  execute?: AgentCreationExecutor;
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
}

export type AgentCreationExecutor = (
  request: AgentCreationRequest,
  options: { authorization: string; signal: AbortSignal },
) => Promise<AgentCreationResult>;

const agentNamePattern = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,71}$/u;
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
        background: false,
      },
      {
        authorization: `Bearer ${apiKey}`,
        signal: context.req.raw.signal,
      },
    );
    if (response.exitCode !== 0) {
      return context.json(
        { error: lastLine(response.stderr) || "Agent creation failed" },
        response.stderr.includes("already exists") ? 409 : 502,
      );
    }
    const created = parseCreatedAgent(response.stdout);
    if (!created) return context.json({ error: "Agent creation returned no result" }, 502);
    return context.json(created, 201);
  });
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
