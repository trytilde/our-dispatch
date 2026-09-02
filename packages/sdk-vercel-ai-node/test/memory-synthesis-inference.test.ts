import { ApiError, type AgentRun, type AgentRunEffectReceipt, type JsonValue } from "@trytilde/sdk";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createMemorySynthesisInferenceRun,
  didMemorySynthesisFinish,
  HostedInferenceCreditsExhaustedError,
  HostedInferenceReconciliationRequiredError,
  InvalidMemorySynthesisInvocationError,
  MemorySynthesisRunCompletedError,
  parseMemorySynthesisInvocation,
} from "../src";

const batchId = "a".repeat(64);
const evidenceId = "11111111-1111-4111-8111-111111111111";

function messages(triggerMessageId = "trigger-one", leaseOwner = "lease-one") {
  return [
    {
      id: triggerMessageId,
      role: "user",
      parts: [
        {
          type: "text",
          text:
            `Process batch \`${batchId}\` under lease owner \`${leaseOwner}\` containing evidence IDs ` +
            `${evidenceId} for your current session-bound memory bank. Evidence follows.`,
        },
      ],
    },
  ];
}

function harness(
  options: {
    enabled?: boolean;
    byok?: boolean;
    reserveFailure?: Error;
    verifyFailure?: Error;
    commitFailure?: Error;
    releaseFailure?: Error;
    shared?: ReturnType<typeof state>;
  } = {},
) {
  const shared = options.shared ?? state();
  const reserve = vi.fn(async () => {
    if (options.reserveFailure) throw options.reserveFailure;
    return { id: "reservation-one", reservedMicrousd: 250_000, expiresAt: "later" };
  });
  const commit = vi.fn(async () => {
    if (options.commitFailure) throw options.commitFailure;
    return creditContext();
  });
  const release = vi.fn(async () => {
    if (options.releaseFailure) throw options.releaseFailure;
    return creditContext();
  });
  const validateBatch = vi.fn(async () => {
    if (options.verifyFailure) throw options.verifyFailure;
    return { items: [] };
  });
  const runStore = {
    create: vi.fn(async (input: { objective: string; idempotencyKey: string }) => {
      shared.createInputs.push(input);
      return shared.run;
    }),
    reactivate: vi.fn(async () => {
      shared.run = { ...shared.run, status: "active", generation: shared.run.generation + 1 };
      return shared.run;
    }),
    claim: vi.fn(async () => [shared.run]),
    appendStep: vi.fn(async () => {
      shared.run = { ...shared.run, stepCount: shared.run.stepCount + 1 };
      return shared.run;
    }),
    transition: vi.fn(async (input: { status: AgentRun["status"] }) => {
      shared.run = { ...shared.run, status: input.status };
      return shared.run;
    }),
    getEffect: vi.fn(async () => shared.effect),
    prepareEffect: vi.fn(async (input: Record<string, unknown>) => {
      shared.effect = receipt(input, "planned");
      return shared.effect;
    }),
    finishEffect: vi.fn(async (input: Record<string, unknown>) => {
      shared.effect = receipt(
        input,
        String(input.status) as "committed" | "uncertain",
        input.output as JsonValue,
      );
      return shared.effect;
    }),
  };
  return {
    shared,
    reserve,
    commit,
    release,
    validateBatch,
    runStore,
    async create(webhookId = "webhook-one", leaseOwner = "lease-one") {
      return createMemorySynthesisInferenceRun({
        runs: runStore,
        credits: { reserve, commit, release },
        sessionId: "session-one",
        agentId: "memory-catcher",
        webhookId,
        messages: messages("trigger-one", leaseOwner),
        billingEnabled: options.enabled ?? true,
        estimatedCostMicrousd: 250_000,
        validateBatch,
        generationInfo: vi.fn(async (id) => ({
          id,
          totalCost: 0.001234,
          model: "openai/gpt-5.6-sol",
          isByok: options.byok ?? false,
          providerName: "openai",
          promptTokens: 10,
          completionTokens: 2,
        })),
      });
    },
  };
}

describe("memory synthesis inference", () => {
  it("parses the exact signed batch, lease, evidence, and trigger identity", () => {
    expect(parseMemorySynthesisInvocation(messages(), "webhook-one")).toEqual({
      batchId,
      leaseOwner: "lease-one",
      evidenceIds: [evidenceId],
      triggerMessageId: "trigger-one",
      webhookId: "webhook-one",
    });
    expect(() =>
      parseMemorySynthesisInvocation(
        [{ id: "human", role: "user", parts: [{ type: "text", text: "remember this" }] }],
        "webhook-two",
      ),
    ).toThrow(InvalidMemorySynthesisInvocationError);
  });

  it("rejects a spoofed lease in a valid synthesis session before run creation or billing", async () => {
    const h = harness({ verifyFailure: new Error("batch is not the current leased claim") });
    await expect(h.create()).rejects.toThrow("batch is not the current leased claim");
    expect(h.validateBatch).toHaveBeenCalledWith({
      batchId,
      evidenceIds: [evidenceId],
      leaseOwner: "lease-one",
    });
    expect(h.runStore.create).not.toHaveBeenCalled();
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("reserves and settles managed Gateway synthesis against one batch run", async () => {
    const h = harness();
    const synthesis = await h.create();
    await synthesis.billing.preflight("openai/gpt-5.6-sol");
    await synthesis.billing.onLanguageModelCallStart({
      callId: "call-one",
      modelId: "openai/gpt-5.6-sol",
    });
    await synthesis.billing.onLanguageModelCallEnd({
      callId: "call-one",
      providerMetadata: { gateway: { generationId: "generation-one" } },
    });
    await synthesis.complete({
      inputTokens: 10,
      outputTokens: 2,
      toolCallCount: 1,
      responseText: `SYNTHESIS_COMPLETE:${batchId}`,
      synthesisFinished: true,
    });

    expect(h.shared.createInputs[0]).toEqual(
      expect.objectContaining({ idempotencyKey: `memory-synthesis:${batchId}:lease-one` }),
    );
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.runStore.prepareEffect).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 1, workerId: "memory-synthesis:webhook-one" }),
    );
    expect(h.commit).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: "generation-one", actualCostMicrousd: 1_234 }),
    );
    expect(h.runStore.transition).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("releases an authoritative Gateway BYOK generation", async () => {
    const h = harness({ byok: true });
    const synthesis = await h.create();
    await synthesis.billing.preflight("openai/gpt-5.6-sol");
    await synthesis.billing.onLanguageModelCallStart({
      callId: "call-one",
      modelId: "openai/gpt-5.6-sol",
    });
    await synthesis.billing.onLanguageModelCallEnd({
      callId: "call-one",
      providerMetadata: { gateway: { generationId: "generation-one" } },
    });
    expect(h.release).toHaveBeenCalledWith("reservation-one");
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("replays a committed receipt after settlement fails without repeating inference", async () => {
    const shared = state();
    const first = harness({ shared, commitFailure: new Error("commit unavailable") });
    const firstRun = await first.create("webhook-one");
    await firstRun.billing.preflight("openai/gpt-5.6-sol");
    await firstRun.billing.onLanguageModelCallStart({
      callId: "call-one",
      modelId: "openai/gpt-5.6-sol",
    });
    let failure: unknown;
    try {
      await firstRun.billing.onLanguageModelCallEnd({
        callId: "call-one",
        providerMetadata: { gateway: { generationId: "generation-one" } },
      });
    } catch (error) {
      failure = error;
    }
    await expect(firstRun.fail(failure)).resolves.toBe(true);
    expect(first.runStore.transition).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "waiting", reason: "inference_settlement_pending" }),
    );

    shared.run = { ...shared.run, generation: 2 };
    const retry = harness({ shared });
    const retryRun = await retry.create("webhook-two");
    await expect(retryRun.billing.preflight("openai/gpt-5.6-sol")).rejects.toBeInstanceOf(
      HostedInferenceReconciliationRequiredError,
    );
    expect(retry.commit).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: "generation-one" }),
    );
    expect(retry.reserve).not.toHaveBeenCalled();
    await retryRun.failForReconciliation();
    expect(retry.runStore.transition).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "failed", reason: "inference_reconciliation_required" }),
    );
  });

  it("replays a committed BYOK release after a failed release boundary", async () => {
    const shared = state();
    const first = harness({ shared, byok: true, releaseFailure: new Error("release unavailable") });
    const firstRun = await first.create("webhook-one");
    await firstRun.billing.preflight("openai/gpt-5.6-sol");
    await firstRun.billing.onLanguageModelCallStart({
      callId: "call-one",
      modelId: "openai/gpt-5.6-sol",
    });
    let failure: unknown;
    try {
      await firstRun.billing.onLanguageModelCallEnd({
        callId: "call-one",
        providerMetadata: { gateway: { generationId: "generation-one" } },
      });
    } catch (error) {
      failure = error;
    }
    await expect(firstRun.fail(failure)).resolves.toBe(true);

    shared.run = { ...shared.run, generation: 2 };
    const retry = harness({ shared, byok: true });
    const retryRun = await retry.create("webhook-two");
    await expect(retryRun.billing.preflight("openai/gpt-5.6-sol")).rejects.toBeInstanceOf(
      HostedInferenceReconciliationRequiredError,
    );
    expect(retry.release).toHaveBeenCalledWith("reservation-one");
    expect(retry.reserve).not.toHaveBeenCalled();
  });

  it("pauses without starting inference when credits are exhausted", async () => {
    const h = harness({
      reserveFailure: new ApiError("exhausted", new Response(null, { status: 402 }), null),
    });
    const synthesis = await h.create();
    await expect(synthesis.billing.preflight("openai/gpt-5.6-sol")).rejects.toBeInstanceOf(
      HostedInferenceCreditsExhaustedError,
    );
    await synthesis.pauseForCredits();
    expect(h.runStore.prepareEffect).not.toHaveBeenCalled();
    expect(h.runStore.transition).toHaveBeenCalledWith(
      expect.objectContaining({ status: "paused", reason: "ai_credits_exhausted" }),
    );
  });

  it("blocks a reclaimed delivery before repeating a planned provider call", async () => {
    const shared = state();
    const first = harness({ shared });
    const firstRun = await first.create("webhook-one");
    await firstRun.billing.preflight("openai/gpt-5.6-sol");
    await firstRun.billing.onLanguageModelCallStart({
      callId: "call-one",
      modelId: "openai/gpt-5.6-sol",
    });

    shared.run = { ...shared.run, generation: 2 };
    const retry = harness({ shared });
    const retryRun = await retry.create("webhook-two");
    await expect(retryRun.billing.preflight("openai/gpt-5.6-sol")).rejects.toBeInstanceOf(
      HostedInferenceReconciliationRequiredError,
    );
    await retryRun.failForReconciliation();
    expect(first.reserve).toHaveBeenCalledOnce();
    expect(retry.reserve).not.toHaveBeenCalled();
    expect(retry.runStore.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        reason: "inference_reconciliation_required",
        expectedGeneration: 2,
      }),
    );
  });

  it("acknowledges a completed delivery without reopening inference", async () => {
    const shared = state();
    shared.run = { ...shared.run, status: "completed" };
    const h = harness({ shared });
    await expect(h.create()).rejects.toBeInstanceOf(MemorySynthesisRunCompletedError);
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.runStore.claim).not.toHaveBeenCalled();
  });

  it("gives a freshly reclaimed API lease its own fenced run identity", async () => {
    const oldLease = harness();
    await oldLease.create("webhook-one", "lease-one");
    const newLease = harness();
    await newLease.create("webhook-two", "lease-two");
    expect(oldLease.shared.createInputs[0]?.idempotencyKey).toBe(
      `memory-synthesis:${batchId}:lease-one`,
    );
    expect(newLease.shared.createInputs[0]?.idempotencyKey).toBe(
      `memory-synthesis:${batchId}:lease-two`,
    );
  });

  it("keeps direct Gateway-key and Codex paths outside hosted metering", async () => {
    const h = harness({ enabled: false });
    const synthesis = await h.create();
    await synthesis.billing.preflight("gpt-5.6-sol");
    await synthesis.billing.onLanguageModelCallStart({
      callId: "call-one",
      modelId: "gpt-5.6-sol",
    });
    await synthesis.billing.onLanguageModelCallEnd({ callId: "call-one" });
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.runStore.prepareEffect).not.toHaveBeenCalled();
  });

  it("fails the batch run when synthesis completion was not durably observed", async () => {
    const h = harness({ enabled: false });
    const synthesis = await h.create();
    await synthesis.complete({
      inputTokens: 1,
      outputTokens: 1,
      toolCallCount: 0,
      responseText: "incomplete",
      synthesisFinished: false,
    });
    expect(h.runStore.transition).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "failed", reason: "synthesis_completion_missing" }),
    );
  });

  it("does not accept a completion marker paired with an error finish result", () => {
    expect(
      didMemorySynthesisFinish({
        batchId,
        text: `SYNTHESIS_COMPLETE:${batchId}`,
        steps: [
          {
            toolResults: [
              { toolName: "finish_synthesis", output: { isError: true, message: "stale lease" } },
            ],
          },
        ],
      }),
    ).toBe(false);
    expect(
      didMemorySynthesisFinish({
        batchId,
        text: `SYNTHESIS_COMPLETE:${batchId}`,
        steps: [{ toolResults: [{ toolName: "finish_synthesis" }] }],
      }),
    ).toBe(false);
    expect(
      didMemorySynthesisFinish({
        batchId,
        text: `SYNTHESIS_COMPLETE:${batchId}`,
        steps: [{ toolResults: [{ toolName: "finish_synthesis", output: { ok: true } }] }],
      }),
    ).toBe(true);
  });
});

function state() {
  return {
    run: agentRun(),
    effect: undefined as AgentRunEffectReceipt | undefined,
    createInputs: [] as { objective: string; idempotencyKey: string }[],
  };
}

function agentRun(): AgentRun {
  return {
    id: "run-one",
    orgId: "org-one",
    teamId: "team-one",
    sessionId: "session-one",
    agentId: "memory-catcher",
    objective: "synthesis",
    status: "active",
    budget: {},
    stepCount: 0,
    continuationCount: 0,
    noProgressCount: 0,
    repeatedPatternCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    costMicrousd: 0,
    elapsedMs: 0,
    generation: 1,
    createdAt: "now",
    updatedAt: "now",
  };
}

function receipt(
  input: Record<string, unknown>,
  status: AgentRunEffectReceipt["status"],
  output?: JsonValue,
): AgentRunEffectReceipt {
  return {
    runId: String(input.runId),
    stepId: String(input.stepId),
    toolCallId: String(input.toolCallId),
    toolName: String(input.toolName),
    inputFingerprint: String(input.inputFingerprint),
    idempotencyKey: String(input.idempotencyKey),
    status,
    ...(output === undefined ? {} : { output }),
    createdAt: "now",
  };
}

function creditContext() {
  return {
    orgId: "org-one",
    status: "active" as const,
    grantedMicrousd: 1_000_000,
    topupRemainingMicrousd: 1_000_000,
    spentMicrousd: 0,
    availableMicrousd: 1_000_000,
    reservedMicrousd: 0,
  };
}
