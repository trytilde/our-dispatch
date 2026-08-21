import { describe, expect, it, vi } from "vite-plus/test";
import { createOpenBotClient } from "./client.js";

describe("OpenBot client", () => {
  it("starts and polls a validated agent setup job", async () => {
    const jobId = "44444444-4444-4444-8444-444444444444";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { status: "setting_up", job_id: jobId, agent: { id: "reviewer", name: "Reviewer" } },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ status: "ready", agent: { id: "reviewer", name: "Reviewer" } }),
      );
    const client = createOpenBotClient({ fetch });

    await expect(client.startAgentSetup("Reviewer")).resolves.toMatchObject({ job_id: jobId });
    await expect(client.getAgentSetup(jobId)).resolves.toEqual({
      status: "ready",
      agent: { id: "reviewer", name: "Reviewer" },
    });
    expect(fetch.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      "/api/agents",
      `/api/agents/setup/${jobId}`,
    ]);
  });

  it("scopes chat requests to the installation and validates sidebar resources", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toBe(
        "https://openbot.test/api/chat/mission-control/sidebar?agent_page_size=50&session_page_size=12&agent_sort=updated_at&session_sort=updated_at",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer owner-token");
      return Response.json({
        items: [
          {
            id: "agent-one",
            display_name: "Agent One",
            provider_id: "tilde",
            status: "ready",
            sessions: { items: [] },
          },
        ],
      });
    });
    const client = createOpenBotClient({
      baseUrl: "https://openbot.test/",
      fetch,
      getAccessToken: async () => "owner-token",
    });

    await expect(client.getSidebar()).resolves.toEqual({
      items: [
        {
          id: "agent-one",
          display_name: "Agent One",
          provider_id: "tilde",
          status: "ready",
          sessions: { items: [] },
        },
      ],
    });
  });

  it("rejects malformed upstream resources at the client boundary", async () => {
    const client = createOpenBotClient({
      fetch: async () => Response.json({ items: [{ id: "missing-fields" }] }),
    });
    await expect(client.getSidebar()).rejects.toThrow();
  });

  it("consumes the team-wide Mission Control event stream", async () => {
    const events: unknown[] = [];
    const client = createOpenBotClient({
      fetch: async (input) => {
        expect(requestUrl(input)).toBe("/api/chat/mission-control/events");
        return new Response(
          'id: event-one\nevent: chatkit.message.streaming\ndata: {"kind":{"kind":"message_streaming","session_id":"session-one"}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    await client.observeMissionControl(new AbortController().signal, (event) => events.push(event));

    expect(events).toEqual([
      {
        id: "event-one",
        type: "chatkit.message.streaming",
        data: { kind: { kind: "message_streaming", session_id: "session-one" } },
      },
    ]);
  });

  it("rewrites Tilde attachment URLs through the configured bridge", () => {
    const client = createOpenBotClient({ baseUrl: "https://openbot.test" });
    expect(
      client.rewriteTildeUrl(
        "https://api.trytilde.ai/api/v1/team/team-one/chatkit/session/session-one/file",
      ),
    ).toBe("https://openbot.test/api/chat/session/session-one/file");
    expect(
      client.rewriteTildeUploadUrl(
        "https://bucket.r2.cloudflarestorage.com/chatkit/org/org-one/team/team-one/file",
      ),
    ).toContain("https://openbot.test/api/chat/_upload?url=");
  });
});

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}
