import { describe, expect, it, vi } from "vite-plus/test";
import { createClient } from "../src";

const sessionId = "22222222-2222-4222-8222-222222222222";
const rawJob = {
  id: "33333333-3333-4333-8333-333333333333",
  parent_session_id: sessionId,
  parent_agent_id: "factory",
  child_session_id: "44444444-4444-4444-8444-444444444444",
  child_agent_id: "researcher",
  objective: "Research the implementation",
  status: "running",
  transcript_message_ids: [],
  artifacts: [],
  created_at: "2026-09-01T09:00:00Z",
  updated_at: "2026-09-01T09:00:00Z",
};

describe("AgentJobsClient", () => {
  it("delegates idempotently without inventing a model selection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(rawJob));
    const client = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    });

    const job = await client.chatkit.work({ agentId: "factory", sessionId }).jobs.delegate({
      childAgentId: "researcher",
      objective: "Research the implementation",
      idempotencyKey: "delegate-research-v1",
    });

    expect(job).toMatchObject({ childAgentId: "researcher", status: "running" });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(typeof call[1].body === "string" ? call[1].body : "");
    expect(call[0]).toContain(`/chatkit/agents/factory/sessions/${sessionId}/jobs`);
    expect(body).toMatchObject({
      child_agent_id: "researcher",
      idempotency_key: "delegate-research-v1",
    });
    expect(body).not.toHaveProperty("model_id");
  });

  it("supports restart-safe steer, stop, resume, and collect operations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(rawJob))
      .mockResolvedValueOnce(Response.json({ ...rawJob, status: "stopped" }))
      .mockResolvedValueOnce(Response.json({ ...rawJob, status: "queued" }))
      .mockResolvedValueOnce(
        Response.json({ ...rawJob, status: "completed", result: { answer: "done" } }),
      );
    const client = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    });
    const jobs = client.chatkit.work({ agentId: "factory", sessionId }).jobs;

    await jobs.steer(rawJob.id, "Check the primary source", "steer-primary-source");
    await jobs.stop(rawJob.id, "Owner interrupted");
    await jobs.resume(rawJob.id, "Continue from the receipt");
    const collected = await jobs.collectResult(rawJob.id);

    expect(collected).toMatchObject({ status: "completed", result: { answer: "done" } });
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      expect.stringContaining("/steer"),
      expect.stringContaining("/stop"),
      expect.stringContaining("/resume"),
      expect.stringContaining("/collect-result"),
    ]);
  });

  it("sends model and hard budgets only when explicitly selected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ ...rawJob, model_id: "provider/model" }));
    const client = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    });

    await client.chatkit.work({ agentId: "factory", sessionId }).jobs.delegate({
      childAgentId: "researcher",
      objective: "Use the requested model within budget",
      idempotencyKey: "explicit-model-budget",
      modelId: "provider/model",
      budget: {
        maxDurationSeconds: 120,
        maxInputTokens: 10_000,
        maxOutputTokens: 2_000,
        maxCostMicrousd: 50_000,
      },
    });

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(typeof call[1].body === "string" ? call[1].body : "");
    expect(body).toMatchObject({
      model_id: "provider/model",
      budget: {
        max_duration_seconds: 120,
        max_input_tokens: 10_000,
        max_output_tokens: 2_000,
        max_cost_microusd: 50_000,
      },
    });
  });

  it("keeps persisted artifacts opaque and resolves a fresh authorized URL on collect", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ...rawJob,
          status: "completed",
          artifacts: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              name: "report.pdf",
              media_type: "application/pdf",
            },
          ],
          result: { ok: true },
        }),
      )
      .mockResolvedValueOnce(Response.json({ download_url: "https://signed.example/fresh" }));
    const client = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    });
    const job = await client.chatkit
      .work({ agentId: "factory", sessionId })
      .jobs.collectResult(rawJob.id);
    expect(job.artifacts).toEqual([
      {
        id: "55555555-5555-4555-8555-555555555555",
        name: "report.pdf",
        mediaType: "application/pdf",
        uri: "https://signed.example/fresh",
      },
    ]);
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("signed.example");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `/session/${rawJob.child_session_id}/attachment/55555555-5555-4555-8555-555555555555/download-url`,
    );
  });
});
