import type { AgentRunsClient, AiCreditsClient, JsonValue } from "@trytilde/sdk";
import {
  HostedInferenceBillingController,
  type HostedInferenceBillingControllerOptions,
} from "./hosted-inference-billing";

type SynthesisRunStore = Pick<
  AgentRunsClient,
  | "create"
  | "reactivate"
  | "claim"
  | "appendStep"
  | "transition"
  | "getEffect"
  | "prepareEffect"
  | "finishEffect"
>;

export type MemorySynthesisInvocation = {
  batchId: string;
  leaseOwner: string;
  evidenceIds: string[];
  triggerMessageId: string;
  webhookId: string;
};

export type MemorySynthesisInferenceRun = {
  invocation: MemorySynthesisInvocation;
  billing: HostedInferenceBillingController;
  complete(input: {
    inputTokens: number;
    outputTokens: number;
    toolCallCount: number;
    responseText: string;
    synthesisFinished: boolean;
  }): Promise<void>;
  pauseForCredits(): Promise<void>;
  failForReconciliation(): Promise<void>;
  fail(error?: unknown): Promise<boolean>;
};

export type CreateMemorySynthesisInferenceRunOptions = {
  runs: SynthesisRunStore;
  credits: Pick<AiCreditsClient, "reserve" | "commit" | "release">;
  sessionId: string;
  agentId: string;
  webhookId: string;
  messages: readonly {
    id: string;
    role: string;
    parts: readonly ({ type: string; text?: string } | Record<string, unknown>)[];
  }[];
  billingEnabled: boolean;
  estimatedCostMicrousd: number;
  tags?: string[];
  /** Proves the exact batch, evidence set, and lease are current before billing. */
  validateBatch(input: {
    batchId: string;
    evidenceIds: string[];
    leaseOwner: string;
  }): Promise<unknown>;
  generationInfo?: HostedInferenceBillingControllerOptions["generationInfo"];
};

/** Raised when a webhook is not an exact server-authored memory synthesis turn. */
export class InvalidMemorySynthesisInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMemorySynthesisInvocationError";
  }
}

/** Raised when another delivery still owns the synthesis run lease. */
export class MemorySynthesisRunAlreadyClaimedError extends Error {
  constructor(readonly runId: string) {
    super("This memory synthesis batch is already being processed.");
    this.name = "MemorySynthesisRunAlreadyClaimedError";
  }
}

/** Raised when a prior provider attempt made the batch unsafe to invoke again. */
export class MemorySynthesisRunTerminalError extends Error {
  constructor(readonly runId: string) {
    super("This memory synthesis batch already reached a terminal inference outcome.");
    this.name = "MemorySynthesisRunTerminalError";
  }
}

/** Raised when an idempotent delivery arrives after the batch run completed. */
export class MemorySynthesisRunCompletedError extends Error {
  constructor(readonly runId: string) {
    super("This memory synthesis batch was already completed.");
    this.name = "MemorySynthesisRunCompletedError";
  }
}

/**
 * Claim one durable AgentRun for an exact synthesis batch and attach hosted
 * billing to that run's generation-fenced effect ledger.
 */
export async function createMemorySynthesisInferenceRun(
  options: CreateMemorySynthesisInferenceRunOptions,
): Promise<MemorySynthesisInferenceRun> {
  const invocation = parseMemorySynthesisInvocation(options.messages, options.webhookId);
  await options.validateBatch({
    batchId: invocation.batchId,
    evidenceIds: invocation.evidenceIds,
    leaseOwner: invocation.leaseOwner,
  });
  // A reclaimed API worker receives a new lease owner and must perform its own
  // lease-fenced synthesis turn. Redelivery within one lease shares this run,
  // even if the webhook or trigger message is delivered more than once.
  const stableRunKey = `memory-synthesis:${invocation.batchId}:${invocation.leaseOwner}`;
  let run = await options.runs.create({
    sessionId: options.sessionId,
    agentId: options.agentId,
    objective:
      `Synthesize memory batch ${invocation.batchId} from trigger ` +
      `${invocation.triggerMessageId} (webhook ${invocation.webhookId})`,
    idempotencyKey: stableRunKey,
  });
  if (run.status === "paused") {
    run = await options.runs.reactivate({
      sessionId: options.sessionId,
      agentId: options.agentId,
      runId: run.id,
    });
  }
  if (run.status === "completed") throw new MemorySynthesisRunCompletedError(run.id);
  if (!["active", "waiting"].includes(run.status)) {
    throw new MemorySynthesisRunTerminalError(run.id);
  }

  const workerId = `memory-synthesis:${invocation.webhookId}`;
  const claimed = await options.runs.claim({
    sessionId: options.sessionId,
    agentId: options.agentId,
    workerId,
    limit: 10,
    leaseSeconds: 300,
  });
  const claimedRun = claimed.find((candidate) => candidate.id === run.id);
  if (!claimedRun) throw new MemorySynthesisRunAlreadyClaimedError(run.id);
  run = claimedRun;

  const stepId = `${run.generation}:${run.continuationCount + 1}`;
  const billing = new HostedInferenceBillingController({
    enabled: options.billingEnabled,
    credits: options.credits,
    effects: options.runs,
    sessionId: options.sessionId,
    agentId: options.agentId,
    runId: run.id,
    runGeneration: run.generation,
    workerId,
    stepId,
    effectScope: `synthesis:${invocation.batchId}:${invocation.leaseOwner}`,
    estimatedCostMicrousd: options.estimatedCostMicrousd,
    tags: options.tags,
    generationInfo: options.generationInfo,
  });

  const transition = async (
    status: "waiting" | "paused" | "completed" | "failed",
    reason?: string,
    result?: JsonValue,
  ): Promise<void> => {
    run = await options.runs.transition({
      sessionId: options.sessionId,
      agentId: options.agentId,
      runId: run.id,
      status,
      expectedGeneration: run.generation,
      workerId,
      ...(reason ? { reason } : {}),
      ...(result === undefined ? {} : { result }),
    });
  };

  return {
    invocation,
    billing,
    async complete(input) {
      run = await options.runs.appendStep({
        sessionId: options.sessionId,
        agentId: options.agentId,
        runId: run.id,
        workerId,
        stepId,
        continuation: run.continuationCount + 1,
        toolCallCount: input.toolCallCount,
        responseFingerprint: input.responseText.trim() || undefined,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costMicrousd: billing.totalCostMicrousd,
        elapsedMs: 0,
        outcome: input.synthesisFinished ? "completed" : "failed",
        payload: {
          batchId: invocation.batchId,
          triggerMessageId: invocation.triggerMessageId,
          synthesisFinished: input.synthesisFinished,
        },
      });
      await transition(
        input.synthesisFinished ? "completed" : "failed",
        input.synthesisFinished ? undefined : "synthesis_completion_missing",
        input.synthesisFinished
          ? { batchId: invocation.batchId, triggerMessageId: invocation.triggerMessageId }
          : undefined,
      );
    },
    async pauseForCredits() {
      await transition("paused", "ai_credits_exhausted");
    },
    async failForReconciliation() {
      await transition("failed", "inference_reconciliation_required");
    },
    async fail(error) {
      const reconciliationRequired = await billing.fail(error);
      await transition(
        "waiting",
        reconciliationRequired ? "inference_settlement_pending" : "provider_failed_before_start",
      );
      return reconciliationRequired;
    },
  };
}

/** Parse the exact batch, evidence set, and worker lease from Tilde's prompt. */
export function parseMemorySynthesisInvocation(
  messages: CreateMemorySynthesisInferenceRunOptions["messages"],
  webhookId: string,
): MemorySynthesisInvocation {
  const message = [...messages].reverse().find((candidate) => candidate.role === "user");
  if (!message)
    throw new InvalidMemorySynthesisInvocationError("Missing synthesis trigger message");
  const prompt = message.parts
    .filter(
      (part): part is { type: string; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
  const match = prompt.match(
    /^Process batch `([a-f0-9]{64})` under lease owner `([^`\r\n]+)` containing evidence IDs ([0-9a-f-]+(?:,[0-9a-f-]+)*) for your current session-bound memory bank\./,
  );
  if (!match) {
    throw new InvalidMemorySynthesisInvocationError(
      "Synthesis trigger does not contain the exact Tilde batch and lease contract",
    );
  }
  const [, batchId, leaseOwner, evidenceList] = match;
  const evidenceIds = evidenceList!.split(",");
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new InvalidMemorySynthesisInvocationError("Synthesis evidence IDs must be unique");
  }
  if (!webhookId.trim()) throw new InvalidMemorySynthesisInvocationError("webhookId is required");
  return {
    batchId: batchId!,
    leaseOwner: leaseOwner!,
    evidenceIds,
    triggerMessageId: message.id,
    webhookId,
  };
}

/** Require both the exact completion marker and a non-error finish tool result. */
export function didMemorySynthesisFinish(input: {
  batchId: string;
  text: string;
  steps: readonly {
    toolResults: readonly {
      toolName: string;
      output?: unknown;
    }[];
  }[];
}): boolean {
  if (!input.text.includes(`SYNTHESIS_COMPLETE:${input.batchId}`)) return false;
  return input.steps.some((step) =>
    step.toolResults.some((result) => {
      if (result.toolName !== "finish_synthesis") return false;
      const output = record(result.output);
      return output !== undefined && output.isError !== true && output.is_error !== true;
    }),
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
