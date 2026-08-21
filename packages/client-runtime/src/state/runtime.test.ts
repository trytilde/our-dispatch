import { describe, expect, it, vi } from "vite-plus/test";
import { createClientAuthAdapter } from "../auth.js";
import { createOpenBotClient, type OpenBotClient } from "../chat/client.js";
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

  it("shows an active-turn send in the queue and coalesces queue refreshes", async () => {
    let emitEvent: Parameters<OpenBotClient["observeSession"]>[2] = () => undefined;
    let resolveSend!: (value: Awaited<ReturnType<OpenBotClient["sendMessage"]>>) => void;
    let releaseQueueRefresh!: () => void;
    let holdQueueRefresh = false;
    const currentTime = new Date("2026-08-20T12:00:00Z");
    const queueRefreshBarrier = new Promise<void>((resolve) => {
      releaseQueueRefresh = resolve;
    });
    const getQueuedTurns = vi.fn(async () => {
      if (holdQueueRefresh) await queueRefreshBarrier;
      return { items: [], next_page_token: null };
    });
    const sendResponse = new Promise<Awaited<ReturnType<OpenBotClient["sendMessage"]>>>(
      (resolve) => {
        resolveSend = resolve;
      },
    );
    const baseClient = createOpenBotClient({
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
    });
    const client: OpenBotClient = {
      ...baseClient,
      getSession: async () => ({ authenticated: true, user: { subject: "owner-one" } }),
      getSidebar: async () => ({
        items: [
          {
            id: "agent-one",
            display_name: "Agent One",
            provider_id: "tilde",
            status: "ready",
            sessions: {
              items: [
                {
                  id: "session-one",
                  title: "Queue",
                  created_at: currentTime.toISOString(),
                  updated_at: currentTime.toISOString(),
                },
              ],
            },
          },
        ],
      }),
      getMessages: async () => ({ items: [], next_page_token: null }),
      getQueuedTurns,
      observeSession: async (_sessionId, signal, onEvent) => {
        emitEvent = onEvent;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      sendMessage: vi.fn(() => sendResponse),
    };
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
      now: () => currentTime,
      createId: () => "queued-one",
    });

    await runtime.actions.initialize();
    runtime.store.setState((state) => ({
      conversation: { ...state.conversation, agentBusy: true },
    }));
    const sending = runtime.actions.sendMessage({ text: "second prompt" });

    expect(runtime.store.getState().conversation.queuedTurns).toMatchObject([
      {
        id: "optimistic-queue-queued-one",
        trigger_message_ids: [],
      },
    ]);
    emitEvent({
      type: "chatkit.message.created",
      data: {
        id: "persisted-second",
        type: "ui",
        role: "user",
        session_id: "session-one",
        parts: [{ type: "text", text: "second prompt" }],
        created_at: currentTime.toISOString(),
      },
    });
    expect(runtime.store.getState().conversation.queuedTurns[0]?.trigger_message_ids).toEqual([
      "persisted-second",
    ]);

    resolveSend({
      items: runtime.store.getState().conversation.messages,
      next_page_token: null,
    });
    await sending;
    holdQueueRefresh = true;
    const firstRefresh = runtime.actions.refreshQueue();
    const secondRefresh = runtime.actions.refreshQueue();
    expect(getQueuedTurns).toHaveBeenCalledTimes(3);
    releaseQueueRefresh();
    await Promise.all([firstRefresh, secondRefresh]);
    emitEvent({
      type: "ChatKit.agent_turn.dequeued",
      data: {
        kind: {
          agent_turn_dequeued: {
            queue_item: { trigger_message_ids: ["persisted-second"] },
          },
        },
      },
    });
    expect(runtime.store.getState().conversation.queuedTurns).toEqual([]);
    runtime.dispose();
  });
});
