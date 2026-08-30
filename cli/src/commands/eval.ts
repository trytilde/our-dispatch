import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import arg from "arg";
import { agentIdFromName } from "@tryopenbot/utilities";
import { parse as parseYaml } from "yaml";
import { ensureTildeAuth, readSelectedOrgId, readSelectedTeamId } from "../tilde/auth.js";
import { loadDotenvFiles } from "../tilde/env.js";

const defaultBaseUrl = "https://api.trytilde.ai";
const defaultTimeoutMs = 120_000;
const terminalExecutionStatuses = new Set([
  "completed",
  "succeeded",
  "failed",
  "errored",
  "cancelled",
]);

export type EvaluationScenarioId =
  | "simple-answer"
  | "computer-delegation"
  | "routine-lifecycle"
  | "agent-lifecycle";

export interface EvaluationScenarioResult {
  id: EvaluationScenarioId;
  passed: boolean;
  elapsedMs: number;
  detail: string;
  metrics: {
    toolCalls: number;
    repeatedToolCalls: number;
  };
  sessionId?: string;
  resourceId?: string;
  tools?: string[];
}

export interface EvaluationReport {
  ok: boolean;
  command: "eval";
  baseUrl: string;
  teamId: string;
  agentId: string;
  startedAt: string;
  elapsedMs: number;
  scenarios: EvaluationScenarioResult[];
}

interface EvaluationOptions {
  baseUrl: string;
  openbotUrl?: string;
  openbotOrigin?: string;
  teamId: string;
  orgId?: string;
  agentId: string;
  timeoutMs: number;
  scenarios: EvaluationScenarioId[];
  json: boolean;
}

interface EvaluationDependencies {
  request?: typeof fetch;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
  headers?: Record<string, string>;
}

export async function runEvaluation(
  args: readonly string[],
  dependencies: EvaluationDependencies = {},
): Promise<EvaluationReport> {
  loadDotenvFiles(process.cwd());
  const parsed = parseEvaluationOptions(args);
  const headers = dependencies.headers ?? (await authenticationHeaders(parsed));
  const request = dependencies.request ?? fetch;
  const now = dependencies.now ?? Date.now;
  const delay =
    dependencies.delay ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = new Date(now()).toISOString();
  const started = now();
  const context = { ...parsed, headers, request, now, delay };
  const scenarios: EvaluationScenarioResult[] = [];
  for (const scenario of parsed.scenarios) {
    try {
      scenarios.push(await runScenario(scenario, context));
    } catch (error) {
      scenarios.push({
        id: scenario,
        passed: false,
        elapsedMs: 0,
        detail: error instanceof Error ? error.message : String(error),
        metrics: { toolCalls: 0, repeatedToolCalls: 0 },
      });
    }
  }
  return {
    ok: scenarios.every((scenario) => scenario.passed),
    command: "eval",
    baseUrl: parsed.baseUrl,
    teamId: parsed.teamId,
    agentId: parsed.agentId,
    startedAt,
    elapsedMs: now() - started,
    scenarios,
  };
}

function parseEvaluationOptions(args: readonly string[]): EvaluationOptions {
  const scenarios: EvaluationScenarioId[] = [];
  const remaining: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--scenario") {
      remaining.push(args[index]!);
      continue;
    }
    const value = args[++index];
    if (!value) throw new Error("--scenario requires a value");
    if (!isScenarioId(value)) throw new Error(`Unknown evaluation scenario: ${value}`);
    scenarios.push(value);
  }
  const parsed = arg(
    {
      "--base-url": String,
      "--openbot-url": String,
      "--team-id": String,
      "--org-id": String,
      "--agent-id": String,
      "--timeout-ms": Number,
      "--json": Boolean,
    },
    { argv: remaining },
  );
  if (parsed._.length) throw new Error(`Unknown eval option: ${parsed._.join(", ")}`);
  const baseUrl = normalizeBaseUrl(parsed["--base-url"] ?? env("TILDE_BASE_URL") ?? defaultBaseUrl);
  const teamId = parsed["--team-id"] ?? env("TILDE_TEAM_ID") ?? readSelectedTeamId(baseUrl);
  if (!teamId) throw new Error("Select a Tilde team with openbot auth or pass --team-id");
  const orgId = parsed["--org-id"] ?? env("TILDE_ORG_ID") ?? readSelectedOrgId(baseUrl);
  const timeoutMs = parsed["--timeout-ms"] ?? defaultTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000)
    throw new Error("--timeout-ms must be an integer from 1000 to 600000");
  const publicOrigin = env("PUBLIC_ORIGIN");
  const openbotUrl = parsed["--openbot-url"] ?? publicOrigin;
  return {
    baseUrl,
    ...(openbotUrl ? { openbotUrl: normalizeBaseUrl(openbotUrl) } : {}),
    ...(publicOrigin
      ? { openbotOrigin: normalizeBaseUrl(publicOrigin) }
      : openbotUrl
        ? { openbotOrigin: normalizeBaseUrl(openbotUrl) }
        : {}),
    teamId,
    ...(orgId ? { orgId } : {}),
    agentId: parsed["--agent-id"] ?? "factory",
    timeoutMs,
    scenarios: scenarios.length
      ? [...new Set(scenarios)]
      : ["simple-answer", "computer-delegation", "routine-lifecycle", "agent-lifecycle"],
    json: parsed["--json"] ?? false,
  };
}

async function authenticationHeaders(options: EvaluationOptions): Promise<Record<string, string>> {
  const apiKey = env("TILDE_API_KEY");
  if (apiKey) {
    if (!options.orgId)
      throw new Error("TILDE_ORG_ID or --org-id is required when evaluating with TILDE_API_KEY");
    return { "x-api-key": apiKey, "x-tilde-org-id": options.orgId };
  }
  const tokens = await ensureTildeAuth({ baseUrl: options.baseUrl });
  return {
    Authorization: `Bearer ${tokens.accessToken}`,
    ...(options.orgId ? { "x-tilde-org-id": options.orgId } : {}),
  };
}

async function runScenario(
  id: EvaluationScenarioId,
  context: EvaluationOptions &
    Required<Pick<EvaluationDependencies, "request" | "now" | "delay">> & {
      headers: Record<string, string>;
    },
): Promise<EvaluationScenarioResult> {
  if (id === "simple-answer")
    return await conversationScenario(context, {
      id,
      prompt: "Explain how browser cookies work in one sentence.",
      expectedText: /cookie/i,
      forbiddenText: /^(?:got it|on it|i(?:'ll| will))\b/i,
      expectedTools: ["sendMessage"],
    });
  if (id === "computer-delegation")
    return await conversationScenario(context, {
      id,
      prompt:
        "Use the graphical browser to open https://example.com, identify the exact page heading, and report it. Do not use shell commands or connectors.",
      expectedText: /Example Domain/,
      expectedTools: ["chatkit_delegate", "chatkit_wait_for_response", "sendMessage"],
    });
  if (id === "routine-lifecycle") return await routineScenario(context);
  return await agentLifecycleScenario(context);
}

async function conversationScenario(
  context: EvaluationOptions &
    Required<Pick<EvaluationDependencies, "request" | "now" | "delay">> & {
      headers: Record<string, string>;
    },
  scenario: {
    id: EvaluationScenarioId;
    prompt: string;
    expectedText: RegExp;
    forbiddenText?: RegExp;
    expectedTools: string[];
  },
): Promise<EvaluationScenarioResult> {
  const started = context.now();
  const created = record(
    await apiJson(
      context,
      `/chatkit/workspace/agents/${encodeURIComponent(context.agentId)}/sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          title: `OpenBot evaluation: ${scenario.id} ${new Date().toISOString()}`,
        }),
      },
    ),
  );
  const session = record(created.session ?? created);
  const sessionId = stringField(session, "id");
  let page = record(
    await apiJson(
      context,
      `/chatkit/workspace/agents/${encodeURIComponent(context.agentId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ text: scenario.prompt, attachment_ids: [] }),
      },
    ),
  );
  while (context.now() - started < context.timeoutMs) {
    const summary = summarizeMessages(page);
    if (summary.tools.includes("sendMessage") && summary.text) break;
    await context.delay(750);
    page = record(
      await apiJson(
        context,
        `/chatkit/workspace/sessions/${encodeURIComponent(sessionId)}/messages?page_size=100`,
      ),
    );
  }
  const summary = summarizeMessages(page);
  const elapsedMs = context.now() - started;
  const toolsMatch = JSON.stringify(summary.tools) === JSON.stringify(scenario.expectedTools);
  const textMatches =
    scenario.expectedText.test(summary.text) && !scenario.forbiddenText?.test(summary.text);
  const passed =
    Boolean(summary.text) && textMatches && toolsMatch && elapsedMs < context.timeoutMs;
  return {
    id: scenario.id,
    passed,
    elapsedMs,
    sessionId,
    detail: passed
      ? summary.text
      : `Expected ${scenario.expectedTools.join(" → ")} and matching final text; received ${summary.tools.join(" → ") || "no tools"} and ${summary.text || "no final text"}`,
    metrics: {
      toolCalls: summary.tools.length,
      repeatedToolCalls: summary.tools.length - new Set(summary.tools).size,
    },
    tools: summary.tools,
  };
}

async function agentLifecycleScenario(
  context: EvaluationOptions &
    Required<Pick<EvaluationDependencies, "request" | "now" | "delay">> & {
      headers: Record<string, string>;
    },
): Promise<EvaluationScenarioResult> {
  if (!context.openbotUrl)
    throw new Error("PUBLIC_ORIGIN or --openbot-url is required for agent-lifecycle");
  const started = context.now();
  const secretSnapshot = await captureEncryptedConfiguration();
  const name = `Evaluation Agent ${randomUUID().slice(0, 8)}`;
  let agentId = agentIdFromName(name);
  let result: EvaluationScenarioResult | undefined;
  let operationError: unknown;
  try {
    const creation = record(
      await controlJson(context, "/api/agents", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    );
    const createJobId = stringField(creation, "job_id");
    const creationStarted = context.now();
    let creationReady = false;
    while (context.now() - creationStarted < context.timeoutMs) {
      const status = record(
        await controlJson(context, `/api/agents/setup/${encodeURIComponent(createJobId)}`),
      );
      if (status.status === "failed")
        throw new Error(
          `Agent creation failed: ${optionalString(status.error) || "unknown error"}`,
        );
      if (status.status === "ready") {
        const agent = record(status.agent);
        agentId = stringField(agent, "id");
        creationReady = true;
        break;
      }
      await context.delay(750);
    }
    if (!creationReady) throw new Error("Agent creation timed out");
    const invocation = await conversationScenario(
      { ...context, agentId },
      {
        id: "agent-lifecycle",
        prompt: "Reply with exactly EVAL_AGENT_OK.",
        expectedText: /^EVAL_AGENT_OK\.?$/i,
        expectedTools: ["sendMessage"],
      },
    );
    result = {
      ...invocation,
      id: "agent-lifecycle",
      resourceId: agentId,
      detail: invocation.passed ? "Created, invoked, and deleted an agent" : invocation.detail,
    };
  } catch (error) {
    operationError = error;
  }
  let cleanupError: unknown;
  try {
    const deletion = record(
      await controlJson(context, `/api/agents/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
      }),
    );
    const deleteJobId = stringField(deletion, "job_id");
    const deletionStarted = context.now();
    let deletionComplete = false;
    let lastStatusError: unknown;
    while (context.now() - deletionStarted < context.timeoutMs) {
      try {
        const status = record(
          await controlJson(context, `/api/agents/delete/${encodeURIComponent(deleteJobId)}`),
        );
        if (status.status === "failed")
          throw new Error(
            `Agent deletion failed: ${optionalString(status.error) || "unknown error"}`,
          );
        if (status.status === "deleted") {
          deletionComplete = true;
          break;
        }
      } catch (error) {
        lastStatusError = error;
      }
      if (await tildeAgentMissing(context, agentId)) {
        deletionComplete = true;
        break;
      }
      await context.delay(750);
    }
    if (!deletionComplete)
      throw new Error(
        `Agent deletion timed out${lastStatusError ? `: ${errorMessage(lastStatusError)}` : ""}`,
      );
  } catch (error) {
    cleanupError = error;
  }
  try {
    await restoreEncryptedConfiguration(secretSnapshot);
  } catch (error) {
    cleanupError ??= error;
  }
  if (operationError) throw operationError;
  if (!result) throw new Error("Agent lifecycle evaluation returned no result");
  if (!cleanupError) return { ...result, elapsedMs: context.now() - started };
  return {
    ...result,
    passed: false,
    elapsedMs: context.now() - started,
    detail: `${result.detail}; cleanup failed: ${errorMessage(cleanupError)}`,
  };
}

interface EncryptedConfigurationSnapshot {
  path: string;
  content: string;
  payload: string;
}

async function captureEncryptedConfiguration(): Promise<
  EncryptedConfigurationSnapshot | undefined
> {
  const path = resolve(process.cwd(), "configuration/secrets.enc.yaml");
  try {
    const content = await readFile(path, "utf8");
    return { path, content, payload: encryptedPayload(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function restoreEncryptedConfiguration(
  snapshot: EncryptedConfigurationSnapshot | undefined,
): Promise<void> {
  if (!snapshot) return;
  const current = await readFile(snapshot.path, "utf8");
  if (current === snapshot.content) return;
  if (encryptedPayload(current) !== snapshot.payload)
    throw new Error("Encrypted configuration changed beyond temporary evaluation credentials");
  await writeFile(snapshot.path, snapshot.content, "utf8");
}

function encryptedPayload(content: string): string {
  const parsed = record(parseYaml(content));
  delete parsed.sops;
  return JSON.stringify(sortJson(parsed));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}

async function routineScenario(
  context: EvaluationOptions &
    Required<Pick<EvaluationDependencies, "request" | "now" | "delay">> & {
      headers: Record<string, string>;
    },
): Promise<EvaluationScenarioResult> {
  const started = context.now();
  const routineId = randomUUID();
  const triggerId = randomUUID();
  const runId = randomUUID();
  let result: EvaluationScenarioResult | undefined;
  let operationError: unknown;
  try {
    const created = record(
      await apiJson(context, `/automations/${routineId}`, {
        method: "PUT",
        body: JSON.stringify({
          agent_id: context.agentId,
          enabled: true,
          instruction: "Reply with exactly EVAL_ROUTINE_OK.",
          name: `OpenBot evaluation ${routineId.slice(0, 8)}`,
          triggers: [{ id: triggerId, kind: "schedule", schedule: "0 7 * * *", enabled: true }],
        }),
      }),
    );
    const version = numberField(created, "version");
    const updated = record(
      await apiJson(context, `/automations/${routineId}`, {
        method: "PUT",
        body: JSON.stringify({
          agent_id: context.agentId,
          enabled: true,
          expected_version: version,
          instruction: "Reply with exactly EVAL_ROUTINE_OK.",
          name: `OpenBot evaluation updated ${routineId.slice(0, 8)}`,
          triggers: [{ id: triggerId, kind: "schedule", schedule: "0 7 * * *", enabled: true }],
        }),
      }),
    );
    if (numberField(updated, "version") <= version)
      throw new Error("Routine update did not advance version");
    const run = record(
      await apiJson(context, `/automations/${routineId}/run`, {
        method: "POST",
        body: JSON.stringify({ run_id: runId }),
      }),
    );
    const sessionId = stringField(run, "session_id");
    let status = "pending";
    while (context.now() - started < context.timeoutMs) {
      const executions = record(
        await apiJson(context, `/automations/${routineId}/executions?page_size=25`),
      );
      const matching = arrayField(executions, "items")
        .map(record)
        .find((execution) => execution.run_id === runId || execution.id === runId);
      status = typeof matching?.status === "string" ? matching.status : status;
      if (terminalExecutionStatuses.has(status)) break;
      await context.delay(750);
    }
    const passed = status === "completed" || status === "succeeded";
    result = {
      id: "routine-lifecycle",
      passed,
      elapsedMs: context.now() - started,
      sessionId,
      resourceId: routineId,
      detail: passed
        ? "Created, updated, ran, and deleted a routine"
        : `Routine execution ended as ${status}`,
      metrics: { toolCalls: 0, repeatedToolCalls: 0 },
    };
  } catch (error) {
    operationError = error;
  }
  let cleanupError: unknown;
  await apiJson(context, `/automations/${routineId}`, { method: "DELETE" }).catch((error) => {
    cleanupError = error;
  });
  if (operationError) throw operationError;
  if (!result) throw new Error("Routine evaluation returned no result");
  if (!cleanupError) return result;
  return {
    ...result,
    passed: false,
    detail: `${result.detail}; cleanup failed: ${errorMessage(cleanupError)}`,
  };
}

function summarizeMessages(page: Record<string, unknown>): { text: string; tools: string[] } {
  const messages = arrayField(page, "items")
    .map(record)
    .sort((left, right) =>
      optionalString(left.created_at).localeCompare(optionalString(right.created_at)),
    );
  const assistant = messages.filter((message) => message.role === "assistant");
  const tools = assistant.flatMap((message) =>
    (Array.isArray(message.parts) ? message.parts : []).flatMap((value) => {
      const part = record(value);
      const name = part.tool_name ?? part.toolName;
      return part.type === "tool" && part.state === "output-available" && typeof name === "string"
        ? [name]
        : [];
    }),
  );
  const text =
    assistant
      .flatMap((message) =>
        (Array.isArray(message.parts) ? message.parts : []).flatMap((value) => {
          const part = record(value);
          return part.type === "text" && typeof part.text === "string" ? [part.text] : [];
        }),
      )
      .at(-1) ?? "";
  return { text, tools };
}

async function apiJson(
  context: Pick<EvaluationOptions, "baseUrl" | "teamId"> & {
    headers: Record<string, string>;
    request: typeof fetch;
  },
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    ...context.headers,
  });
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  const response = await context.request(
    `${context.baseUrl}/api/v1/team/${encodeURIComponent(context.teamId)}${path}`,
    {
      ...init,
      headers,
    },
  );
  if (!response.ok)
    throw new Error(`${path} failed (${response.status}): ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

async function controlJson(
  context: Pick<EvaluationOptions, "openbotUrl" | "openbotOrigin"> & {
    headers: Record<string, string>;
    request: typeof fetch;
  },
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  if (!context.openbotUrl) throw new Error("OpenBot URL is unavailable");
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    ...context.headers,
  });
  const apiKey = headers.get("x-api-key");
  if (apiKey && !headers.has("authorization")) {
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${apiKey}`);
  }
  if (context.openbotOrigin) headers.set("origin", context.openbotOrigin);
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  const response = await context.request(`${context.openbotUrl}${path}`, { ...init, headers });
  if (!response.ok)
    throw new Error(`${path} failed (${response.status}): ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

async function tildeAgentMissing(
  context: Pick<EvaluationOptions, "baseUrl" | "teamId"> & {
    headers: Record<string, string>;
    request: typeof fetch;
  },
  agentId: string,
): Promise<boolean> {
  const response = await context.request(
    `${context.baseUrl}/api/v1/team/${encodeURIComponent(context.teamId)}/chatkit/agents/${encodeURIComponent(agentId)}`,
    { headers: context.headers },
  );
  if (response.status === 404) return true;
  if (!response.ok)
    throw new Error(`Agent cleanup check failed (${response.status}): ${await response.text()}`);
  return false;
}

function isScenarioId(value: string): value is EvaluationScenarioId {
  return ["simple-answer", "computer-delegation", "routine-lifecycle", "agent-lifecycle"].includes(
    value,
  );
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("--base-url must use HTTP or HTTPS");
  return url.toString().replace(/\/$/, "");
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== "string" || !result) throw new Error(`Response is missing ${field}`);
  return result;
}

function numberField(value: Record<string, unknown>, field: string): number {
  const result = value[field];
  if (typeof result !== "number") throw new Error(`Response is missing ${field}`);
  return result;
}

function arrayField(value: Record<string, unknown>, field: string): unknown[] {
  const result = value[field];
  return Array.isArray(result) ? result : [];
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return typeof value === "string" ? value : "unknown error";
}
