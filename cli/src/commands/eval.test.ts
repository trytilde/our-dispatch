import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runEvaluation } from "./eval.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function evaluationDependencies(request: typeof fetch) {
  let time = 1_000;
  return {
    request,
    headers: { Authorization: "Bearer test" },
    now: () => (time += 100),
    delay: async () => undefined,
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("production evaluation", () => {
  it("measures a completed informational answer and its exact tool sequence", async () => {
    vi.stubEnv("TILDE_TEAM_ID", "team-one");
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input);
      if (url.endsWith("/chatkit/workspace/agents/factory/sessions"))
        return response({ session: { id: "session-one" } });
      if (url.endsWith("/sessions/session-one/messages") && init?.method === "POST")
        return response({ items: [{ role: "user", created_at: "1", parts: [] }] });
      if (url.includes("/sessions/session-one/messages?page_size=100"))
        return response({
          items: [
            {
              role: "assistant",
              created_at: "3",
              parts: [{ type: "text", text: "A cookie stores website state." }],
            },
            {
              role: "assistant",
              created_at: "2",
              parts: [
                {
                  type: "tool",
                  state: "output-available",
                  tool_name: "sendMessage",
                  output: { deliveryStatus: "persisted" },
                },
              ],
            },
          ],
        });
      return response({ error: "unexpected" }, 500);
    });

    const report = await runEvaluation(
      ["--scenario", "simple-answer", "--json"],
      evaluationDependencies(request),
    );

    expect(report.ok).toBe(true);
    expect(report.scenarios).toEqual([
      expect.objectContaining({
        id: "simple-answer",
        passed: true,
        sessionId: "session-one",
        tools: ["sendMessage"],
        metrics: { toolCalls: 1, repeatedToolCalls: 0 },
      }),
    ]);
  });

  it("creates, updates, runs, observes, and deletes a temporary routine", async () => {
    vi.stubEnv("TILDE_TEAM_ID", "team-one");
    let putCount = 0;
    let runId = "";
    let deleted = false;
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input);
      if (/\/automations\/[0-9a-f-]+$/.test(url) && init?.method === "PUT") {
        if (typeof init.body !== "string") throw new TypeError("Expected a JSON request body");
        expect(JSON.parse(init.body)).toMatchObject({
          triggers: [{ kind: "schedule", schedule: "0 7 * * *" }],
        });
        putCount += 1;
        return response({ version: putCount });
      }
      if (url.endsWith("/run") && init?.method === "POST") {
        if (typeof init.body !== "string") throw new TypeError("Expected a JSON request body");
        runId = JSON.parse(init.body).run_id as string;
        return response({ run_id: runId, session_id: "routine-session" });
      }
      if (url.includes("/executions?page_size=25"))
        return response({ items: [{ id: runId, status: "succeeded" }] });
      if (/\/automations\/[0-9a-f-]+$/.test(url) && init?.method === "DELETE") {
        deleted = true;
        return response({ deleted: true });
      }
      return response({ error: "unexpected" }, 500);
    });

    const report = await runEvaluation(
      ["--scenario", "routine-lifecycle"],
      evaluationDependencies(request),
    );

    expect(report.ok).toBe(true);
    expect(report.scenarios[0]).toMatchObject({
      id: "routine-lifecycle",
      passed: true,
      sessionId: "routine-session",
    });
    expect(putCount).toBe(2);
    expect(deleted).toBe(true);
  });

  it("rejects unknown scenarios before authenticating", async () => {
    vi.stubEnv("TILDE_TEAM_ID", "team-one");
    await expect(
      runEvaluation(["--scenario", "unknown"], evaluationDependencies(vi.fn<typeof fetch>())),
    ).rejects.toThrow("Unknown evaluation scenario: unknown");
  });
});
