import { describe, expect, it, vi } from "vite-plus/test";
import { createClient } from "../src";

describe("AiCreditsClient", () => {
  it("maps reserve, exact commit, and release to the Billing contract", async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const fetch = vi.fn(
      async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        if (init?.body !== undefined && typeof init.body !== "string")
          throw new TypeError("Expected a JSON string request body");
        requests.push({
          method: init?.method ?? "GET",
          url,
          body: init?.body ? JSON.parse(init.body) : undefined,
        });
        if (requests.length === 1)
          return Response.json({
            id: "reservation",
            reserved_microusd: 25_000,
            expires_at: "later",
          });
        return Response.json({
          org_id: "org",
          granted_microusd: 5_000_000,
          topup_remaining_microusd: 0,
          spent_microusd: 123,
          reserved_microusd: 0,
          available_microusd: 4_999_877,
          current_period_end: null,
        });
      },
    );
    const credits = createClient({
      baseUrl: "https://api.example.test",
      orgId: "org",
      orgSubdomain: false,
      teamId: "team",
      apiKey: "agent-key",
      fetch: fetch as typeof globalThis.fetch,
    }).billing.aiCredits;

    await expect(
      credits.reserve({ idempotencyKey: "run:step:0", estimatedCostMicrousd: 25_000 }),
    ).resolves.toEqual({ id: "reservation", reservedMicrousd: 25_000, expiresAt: "later" });
    await credits.commit({
      reservationId: "reservation",
      idempotencyKey: "run:step:0:receipt",
      generationId: "gen_1",
      actualCostMicrousd: 123,
      modelId: "provider/model",
      provider: "provider",
      inputTokens: 10,
      outputTokens: 2,
      tags: ["hosted-openbot"],
    });
    await credits.release("reservation");

    expect(requests).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "https://api.example.test/api/v1/billing/ai-credits/reservations",
        body: { idempotency_key: "run:step:0", estimated_cost_microusd: 25_000 },
      }),
      expect.objectContaining({
        method: "POST",
        url: "https://api.example.test/api/v1/billing/ai-credits/receipts",
        body: expect.objectContaining({
          reservation_id: "reservation",
          actual_cost_microusd: 123,
          generation_id: "gen_1",
        }),
      }),
      expect.objectContaining({
        method: "DELETE",
        body: { reservation_id: "reservation" },
      }),
    ]);
  });
});
