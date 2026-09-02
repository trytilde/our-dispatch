import { gateway } from "ai";
import {
  ApiError,
  type AgentRunEffectReceipt,
  type AgentRunsClient,
  type AiCreditsClient,
  type CommitAiCreditReceiptInput,
  type JsonValue,
} from "@trytilde/sdk";

const EFFECT_NAME = "hosted_inference";

type EffectStore = Pick<AgentRunsClient, "getEffect" | "prepareEffect" | "finishEffect">;

type LanguageModelCallStartEvent = {
  callId: string;
  modelId: string;
};

type LanguageModelCallEndEvent = {
  callId: string;
  providerMetadata?: unknown;
};

export type HostedInferenceBillingControllerOptions = {
  enabled: boolean;
  credits: Pick<AiCreditsClient, "reserve" | "commit" | "release">;
  effects: EffectStore;
  sessionId: string;
  agentId: string;
  runId: string;
  runGeneration: number;
  workerId: string;
  stepId: string;
  /** Stable semantic call scope; unlike stepId, this must survive lease-generation reclaim. */
  effectScope: string;
  estimatedCostMicrousd: number;
  tags?: string[];
  generationInfo?: (generationId: string) => Promise<GatewayGenerationReceipt>;
};

export type GatewayGenerationReceipt = {
  id: string;
  totalCost: number;
  model: string;
  isByok: boolean;
  providerName: string;
  promptTokens: number;
  completionTokens: number;
};

type ActiveCall = {
  ordinal: number;
  reservationId: string;
  idempotencyKey: string;
  inputFingerprint: string;
  toolCallId: string;
  modelId: string;
  started?: boolean;
  generationId?: string;
  effectCommittedEarly?: boolean;
};

/** Raised before inference when the organization cannot reserve more hosted credits. */
export class HostedInferenceCreditsExhaustedError extends Error {
  constructor(
    message = "This organization has no Tilde AI Credits available. Add credits to continue.",
  ) {
    super(message);
    this.name = "HostedInferenceCreditsExhaustedError";
  }
}

/** Raised when a prior provider result must be reconciled instead of invoked again. */
export class HostedInferenceReconciliationRequiredError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(
      "A previous hosted inference has an uncertain or completed outcome and is being reconciled.",
    );
    this.name = "HostedInferenceReconciliationRequiredError";
  }
}

/** Meter every model call in one AI SDK tool loop without changing its prompt or message prefix. */
export class HostedInferenceBillingController {
  readonly #options: HostedInferenceBillingControllerOptions;
  readonly #activeByOrdinal = new Map<number, ActiveCall>();
  readonly #activeByCallId = new Map<string, ActiveCall>();
  #nextOrdinal = 0;
  #totalCostMicrousd = 0;

  constructor(options: HostedInferenceBillingControllerOptions) {
    this.#options = options;
  }

  get enabled(): boolean {
    return this.#options.enabled;
  }

  get totalCostMicrousd(): number {
    return this.#totalCostMicrousd;
  }

  /** Reserve the first model call early enough to return a clear HTTP payment state. */
  async preflight(modelId: string): Promise<void> {
    if (!this.enabled || this.#activeByOrdinal.has(0)) return;
    await this.#begin(0, modelId);
  }

  readonly onLanguageModelCallStart = async (event: LanguageModelCallStartEvent): Promise<void> => {
    if (!this.enabled) return;
    const ordinal = this.#nextOrdinal++;
    const active =
      this.#activeByOrdinal.get(ordinal) ?? (await this.#begin(ordinal, event.modelId));
    await this.#prepare(active);
    active.started = true;
    this.#activeByCallId.set(event.callId, active);
  };

  readonly onLanguageModelCallEnd = async (event: LanguageModelCallEndEvent): Promise<void> => {
    if (!this.enabled) return;
    const active = this.#activeByCallId.get(event.callId);
    if (!active) throw new Error(`Missing hosted inference reservation for ${event.callId}`);
    const generationId = gatewayGenerationId(event.providerMetadata) ?? active.generationId;
    if (!generationId) {
      await this.#markUncertain(active);
      this.#deleteActive(event.callId, active);
      throw new HostedInferenceReconciliationRequiredError(active.idempotencyKey);
    }
    active.generationId = generationId;
    await this.#settleGeneration(active, generationId);
    this.#deleteActive(event.callId, active);
  };

  /** Persist the Gateway generation ID from the first content chunk for crash recovery. */
  readonly onChunk = async (event: { chunk: unknown }): Promise<void> => {
    if (!this.enabled) return;
    const generationId = gatewayGenerationId(record(event.chunk)?.providerMetadata);
    if (!generationId) return;
    const active = [...this.#activeByCallId.values()].at(-1);
    if (!active || active.generationId) return;
    active.generationId = generationId;
    await this.#finish(active, {
      outcome: "generation_pending",
      reservationId: requiredReservationId(active),
      generationId,
      modelId: active.modelId,
    });
    active.effectCommittedEarly = true;
  };

  /** Handle failed calls and report whether the run must remain blocked for reconciliation. */
  async fail(error?: unknown): Promise<boolean> {
    if (!this.enabled) return false;
    const generationId = errorGenerationId(error);
    const active = [
      ...new Map(
        [...this.#activeByOrdinal.values(), ...this.#activeByCallId.values()].map((call) => [
          call.idempotencyKey,
          call,
        ]),
      ).values(),
    ];
    this.#activeByCallId.clear();
    this.#activeByOrdinal.clear();
    let requiresReconciliation = false;
    for (const call of active) {
      if (!call.started) {
        await this.#options.credits.release(call.reservationId);
        continue;
      }
      const knownGenerationId = generationId ?? call.generationId;
      if (knownGenerationId) {
        try {
          await this.#settleGeneration(call, knownGenerationId);
        } catch {
          // The durable generation ID lets a later retry reconcile exact cost.
        }
        requiresReconciliation = true;
        continue;
      }
      const reservationId = requiredReservationId(call);
      await this.#options.credits.release(reservationId);
      await this.#markUncertain(call);
      requiresReconciliation = true;
    }
    return requiresReconciliation;
  }

  async #begin(ordinal: number, modelId: string): Promise<ActiveCall> {
    const toolCallId = `model-${this.#options.effectScope}-${ordinal}`;
    const idempotencyKey = `${this.#options.runId}:${this.#options.effectScope}:model:${ordinal}`;
    const inputFingerprint = await fingerprint(
      JSON.stringify([this.#options.runId, this.#options.effectScope, ordinal, modelId]),
    );
    const existing = await this.#options.effects.getEffect({
      sessionId: this.#options.sessionId,
      agentId: this.#options.agentId,
      runId: this.#options.runId,
      toolName: EFFECT_NAME,
      inputFingerprint,
    });
    if (existing?.status === "committed") {
      await this.#recoverCommitted(existing);
      throw new HostedInferenceReconciliationRequiredError(existing.idempotencyKey);
    }
    if (existing) throw new HostedInferenceReconciliationRequiredError(existing.idempotencyKey);

    let reservation: Awaited<ReturnType<AiCreditsClient["reserve"]>>;
    try {
      reservation = await this.#options.credits.reserve({
        idempotencyKey,
        estimatedCostMicrousd: this.#options.estimatedCostMicrousd,
      });
    } catch (error) {
      if (isInsufficientCredits(error)) throw new HostedInferenceCreditsExhaustedError();
      throw error;
    }
    const active = {
      ordinal,
      reservationId: reservation.id,
      idempotencyKey,
      inputFingerprint,
      toolCallId,
      modelId,
    };
    this.#activeByOrdinal.set(ordinal, active);
    return active;
  }

  async #prepare(active: ActiveCall): Promise<void> {
    try {
      await this.#options.effects.prepareEffect({
        ...effectIdentity(this.#options, active),
      });
    } catch (error) {
      this.#activeByOrdinal.delete(active.ordinal);
      try {
        await this.#options.credits.release(active.reservationId);
      } catch {
        // Reservation expiry remains the final cleanup when both boundaries fail.
      }
      throw error;
    }
  }

  async #settleGeneration(active: ActiveCall, generationId: string): Promise<void> {
    let generation: GatewayGenerationReceipt;
    try {
      generation = await (this.#options.generationInfo ?? defaultGenerationInfo)(generationId);
    } catch (error) {
      if (!active.effectCommittedEarly)
        await this.#finish(active, {
          outcome: "generation_pending",
          reservationId: requiredReservationId(active),
          generationId,
          modelId: active.modelId,
        });
      throw error;
    }
    if (generation.isByok) {
      if (!active.effectCommittedEarly)
        await this.#finish(active, {
          outcome: "excluded_byok",
          reservationId: requiredReservationId(active),
          generationId,
        });
      await this.#options.credits.release(requiredReservationId(active));
      return;
    }
    const receipt = receiptFromGeneration(active, generation, this.#options.tags);
    if (!active.effectCommittedEarly) await this.#finish(active, { outcome: "settled", receipt });
    await this.#options.credits.commit(receipt);
    this.#totalCostMicrousd += receipt.actualCostMicrousd;
  }

  async #recoverCommitted(effect: AgentRunEffectReceipt): Promise<void> {
    const output = record(effect.output);
    if (!output) return;
    const receipt = decodeReceipt(output.receipt);
    if (receipt) {
      await this.#options.credits.commit(receipt);
      return;
    }
    if (
      (output.outcome === "excluded_byok" || output.outcome === "provider_failed") &&
      typeof output.reservationId === "string"
    ) {
      await this.#options.credits.release(output.reservationId);
      return;
    }
    if (
      output.outcome === "generation_pending" &&
      typeof output.generationId === "string" &&
      typeof output.reservationId === "string" &&
      typeof output.modelId === "string"
    ) {
      const generation = await (this.#options.generationInfo ?? defaultGenerationInfo)(
        output.generationId,
      );
      if (generation.isByok) {
        await this.#options.credits.release(output.reservationId);
        return;
      }
      await this.#options.credits.commit(
        receiptFromGeneration(
          {
            ordinal: -1,
            reservationId: output.reservationId,
            idempotencyKey: effect.idempotencyKey,
            inputFingerprint: effect.inputFingerprint,
            toolCallId: effect.toolCallId,
            modelId: output.modelId,
          },
          generation,
          this.#options.tags,
        ),
      );
    }
  }

  async #markUncertain(active: ActiveCall): Promise<void> {
    await this.#options.effects.finishEffect({
      ...effectIdentity(this.#options, active),
      status: "uncertain",
    });
  }

  async #finish(active: ActiveCall, output: JsonValue): Promise<void> {
    await this.#options.effects.finishEffect({
      ...effectIdentity(this.#options, active),
      status: "committed",
      output,
    });
  }

  #deleteActive(callId: string, active: ActiveCall): void {
    this.#activeByCallId.delete(callId);
    this.#activeByOrdinal.delete(active.ordinal);
  }
}

function effectIdentity(options: HostedInferenceBillingControllerOptions, active: ActiveCall) {
  return {
    sessionId: options.sessionId,
    agentId: options.agentId,
    runId: options.runId,
    generation: options.runGeneration,
    workerId: options.workerId,
    stepId: options.stepId,
    toolCallId: active.toolCallId,
    toolName: EFFECT_NAME,
    inputFingerprint: active.inputFingerprint,
    idempotencyKey: active.idempotencyKey,
  };
}

async function defaultGenerationInfo(generationId: string): Promise<GatewayGenerationReceipt> {
  return gateway.getGenerationInfo({ id: generationId });
}

function receiptFromGeneration(
  active: ActiveCall,
  generation: GatewayGenerationReceipt,
  tags: string[] | undefined,
): CommitAiCreditReceiptInput {
  return {
    reservationId: requiredReservationId(active),
    idempotencyKey: `${active.idempotencyKey}:receipt`,
    generationId: generation.id,
    actualCostMicrousd: Math.ceil(generation.totalCost * 1_000_000),
    modelId: generation.model,
    provider: generation.providerName,
    inputTokens: generation.promptTokens,
    outputTokens: generation.completionTokens,
    tags: tags ?? ["hosted-openbot"],
  };
}

function requiredReservationId(active: ActiveCall): string {
  if (!active.reservationId)
    throw new Error(`Hosted inference call ${active.idempotencyKey} has no reservation`);
  return active.reservationId;
}

function gatewayGenerationId(metadata: unknown): string | undefined {
  const root = record(metadata);
  const gatewayMetadata = record(root?.gateway);
  return typeof gatewayMetadata?.generationId === "string"
    ? gatewayMetadata.generationId
    : undefined;
}

function errorGenerationId(error: unknown): string | undefined {
  const value = record(error);
  return typeof value?.generationId === "string" ? value.generationId : undefined;
}

function isInsufficientCredits(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function decodeReceipt(value: unknown): CommitAiCreditReceiptInput | undefined {
  const input = record(value);
  if (
    !input ||
    typeof input.reservationId !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    typeof input.actualCostMicrousd !== "number" ||
    typeof input.modelId !== "string" ||
    typeof input.inputTokens !== "number" ||
    typeof input.outputTokens !== "number"
  )
    return undefined;
  return input as CommitAiCreditReceiptInput;
}

async function fingerprint(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
