import type { NormalizedConfig } from "../config";
import { requestJson } from "../internal/fetch-client";
import { pathWithParams, teamPath } from "../internal/paths";
import type { JsonValue } from "../json";

const RUNS = "/api/v1/team/{team_id}/chatkit/agents/{agent_id}/sessions/{session_id}/runs";

export type AgentRunStatus =
  | "active"
  | "waiting"
  | "paused"
  | "stalled"
  | "completed"
  | "failed"
  | "canceled";

export type AgentRunBudget = {
  maxSteps?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCostMicrousd?: number;
  maxDurationSeconds?: number;
};

export type AgentRun = {
  id: string;
  orgId: string;
  teamId: string;
  sessionId: string;
  agentId: string;
  objective: string;
  goalId?: string;
  status: AgentRunStatus;
  budget: AgentRunBudget;
  stepCount: number;
  continuationCount: number;
  noProgressCount: number;
  repeatedPatternCount: number;
  inputTokens: number;
  outputTokens: number;
  costMicrousd: number;
  elapsedMs: number;
  generation: number;
  result?: JsonValue;
  error?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunEffectReceipt = {
  runId: string;
  stepId: string;
  toolCallId: string;
  toolName: string;
  inputFingerprint: string;
  idempotencyKey: string;
  status: "planned" | "committed" | "uncertain";
  output?: JsonValue;
  createdAt: string;
};

export class AgentRunsClient {
  readonly #config: NormalizedConfig;
  constructor(config: NormalizedConfig) {
    this.#config = config;
  }

  async create(input: {
    sessionId: string;
    agentId: string;
    objective: string;
    goalId?: string;
    budget?: AgentRunBudget;
    idempotencyKey: string;
  }): Promise<AgentRun> {
    return this.#request("", input.sessionId, input.agentId, {
      method: "POST",
      body: {
        objective: input.objective,
        goal_id: input.goalId,
        budget: encodeBudget(input.budget),
        idempotency_key: input.idempotencyKey,
      },
    });
  }

  get(input: { sessionId: string; agentId: string; runId: string }): Promise<AgentRun> {
    return this.#request(`/${input.runId}`, input.sessionId, input.agentId);
  }

  async getActive(input: { sessionId: string; agentId: string }): Promise<AgentRun | undefined> {
    return (
      (await this.#request<AgentRun | null>("/active", input.sessionId, input.agentId, {
        allowNotFound: true,
      })) ?? undefined
    );
  }

  claim(input: {
    sessionId: string;
    agentId: string;
    workerId: string;
    limit?: number;
    leaseSeconds?: number;
  }): Promise<AgentRun[]> {
    return this.#request("/claim", input.sessionId, input.agentId, {
      method: "POST",
      body: {
        worker_id: input.workerId,
        limit: input.limit ?? 10,
        lease_seconds: input.leaseSeconds ?? 300,
      },
    });
  }

  appendStep(input: {
    sessionId: string;
    agentId: string;
    runId: string;
    workerId: string;
    stepId: string;
    continuation: number;
    toolCallCount: number;
    progressFingerprint?: string;
    responseFingerprint?: string;
    inputTokens: number;
    outputTokens: number;
    costMicrousd: number;
    elapsedMs: number;
    outcome: string;
    payload: JsonValue;
  }): Promise<AgentRun> {
    return this.#request(`/${input.runId}/steps`, input.sessionId, input.agentId, {
      method: "POST",
      headers: { "x-tilde-agent-run-worker": input.workerId },
      body: {
        step_id: input.stepId,
        continuation: input.continuation,
        tool_call_count: input.toolCallCount,
        progress_fingerprint: input.progressFingerprint,
        response_fingerprint: input.responseFingerprint,
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
        cost_microusd: input.costMicrousd,
        elapsed_ms: input.elapsedMs,
        outcome: input.outcome,
        payload: input.payload,
      },
    });
  }

  transition(input: {
    sessionId: string;
    agentId: string;
    runId: string;
    status: AgentRunStatus;
    reason?: string;
    result?: JsonValue;
    expectedGeneration: number;
    workerId: string;
  }): Promise<AgentRun> {
    return this.#request(`/${input.runId}/transition`, input.sessionId, input.agentId, {
      method: "POST",
      body: {
        status: input.status,
        reason: input.reason,
        result: input.result,
        expected_generation: input.expectedGeneration,
        worker_id: input.workerId,
      },
    });
  }

  control(input: {
    sessionId: string;
    agentId: string;
    runId: string;
    status: AgentRunStatus;
    reason?: string;
    result?: JsonValue;
  }): Promise<AgentRun> {
    return this.#request(`/${input.runId}/control`, input.sessionId, input.agentId, {
      method: "POST",
      body: { status: input.status, reason: input.reason, result: input.result },
    });
  }

  reactivate(input: { sessionId: string; agentId: string; runId: string }): Promise<AgentRun> {
    return this.control({ ...input, status: "active", reason: "new_user_message" });
  }

  pause(input: { sessionId: string; agentId: string; runId: string; reason?: string }) {
    return this.control({ ...input, status: "paused", reason: input.reason });
  }

  resume(input: { sessionId: string; agentId: string; runId: string }) {
    return this.control({ ...input, status: "active", reason: "owner_resume" });
  }

  cancel(input: { sessionId: string; agentId: string; runId: string; reason?: string }) {
    return this.control({ ...input, status: "canceled", reason: input.reason });
  }

  getEffect(input: {
    sessionId: string;
    agentId: string;
    runId: string;
    toolName: string;
    inputFingerprint: string;
  }): Promise<AgentRunEffectReceipt | undefined> {
    return this.#request(`/${input.runId}/effects/lookup`, input.sessionId, input.agentId, {
      query: {
        tool_name: input.toolName,
        input_fingerprint: input.inputFingerprint,
      },
      allowNotFound: true,
    });
  }

  prepareEffect(input: {
    sessionId: string;
    agentId: string;
    runId: string;
    generation: number;
    workerId: string;
    stepId: string;
    toolCallId: string;
    toolName: string;
    inputFingerprint: string;
    idempotencyKey: string;
  }): Promise<AgentRunEffectReceipt> {
    return this.#request(`/${input.runId}/effects/prepare`, input.sessionId, input.agentId, {
      method: "POST",
      body: {
        generation: input.generation,
        worker_id: input.workerId,
        step_id: input.stepId,
        tool_call_id: input.toolCallId,
        tool_name: input.toolName,
        input_fingerprint: input.inputFingerprint,
        idempotency_key: input.idempotencyKey,
        status: "planned",
      },
    });
  }

  finishEffect(input: {
    sessionId: string;
    agentId: string;
    runId: string;
    generation: number;
    workerId: string;
    stepId: string;
    toolCallId: string;
    toolName: string;
    inputFingerprint: string;
    idempotencyKey: string;
    status: "committed" | "uncertain";
    output?: JsonValue;
  }): Promise<AgentRunEffectReceipt> {
    return this.#request(`/${input.runId}/effects/finish`, input.sessionId, input.agentId, {
      method: "POST",
      body: {
        generation: input.generation,
        worker_id: input.workerId,
        step_id: input.stepId,
        tool_call_id: input.toolCallId,
        tool_name: input.toolName,
        input_fingerprint: input.inputFingerprint,
        idempotency_key: input.idempotencyKey,
        status: input.status,
        output: input.output,
      },
    });
  }

  async #request<T>(
    suffix: string,
    sessionId: string,
    agentId: string,
    options: {
      method?: string;
      body?: JsonValue;
      query?: Record<string, string | number | boolean | null | undefined>;
      headers?: RequestInit["headers"];
      allowNotFound?: boolean;
    } = {},
  ): Promise<T> {
    const path = pathWithParams(teamPath(this.#config, `${RUNS}${suffix}`), {
      session_id: sessionId,
      agent_id: agentId,
    });
    try {
      const raw = await requestJson<unknown>(this.#config, {
        method: options.method,
        path,
        body: options.body,
        query: options.query,
        headers: options.headers,
      });
      return decode(raw) as T;
    } catch (error) {
      if (options.allowNotFound && isStatus(error, 404)) return undefined as T;
      throw error;
    }
  }
}

function encodeBudget(value: AgentRunBudget | undefined) {
  if (!value) return {};
  return {
    max_steps: value.maxSteps,
    max_input_tokens: value.maxInputTokens,
    max_output_tokens: value.maxOutputTokens,
    max_cost_microusd: value.maxCostMicrousd,
    max_duration_seconds: value.maxDurationSeconds,
  };
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = decode(child);
  }
  return result;
}

function isStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" && error !== null && "status" in error && error.status === status
  );
}
