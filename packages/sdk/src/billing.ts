import type { NormalizedConfig } from "./config";
import { requestJson } from "./internal/fetch-client";

const RESERVATIONS = "/api/v1/billing/ai-credits/reservations";
const RECEIPTS = "/api/v1/billing/ai-credits/receipts";

export type AiCreditReservation = {
  id: string;
  reservedMicrousd: number;
  expiresAt: string;
};

export type AiCreditContext = {
  orgId: string;
  grantedMicrousd: number;
  topupRemainingMicrousd: number;
  spentMicrousd: number;
  reservedMicrousd: number;
  availableMicrousd: number;
  currentPeriodEnd?: string | null;
};

export type CommitAiCreditReceiptInput = {
  reservationId: string;
  idempotencyKey: string;
  generationId?: string;
  actualCostMicrousd: number;
  modelId: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  tags?: string[];
};

/** High-level, agent-authenticated AI-credit reservation and settlement client. */
export class AiCreditsClient {
  readonly #config: NormalizedConfig;

  constructor(config: NormalizedConfig) {
    this.#config = config;
  }

  async reserve(input: {
    idempotencyKey: string;
    estimatedCostMicrousd: number;
  }): Promise<AiCreditReservation> {
    const value = await requestJson<{
      id: string;
      reserved_microusd: number;
      expires_at: string;
    }>(this.#config, {
      method: "POST",
      path: RESERVATIONS,
      body: {
        idempotency_key: input.idempotencyKey,
        estimated_cost_microusd: input.estimatedCostMicrousd,
      },
    });
    return {
      id: value.id,
      reservedMicrousd: value.reserved_microusd,
      expiresAt: value.expires_at,
    };
  }

  async commit(input: CommitAiCreditReceiptInput): Promise<AiCreditContext> {
    return decodeContext(
      await requestJson<WireAiCreditContext>(this.#config, {
        method: "POST",
        path: RECEIPTS,
        body: {
          reservation_id: input.reservationId,
          idempotency_key: input.idempotencyKey,
          generation_id: input.generationId,
          actual_cost_microusd: input.actualCostMicrousd,
          model_id: input.modelId,
          provider: input.provider,
          input_tokens: input.inputTokens,
          output_tokens: input.outputTokens,
          tags: input.tags ?? [],
        },
      }),
    );
  }

  async release(reservationId: string): Promise<AiCreditContext> {
    if (!reservationId.trim()) throw new TypeError("reservationId is required");
    return decodeContext(
      await requestJson<WireAiCreditContext>(this.#config, {
        method: "DELETE",
        path: RESERVATIONS,
        body: { reservation_id: reservationId },
      }),
    );
  }
}

type WireAiCreditContext = {
  org_id: string;
  granted_microusd: number;
  topup_remaining_microusd: number;
  spent_microusd: number;
  reserved_microusd: number;
  available_microusd: number;
  current_period_end?: string | null;
};

function decodeContext(value: WireAiCreditContext): AiCreditContext {
  return {
    orgId: value.org_id,
    grantedMicrousd: value.granted_microusd,
    topupRemainingMicrousd: value.topup_remaining_microusd,
    spentMicrousd: value.spent_microusd,
    reservedMicrousd: value.reserved_microusd,
    availableMicrousd: value.available_microusd,
    currentPeriodEnd: value.current_period_end,
  };
}

/** Organization billing clients. */
export class BillingClient {
  readonly aiCredits: AiCreditsClient;

  constructor(config: NormalizedConfig) {
    this.aiCredits = new AiCreditsClient(config);
  }
}
