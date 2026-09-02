import { describe, expect, it, vi } from "vite-plus/test";
import { createClient } from "../src";

describe("AgentRunsClient", () => {
  it("separates lease-fenced worker transitions from owner control", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetch = vi.fn(
      async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        requests.push({ url: requestUrl(input), body: JSON.parse(requestBody(init?.body)) });
        return Response.json({
          id: "run",
          org_id: "org",
          team_id: "team",
          session_id: "session",
          agent_id: "factory",
          objective: "work",
          status: "paused",
          budget: {},
          step_count: 0,
          continuation_count: 0,
          no_progress_count: 0,
          repeated_pattern_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          cost_microusd: 0,
          elapsed_ms: 0,
          generation: 2,
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        });
      },
    );
    const runs = createClient({
      baseUrl: "https://api.example.test",
      orgId: "org",
      teamId: "team",
      apiKey: "key",
      fetch: fetch as typeof globalThis.fetch,
    }).chatkit.runs;
    await runs.transition({
      sessionId: "session",
      agentId: "factory",
      runId: "run",
      status: "completed",
      expectedGeneration: 1,
      workerId: "worker",
    });
    await runs.pause({
      sessionId: "session",
      agentId: "factory",
      runId: "run",
      reason: "owner pause",
    });
    expect(requests[0]).toMatchObject({
      url: expect.stringContaining("/runs/run/transition"),
      body: { status: "completed", expected_generation: 1, worker_id: "worker" },
    });
    expect(requests[1]).toMatchObject({
      url: expect.stringContaining("/runs/run/control"),
      body: { status: "paused", reason: "owner pause" },
    });
  });

  it("prepares effect intent before committing its result", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetch = vi.fn(
      async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        requests.push({
          url: requestUrl(input),
          body: init?.body ? JSON.parse(requestBody(init.body)) : undefined,
        });
        const body =
          requests.length === 1
            ? {
                run_id: "run",
                step_id: "1:1",
                tool_call_id: "call",
                tool_name: "charge",
                input_fingerprint: "fp",
                idempotency_key: "key",
                status: "planned",
                created_at: "2026-09-01T00:00:00Z",
              }
            : {
                run_id: "run",
                step_id: "1:1",
                tool_call_id: "call",
                tool_name: "charge",
                input_fingerprint: "fp",
                idempotency_key: "key",
                status: "committed",
                output: { ok: true },
                created_at: "2026-09-01T00:00:00Z",
              };
        return Response.json(body);
      },
    );
    const runs = createClient({
      baseUrl: "https://api.example.test",
      orgId: "org",
      teamId: "team",
      apiKey: "key",
      fetch: fetch as typeof globalThis.fetch,
    }).chatkit.runs;
    const base = {
      sessionId: "session",
      agentId: "factory",
      runId: "run",
      generation: 1,
      workerId: "worker-1",
      stepId: "1:1",
      toolCallId: "call",
      toolName: "charge",
      inputFingerprint: "fp",
      idempotencyKey: "key",
    };

    const planned = await runs.prepareEffect(base);
    const committed = await runs.finishEffect({
      ...base,
      status: "committed",
      output: { ok: true },
    });

    expect(planned.status).toBe("planned");
    expect(committed.output).toEqual({ ok: true });
    expect(requests[0]?.url).toContain("/runs/run/effects/prepare");
    expect(requests[1]?.url).toContain("/runs/run/effects/finish");
    expect(requests[0]?.body).toEqual({
      generation: 1,
      worker_id: "worker-1",
      step_id: "1:1",
      tool_call_id: "call",
      tool_name: "charge",
      input_fingerprint: "fp",
      idempotency_key: "key",
      status: "planned",
    });
    expect(requests[1]?.body).toEqual({
      generation: 1,
      worker_id: "worker-1",
      step_id: "1:1",
      tool_call_id: "call",
      tool_name: "charge",
      input_fingerprint: "fp",
      idempotency_key: "key",
      status: "committed",
      output: { ok: true },
    });
  });
});

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function requestBody(body: RequestInit["body"]): string {
  if (typeof body !== "string") throw new TypeError("Expected a string request body");
  return body;
}
