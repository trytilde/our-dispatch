import type {
  AgentRun,
  AgentRunBudget,
  AgentRunStatus,
  AgentRunsClient,
  JsonValue,
} from "@trytilde/sdk";

export type AgentRunUsage = {
  inputTokens: number;
  outputTokens: number;
  costMicrousd: number;
  elapsedMs: number;
};

export type AgentRunTurnResult = {
  toolCallCount: number;
  toolCallFingerprints?: string[];
  progress?: string;
  response?: string;
  usage: AgentRunUsage;
  objectiveComplete?: boolean;
  needsUser?: boolean;
  result?: JsonValue;
  payload?: JsonValue;
};

export type AgentRunStore = Pick<
  AgentRunsClient,
  | "create"
  | "claim"
  | "appendStep"
  | "transition"
  | "reactivate"
  | "getEffect"
  | "prepareEffect"
  | "finishEffect"
>;

export type AgentRunControllerOptions = {
  store: AgentRunStore;
  sessionId: string;
  agentId: string;
  workerId: string;
  objective: string;
  goalId?: string;
  budget?: AgentRunBudget;
  idempotencyKey: string;
  maxContinuationsPerInvocation?: number;
  invocationDeadlineMs?: number;
  repeatedPatternLimit?: number;
  executeTurn(input: {
    run: AgentRun;
    continuation: number;
    stepId: string;
    signal?: AbortSignal;
  }): Promise<AgentRunTurnResult>;
};

export type AgentRunControllerResult = {
  run: AgentRun;
  continued: number;
};

/** Claim and resume all due runs for one agent/session after process or deployment restart. */
export async function runAgentHostOnce(input: {
  store: AgentRunStore;
  sessionId: string;
  agentId: string;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
  handle(run: AgentRun): Promise<void>;
}): Promise<AgentRun[]> {
  const claimed = await input.store.claim({
    sessionId: input.sessionId,
    agentId: input.agentId,
    workerId: input.workerId,
    limit: input.limit ?? 10,
    leaseSeconds: input.leaseSeconds ?? 300,
  });
  for (const run of claimed) {
    // Do not perform an unfenced state transition after a handler failure: an
    // owner may have paused or canceled the run while this worker was active.
    // Leaving the current lease in place lets Tilde reclaim it safely on expiry.
    await input.handle(run);
  }
  return claimed;
}

/** Continue one durable objective until a real terminal/pause/stall or invocation boundary. */
export async function runAgentObjective(
  options: AgentRunControllerOptions,
  signal?: AbortSignal,
): Promise<AgentRunControllerResult> {
  let run = await options.store.create({
    sessionId: options.sessionId,
    agentId: options.agentId,
    objective: options.objective,
    goalId: options.goalId,
    budget: options.budget,
    idempotencyKey: options.idempotencyKey,
  });
  if (run.status === "paused" || run.status === "stalled" || terminal(run.status)) {
    return { run, continued: 0 };
  }
  const claimed = await options.store.claim({
    sessionId: options.sessionId,
    agentId: options.agentId,
    workerId: options.workerId,
    limit: 10,
    leaseSeconds: 300,
  });
  run = claimed.find((candidate) => candidate.id === run.id) ?? run;
  const maxContinuations = options.maxContinuationsPerInvocation ?? 50;
  const deadline = Date.now() + (options.invocationDeadlineMs ?? 280_000);
  const repeatedLimit = options.repeatedPatternLimit ?? 3;
  let lastProgress: string | undefined;
  let repeatedProgress = 0;
  let lastResponse: string | undefined;
  let repeatedResponse = 0;
  let lastToolPattern: string | undefined;
  let repeatedToolPattern = 0;
  let continued = 0;

  while (continued < maxContinuations && Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason;
    const continuation = run.continuationCount + 1;
    const stepId = `${run.generation}:${continuation}`;
    const turn = await options.executeTurn({ run, continuation, stepId, signal });
    const progressFingerprint = turn.progress ? await fingerprint(turn.progress) : undefined;
    const responseFingerprint = turn.response ? await fingerprint(turn.response) : undefined;
    const toolPattern = turn.toolCallFingerprints?.join("|");
    repeatedProgress =
      progressFingerprint && progressFingerprint === lastProgress ? repeatedProgress + 1 : 0;
    repeatedResponse =
      responseFingerprint && responseFingerprint === lastResponse ? repeatedResponse + 1 : 0;
    lastProgress = progressFingerprint;
    lastResponse = responseFingerprint;
    repeatedToolPattern =
      toolPattern && toolPattern === lastToolPattern ? repeatedToolPattern + 1 : 0;
    lastToolPattern = toolPattern;
    run = await options.store.appendStep({
      sessionId: options.sessionId,
      agentId: options.agentId,
      runId: run.id,
      workerId: options.workerId,
      stepId,
      continuation,
      toolCallCount: turn.toolCallCount,
      progressFingerprint,
      responseFingerprint,
      ...turn.usage,
      outcome: turn.objectiveComplete ? "completed" : turn.needsUser ? "needs_user" : "continued",
      payload: turn.payload ?? {},
    });
    continued += 1;

    const budgetReason = exceededBudget(run);
    if (budgetReason) {
      run = await options.store.transition({
        sessionId: options.sessionId,
        agentId: options.agentId,
        runId: run.id,
        status: "failed",
        reason: budgetReason,
        expectedGeneration: run.generation,
        workerId: options.workerId,
      });
      return { run, continued };
    }
    if (turn.objectiveComplete) {
      run = await options.store.transition({
        sessionId: options.sessionId,
        agentId: options.agentId,
        runId: run.id,
        status: "completed",
        result: turn.result,
        expectedGeneration: run.generation,
        workerId: options.workerId,
      });
      return { run, continued };
    }
    if (turn.needsUser || run.noProgressCount >= 3) {
      run = await options.store.transition({
        sessionId: options.sessionId,
        agentId: options.agentId,
        runId: run.id,
        status: "paused",
        reason: turn.needsUser ? "user_input_required" : "three_no_progress_continuations",
        expectedGeneration: run.generation,
        workerId: options.workerId,
      });
      return { run, continued };
    }
    if (
      repeatedProgress >= repeatedLimit - 1 ||
      repeatedResponse >= repeatedLimit - 1 ||
      repeatedToolPattern >= repeatedLimit - 1
    ) {
      run = await options.store.transition({
        sessionId: options.sessionId,
        agentId: options.agentId,
        runId: run.id,
        status: "stalled",
        reason: "repeated_progress_or_response_pattern",
        expectedGeneration: run.generation,
        workerId: options.workerId,
      });
      return { run, continued };
    }
  }

  run = await options.store.transition({
    sessionId: options.sessionId,
    agentId: options.agentId,
    runId: run.id,
    status: "waiting",
    reason: "continuation_boundary",
    expectedGeneration: run.generation,
    workerId: options.workerId,
  });
  return { run, continued };
}

/** Reactivate the latest paused/stalled run when a new human message arrives. */
export async function reactivateAgentRun(
  store: AgentRunStore,
  input: { sessionId: string; agentId: string; runId: string },
): Promise<AgentRun> {
  return store.reactivate(input);
}

/** Execute a tool effect once per durable run/tool/input fingerprint. */
export async function executeRunEffect<T extends JsonValue>(input: {
  store: AgentRunStore;
  sessionId: string;
  agentId: string;
  runId: string;
  stepId: string;
  toolCallId: string;
  toolName: string;
  args: JsonValue;
  supportsIdempotency?: boolean;
  expectedGeneration: number;
  workerId: string;
  execute(idempotencyKey: string): Promise<T>;
}): Promise<T> {
  const inputFingerprint = await fingerprint(stableStringify(input.args));
  const existing = await input.store.getEffect({
    sessionId: input.sessionId,
    agentId: input.agentId,
    runId: input.runId,
    toolName: input.toolName,
    inputFingerprint,
  });
  if (existing?.status === "committed") return existing.output as T;
  if (existing?.status === "uncertain") {
    throw new UncertainAgentRunEffectError(existing.idempotencyKey);
  }
  const idempotencyKey = `${input.runId}:${input.stepId}:${input.toolCallId}`;
  if (existing?.status === "planned" && !input.supportsIdempotency) {
    await input.store.finishEffect({
      sessionId: input.sessionId,
      agentId: input.agentId,
      runId: input.runId,
      generation: input.expectedGeneration,
      workerId: input.workerId,
      stepId: input.stepId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      inputFingerprint,
      idempotencyKey: existing.idempotencyKey,
      status: "uncertain",
    });
    await input.store.transition({
      sessionId: input.sessionId,
      agentId: input.agentId,
      runId: input.runId,
      status: "waiting",
      reason: "uncertain_tool_effect_requires_reconciliation",
      expectedGeneration: input.expectedGeneration,
      workerId: input.workerId,
    });
    throw new UncertainAgentRunEffectError(existing.idempotencyKey);
  }
  await input.store.prepareEffect({
    sessionId: input.sessionId,
    agentId: input.agentId,
    runId: input.runId,
    generation: input.expectedGeneration,
    workerId: input.workerId,
    stepId: input.stepId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    inputFingerprint,
    idempotencyKey,
  });
  try {
    const output = await input.execute(existing?.idempotencyKey ?? idempotencyKey);
    const receipt = await input.store.finishEffect({
      sessionId: input.sessionId,
      agentId: input.agentId,
      runId: input.runId,
      generation: input.expectedGeneration,
      workerId: input.workerId,
      stepId: input.stepId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      inputFingerprint,
      idempotencyKey: existing?.idempotencyKey ?? idempotencyKey,
      status: "committed",
      output,
    });
    return receipt.output as T;
  } catch (error) {
    await input.store.finishEffect({
      sessionId: input.sessionId,
      agentId: input.agentId,
      runId: input.runId,
      generation: input.expectedGeneration,
      workerId: input.workerId,
      stepId: input.stepId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      inputFingerprint,
      idempotencyKey: existing?.idempotencyKey ?? idempotencyKey,
      status: "uncertain",
    });
    throw error;
  }
}

export class UncertainAgentRunEffectError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Tool effect ${idempotencyKey} has an uncertain outcome and will not be repeated`);
    this.name = "UncertainAgentRunEffectError";
  }
}

function terminal(status: AgentRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function exceededBudget(run: AgentRun): string | undefined {
  const budget = run.budget;
  if (budget.maxSteps !== undefined && run.stepCount >= budget.maxSteps)
    return "max_steps_exceeded";
  if (budget.maxInputTokens !== undefined && run.inputTokens >= budget.maxInputTokens)
    return "max_input_tokens_exceeded";
  if (budget.maxOutputTokens !== undefined && run.outputTokens >= budget.maxOutputTokens)
    return "max_output_tokens_exceeded";
  if (budget.maxCostMicrousd !== undefined && run.costMicrousd >= budget.maxCostMicrousd)
    return "max_cost_exceeded";
  if (budget.maxDurationSeconds !== undefined && run.elapsedMs >= budget.maxDurationSeconds * 1_000)
    return "max_duration_exceeded";
  return undefined;
}

async function fingerprint(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key]!)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
