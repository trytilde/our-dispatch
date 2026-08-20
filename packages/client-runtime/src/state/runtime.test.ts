import { describe, expect, it } from "vite-plus/test";
import { createClientAuthAdapter } from "../auth.js";
import { createOpenBotClient } from "../chat/client.js";
import { createOpenBotRuntime } from "./runtime.js";

describe("OpenBot runtime", () => {
  it("hydrates authentication and sidebar state outside React", async () => {
    const client = createOpenBotClient({
      fetch: async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "/auth/session")
          return Response.json({ authenticated: true, user: { subject: "owner-one" } });
        if (url.startsWith("/api/chat/mission-control/sidebar"))
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
        throw new Error(`Unexpected request: ${url}`);
      },
    });
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
    });

    await runtime.actions.initialize();

    expect(runtime.store.getState().auth.status).toBe("authenticated");
    expect(runtime.store.getState().sidebar.selectedAgentId).toBe("agent-one");
    expect(runtime.store.getState().sidebar.loading).toBe(false);
    runtime.dispose();
  });

  it("captures initial sidebar failures without leaking an unhandled rejection", async () => {
    const client = createOpenBotClient({
      fetch: async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "/auth/session")
          return Response.json({ authenticated: true, user: { subject: "owner-one" } });
        return Response.json({ error: "Chat unavailable" }, { status: 503 });
      },
    });
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
    });

    await expect(runtime.actions.initialize()).resolves.toBeUndefined();
    expect(runtime.store.getState().sidebar.error).toBe("Chat unavailable");
    expect(runtime.store.getState().sidebar.loading).toBe(false);
    runtime.dispose();
  });

  it("owns queued-turn mutations and refreshes the selected session", async () => {
    const mutations: string[] = [];
    let queueReads = 0;
    const client = createOpenBotClient({
      fetch: async (input, init) => {
        const value =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(value, "https://openbot.test");
        if (url.pathname === "/api/chat/agent-turn-queue") {
          queueReads += 1;
          return Response.json({
            items:
              queueReads === 1
                ? [
                    {
                      id: "turn-one",
                      session_id: "session-one",
                      queue_position: 2,
                      status: "pending",
                      chat_request: { messages: [{ role: "user", content: "Queued work" }] },
                      created_at: "2026-08-20T12:00:00.000Z",
                    },
                  ]
                : [],
          });
        }
        if (url.pathname.startsWith("/api/chat/agent-turn-queue/")) {
          mutations.push(`${init?.method ?? "GET"} ${url.pathname}`);
          return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
    });
    runtime.store.setState((state) => ({
      conversation: { ...state.conversation, selectedSessionId: "session-one" },
    }));

    await runtime.actions.refreshQueue();
    expect(runtime.store.getState().conversation.queuedTurns).toHaveLength(1);
    await runtime.actions.reorderQueuedTurn("turn-one", 1);
    await runtime.actions.runQueuedTurnNow("turn-one");
    await runtime.actions.removeQueuedTurn("turn-one");

    expect(mutations).toEqual([
      "PATCH /api/chat/agent-turn-queue/turn-one/order",
      "POST /api/chat/agent-turn-queue/turn-one/steer",
      "DELETE /api/chat/agent-turn-queue/turn-one",
    ]);
    expect(queueReads).toBe(4);
    expect(runtime.store.getState().conversation.queuedTurns).toEqual([]);
    runtime.dispose();
  });
});
