import { describe, expect, it, vi } from "vite-plus/test";
import { ApiError, type AgentRunEffectReceipt, type JsonValue } from "@trytilde/sdk";
import {
  HostedInferenceBillingController,
  HostedInferenceCreditsExhaustedError,
  HostedInferenceReconciliationRequiredError,
} from "../src/hosted-inference-billing";

function harness(
  options: {
    enabled?: boolean;
    existing?: AgentRunEffectReceipt;
    commitFailure?: Error;
    byok?: boolean;
    reserveFailure?: Error;
    prepareFailure?: Error;
    releaseFailure?: Error;
    finishFailures?: number;
  } = {},
) {
  let effect = options.existing;
  let finishFailures = options.finishFailures ?? 0;
  const reserve = vi.fn(async () => {
    if (options.reserveFailure) throw options.reserveFailure;
    return { id: "reservation", reservedMicrousd: 250_000, expiresAt: "later" };
  });
  const commit = vi.fn(async () => {
    if (options.commitFailure) throw options.commitFailure;
    return creditContext();
  });
  const release = vi.fn(async () => {
    if (options.releaseFailure) throw options.releaseFailure;
    return creditContext();
  });
  const prepareEffect = vi.fn(async (input: Record<string, unknown>) => {
    if (options.prepareFailure) throw options.prepareFailure;
    effect = receipt(input, "planned");
    return effect;
  });
  const finishEffect = vi.fn(async (input: Record<string, unknown>) => {
    if (finishFailures > 0) {
      finishFailures -= 1;
      throw new Error("effect finish unavailable");
    }
    effect = receipt(
      input,
      String(input.status) as "committed" | "uncertain",
      input.output as JsonValue,
    );
    return effect;
  });
  const controller = new HostedInferenceBillingController({
    enabled: options.enabled ?? true,
    credits: { reserve, commit, release },
    effects: {
      getEffect: vi.fn(async () => effect),
      prepareEffect,
      finishEffect,
    },
    sessionId: "session",
    agentId: "factory",
    runId: "run",
    runGeneration: 2,
    workerId: "worker-1",
    stepId: "2:3",
    estimatedCostMicrousd: 250_000,
    generationInfo: vi.fn(async (id) => ({
      id,
      totalCost: 0.001234,
      model: "openai/gpt",
      isByok: options.byok ?? false,
      providerName: "openai",
      promptTokens: 10,
      completionTokens: 2,
    })),
  });
  return {
    controller,
    reserve,
    commit,
    release,
    prepareEffect,
    finishEffect,
    effect: () => effect,
  };
}

describe("HostedInferenceBillingController", () => {
  it("reserves before the provider call and commits the authoritative Gateway receipt", async () => {
    const h = harness();
    await h.controller.preflight("openai/gpt");
    await h.controller.onLanguageModelCallStart(startEvent());
    await h.controller.onLanguageModelCallEnd(endEvent());

    expect(h.reserve).toHaveBeenCalledWith({
      idempotencyKey: "run:2:3:model:0",
      estimatedCostMicrousd: 250_000,
    });
    expect(h.prepareEffect).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 2, workerId: "worker-1" }),
    );
    expect(h.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "reservation",
        generationId: "gen_1",
        actualCostMicrousd: 1_234,
        inputTokens: 10,
        outputTokens: 2,
      }),
    );
    expect(h.controller.totalCostMicrousd).toBe(1_234);
  });

  it("fails closed with a user-facing credits error", async () => {
    const response = new Response(null, { status: 402 });
    const h = harness({
      reserveFailure: new ApiError("AI credits are exhausted", response, null),
    });
    await expect(h.controller.preflight("openai/gpt")).rejects.toBeInstanceOf(
      HostedInferenceCreditsExhaustedError,
    );
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.prepareEffect).not.toHaveBeenCalled();
  });

  it("releases the reservation when the provider fails without a receipt", async () => {
    const h = harness();
    await h.controller.preflight("openai/gpt");
    await h.controller.onLanguageModelCallStart(startEvent());
    await h.controller.fail(new Error("provider unavailable"));
    expect(h.release).toHaveBeenCalledWith("reservation");
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("uses the same reservation idempotency key after a pre-start process loss", async () => {
    const first = harness();
    await first.controller.preflight("openai/gpt");
    const retry = harness();
    await retry.controller.preflight("openai/gpt");
    const expected = {
      idempotencyKey: "run:2:3:model:0",
      estimatedCostMicrousd: 250_000,
    };
    expect(first.reserve).toHaveBeenCalledWith(expected);
    expect(retry.reserve).toHaveBeenCalledWith(expected);
  });

  it("releases a reservation when pre-call durable effect preparation fails", async () => {
    const h = harness({ prepareFailure: new Error("effect store unavailable") });
    await h.controller.preflight("openai/gpt");
    await expect(h.controller.onLanguageModelCallStart(startEvent())).rejects.toThrow(
      "effect store unavailable",
    );
    expect(h.release).toHaveBeenCalledWith("reservation");
    await expect(h.controller.fail()).resolves.toBe(false);
  });

  it("keeps the prepare error when both effect preparation and release fail", async () => {
    const h = harness({
      prepareFailure: new Error("effect store unavailable"),
      releaseFailure: new Error("release unavailable"),
    });
    await h.controller.preflight("openai/gpt");
    await expect(h.controller.onLanguageModelCallStart(startEvent())).rejects.toThrow(
      "effect store unavailable",
    );
    expect(h.release).toHaveBeenCalledWith("reservation");
    expect(h.effect()).toBeUndefined();
    await expect(h.controller.fail()).resolves.toBe(false);
  });

  it("does not repeat a provider call after a durable planned effect", async () => {
    const first = harness();
    await first.controller.preflight("openai/gpt");
    await first.controller.onLanguageModelCallStart(startEvent());
    const retry = harness({ existing: first.effect() });
    await expect(retry.controller.preflight("openai/gpt")).rejects.toBeInstanceOf(
      HostedInferenceReconciliationRequiredError,
    );
    expect(retry.reserve).not.toHaveBeenCalled();
  });

  it("marks a missing generation uncertain and refuses provider replay", async () => {
    const first = harness();
    await first.controller.preflight("openai/gpt");
    await first.controller.onLanguageModelCallStart(startEvent());
    await expect(
      first.controller.onLanguageModelCallEnd({ callId: "call-1", providerMetadata: {} }),
    ).rejects.toBeInstanceOf(HostedInferenceReconciliationRequiredError);
    expect(first.effect()).toEqual(expect.objectContaining({ status: "uncertain" }));

    const retry = harness({ existing: first.effect() });
    await expect(retry.controller.preflight("openai/gpt")).rejects.toBeInstanceOf(
      HostedInferenceReconciliationRequiredError,
    );
    expect(retry.reserve).not.toHaveBeenCalled();
  });

  it("replays an uncertain receipt commit without another reservation or provider call", async () => {
    const first = harness({ commitFailure: new Error("commit response lost") });
    await first.controller.preflight("openai/gpt");
    await first.controller.onLanguageModelCallStart(startEvent());
    await expect(first.controller.onLanguageModelCallEnd(endEvent())).rejects.toThrow(
      "commit response lost",
    );

    const retry = harness({ existing: first.effect() });
    await expect(retry.controller.preflight("openai/gpt")).rejects.toBeInstanceOf(
      HostedInferenceReconciliationRequiredError,
    );
    expect(retry.commit).toHaveBeenCalledOnce();
    expect(retry.reserve).not.toHaveBeenCalled();
  });

  it("recovers a generation persisted from the first stream chunk after a process loss", async () => {
    const first = harness();
    await first.controller.preflight("openai/gpt");
    await first.controller.onLanguageModelCallStart(startEvent());
    await first.controller.onChunk({
      chunk: { providerMetadata: { gateway: { generationId: "gen_early" } } },
    });

    const retry = harness({ existing: first.effect() });
    await expect(retry.controller.preflight("openai/gpt")).rejects.toBeInstanceOf(
      HostedInferenceReconciliationRequiredError,
    );
    expect(retry.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen_early",
        actualCostMicrousd: 1_234,
        idempotencyKey: "run:2:3:model:0:receipt",
      }),
    );
    expect(retry.reserve).not.toHaveBeenCalled();

    const nextInvocation = harness({ existing: first.effect() });
    await expect(nextInvocation.controller.preflight("openai/gpt")).rejects.toBeInstanceOf(
      HostedInferenceReconciliationRequiredError,
    );
    expect(nextInvocation.reserve).not.toHaveBeenCalled();
    expect(nextInvocation.commit).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "run:2:3:model:0:receipt" }),
    );
  });

  it("keeps a known generation reserved for exact recovery when the stream later fails", async () => {
    const h = harness();
    await h.controller.preflight("openai/gpt");
    await h.controller.onLanguageModelCallStart(startEvent());
    await h.controller.onChunk({
      chunk: { providerMetadata: { gateway: { generationId: "gen_partial" } } },
    });
    await h.controller.fail(new Error("connection closed"));
    expect(h.commit).toHaveBeenCalledWith(expect.objectContaining({ generationId: "gen_partial" }));
    expect(h.release).not.toHaveBeenCalled();
  });

  it("retains end-only generation state until effect persistence can be retried", async () => {
    const h = harness({ finishFailures: 1 });
    await h.controller.preflight("openai/gpt");
    await h.controller.onLanguageModelCallStart(startEvent());
    await expect(h.controller.onLanguageModelCallEnd(endEvent())).rejects.toThrow(
      "effect finish unavailable",
    );
    await expect(h.controller.fail()).resolves.toBe(true);
    expect(h.effect()).toEqual(
      expect.objectContaining({
        status: "committed",
        output: expect.objectContaining({ outcome: "settled" }),
      }),
    );
    expect(h.commit).toHaveBeenCalledOnce();
  });

  it("reserves every Gateway call, then releases an authoritative BYOK generation", async () => {
    const byok = harness({ byok: true });
    await byok.controller.preflight("openai/gpt");
    await byok.controller.onLanguageModelCallStart(startEvent());
    await byok.controller.onLanguageModelCallEnd(endEvent());
    expect(byok.reserve).toHaveBeenCalledOnce();
    expect(byok.release).toHaveBeenCalledWith("reservation");
    expect(byok.commit).not.toHaveBeenCalled();

    const local = harness({ enabled: false });
    await local.controller.preflight("openai/gpt");
    await local.controller.onLanguageModelCallStart(startEvent());
    await local.controller.onLanguageModelCallEnd(endEvent());
    expect(local.reserve).not.toHaveBeenCalled();
  });

  it("persists BYOK exclusion before release so a failed release is recoverable", async () => {
    const h = harness({ byok: true, releaseFailure: new Error("release unavailable") });
    await h.controller.preflight("openai/gpt");
    await h.controller.onLanguageModelCallStart(startEvent());
    await expect(h.controller.onLanguageModelCallEnd(endEvent())).rejects.toThrow(
      "release unavailable",
    );
    expect(h.effect()).toEqual(
      expect.objectContaining({
        status: "committed",
        output: expect.objectContaining({ outcome: "excluded_byok" }),
      }),
    );
    const retry = harness({ existing: h.effect(), byok: true });
    await expect(retry.controller.preflight("openai/gpt")).rejects.toBeInstanceOf(
      HostedInferenceReconciliationRequiredError,
    );
    expect(retry.release).toHaveBeenCalledWith("reservation");
    expect(retry.reserve).not.toHaveBeenCalled();
  });
});

function startEvent() {
  return { callId: "call-1", modelId: "openai/gpt" };
}

function endEvent() {
  return {
    callId: "call-1",
    modelId: "openai/gpt",
    provider: "gateway",
    providerMetadata: { gateway: { generationId: "gen_1" } },
  };
}

function receipt(
  input: Record<string, unknown>,
  status: "planned" | "committed" | "uncertain",
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
    output,
    createdAt: "now",
  };
}

function creditContext() {
  return {
    orgId: "org",
    grantedMicrousd: 5_000_000,
    topupRemainingMicrousd: 0,
    spentMicrousd: 0,
    reservedMicrousd: 0,
    availableMicrousd: 5_000_000,
  };
}
