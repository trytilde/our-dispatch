import { describe, expect, it, vi } from "vite-plus/test";
import { createClientAuthAdapter } from "../auth.js";
import { createOpenBotClient, type OpenBotClient } from "../chat/client.js";
import type { Routine } from "../contracts/routines.js";
import { createOpenBotRuntime, type OpenBotRuntimeOptions } from "./runtime.js";

describe("OpenBot runtime", () => {
  it("ignores stale search responses and opens a result through its associated bot", async () => {
    const baseClient = createOpenBotClient({
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
    });
    let resolveFirst: ((value: { items: [] }) => void) | undefined;
    const first = new Promise<{ items: [] }>((resolve) => {
      resolveFirst = resolve;
    });
    const client: OpenBotClient = {
      ...baseClient,
      searchChatKit: async (query) =>
        query === "first"
          ? first
          : {
              items: [
                {
                  kind: "agent" as const,
                  session: {
                    id: "session-one",
                    title: "Planning",
                    created_at: "2026-08-01T10:00:00Z",
                    updated_at: "2026-08-02T10:00:00Z",
                  },
                  agent: { id: "agent-one", display_name: "Agent One" },
                },
              ],
            },
      getConversationSnapshot: async () => ({
        messages: { items: [] },
        queued_turns: { items: [] },
        snapshot_revision: 1,
      }),
    };
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
    });

    const stale = runtime.actions.searchChatKit("first");
    await runtime.actions.searchChatKit("planning");
    resolveFirst?.({ items: [] });
    await stale;
    expect(runtime.store.getState().search.items).toHaveLength(1);

    await runtime.actions.selectSearchHit(runtime.store.getState().search.items[0]!);
    expect(runtime.store.getState().sidebar.selectedAgentId).toBe("agent-one");
    expect(runtime.store.getState().conversation.selectedSessionId).toBe("session-one");
    expect(runtime.store.getState().search.status).toBe("idle");
  });

  it("owns agent setup through readiness and selects the newly surfaced agent", async () => {
    const jobId = "55555555-5555-4555-8555-555555555555";
    let ready = false;
    const persisted: unknown[] = [];
    const baseClient = createOpenBotClient({
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
    });
    const client: OpenBotClient = {
      ...baseClient,
      startAgentSetup: async () => ({
        status: "setting_up",
        job_id: jobId,
        agent: { id: "reviewer", name: "Reviewer" },
      }),
      getAgentSetup: async () => {
        if (!ready) {
          ready = true;
          return { status: "setting_up" } as const;
        }
        return {
          status: "ready",
          agent: { id: "reviewer", name: "Reviewer" },
        } as const;
      },
      getBootstrap: async () => ({
        sidebar: {
          items: ready
            ? [
                {
                  id: "reviewer",
                  display_name: "Reviewer",
                  provider_id: "tilde",
                  status: "enabled",
                  sessions: { items: [] },
                },
              ]
            : [],
        },
      }),
    };
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
      schedule: (callback) => setTimeout(callback, 0),
      agentSetupPersistence: {
        load: () => null,
        save: (state) => persisted.push(state),
      },
    });

    await runtime.actions.startAgentSetup("Reviewer", "new-bot-2-4");
    expect(runtime.store.getState().agentSetup.status).toBe("setting_up");
    await vi.waitFor(() => expect(runtime.store.getState().agentSetup.status).toBe("idle"));
    expect(runtime.store.getState().sidebar.selectedAgentId).toBe("reviewer");
    expect(persisted).toContainEqual(
      expect.objectContaining({
        status: "setting_up",
        jobId,
        agent: expect.objectContaining({ id: "reviewer" }),
        avatarId: "new-bot-2-4",
      }),
    );
    expect(persisted.at(-1)).toBeNull();
    runtime.dispose();
  });

  it("hydrates authentication and sidebar state outside React", async () => {
    const client = createOpenBotClient({
      fetch: async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "/auth/session")
          return Response.json({
            authenticated: true,
            user: { subject: "owner-one", name: "Owner One" },
          });
        if (url.startsWith("/api/chat/mission-control/bootstrap"))
          return Response.json({
            sidebar: {
              items: [
                {
                  id: "agent-one",
                  display_name: "Agent One",
                  provider_id: "tilde",
                  status: "ready",
                  sessions: { items: [] },
                },
              ],
            },
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

  it("selects the authenticated user's stable session instead of the newest thread", async () => {
    const now = "2026-08-25T10:00:00.000Z";
    const getConversationSnapshot = vi.fn(async () => ({
      messages: { items: [], next_page_token: null },
      queued_turns: { items: [], next_page_token: null },
      snapshot_revision: 0,
    }));
    const getAgentSessions = vi.fn(async () => ({
      items: [
        {
          id: "older-thread",
          title: "Earlier investigation",
          created_at: "2026-08-23T10:00:00.000Z",
          updated_at: "2026-08-23T10:00:00.000Z",
        },
      ],
      next_page_token: null,
    }));
    const baseClient = createOpenBotClient({
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
    });
    const client: OpenBotClient = {
      ...baseClient,
      getSession: async () => ({
        authenticated: true,
        user: { subject: "owner-one", name: "Owner One" },
      }),
      getBootstrap: async () => ({
        sidebar: {
          items: [
            {
              id: "agent-one",
              display_name: "Agent One",
              provider_id: "tilde",
              status: "ready",
              sessions: {
                next_page_token: "page-two",
                items: [
                  {
                    id: "newest-thread",
                    title: "Deployment investigation",
                    created_at: now,
                    updated_at: now,
                  },
                  {
                    id: "owner-default",
                    lookup_key: "openbot:user:owner-one:agent:agent-one",
                    created_at: "2026-08-24T10:00:00.000Z",
                    updated_at: "2026-08-24T10:00:00.000Z",
                  },
                ],
              },
            },
          ],
        },
      }),
      getAgentSessions,
      getConversationSnapshot,
      getQueuedTurns: async () => ({ items: [], next_page_token: null }),
      observeMissionControl: async (signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    };
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
    });

    await runtime.actions.initialize();

    expect(runtime.store.getState().conversation.selectedSessionId).toBe("owner-default");
    expect(runtime.store.getState().sidebar.agents[0]?.sessions.items).toHaveLength(3);
    expect(getAgentSessions).toHaveBeenCalledWith("agent-one", "page-two", "updated_at");
    expect(getConversationSnapshot).toHaveBeenCalledWith("owner-default");
    runtime.dispose();
  });

  it("creates the authenticated user's default session with a stable lookup key", async () => {
    const createdAt = "2026-08-25T10:00:00.000Z";
    const baseClient = createOpenBotClient({
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
    });
    const createSession = vi.fn(async () => ({
      id: "owner-default",
      lookup_key: "openbot:user:owner-one:agent:agent-one",
      created_at: createdAt,
      updated_at: createdAt,
    }));
    const client: OpenBotClient = {
      ...baseClient,
      getSession: async () => ({
        authenticated: true,
        user: { subject: "owner-one", name: "Owner One" },
      }),
      getBootstrap: async () => ({
        sidebar: {
          items: [
            {
              id: "agent-one",
              display_name: "Agent One",
              provider_id: "tilde",
              status: "ready",
              sessions: { items: [] },
            },
          ],
        },
      }),
      createSession,
      getMessages: async () => ({ items: [], next_page_token: null }),
      getQueuedTurns: async () => ({ items: [], next_page_token: null }),
      observeMissionControl: async (signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    };
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
    });

    await runtime.actions.initialize();
    await expect(runtime.actions.ensureSession()).resolves.toBe("owner-default");

    expect(createSession).toHaveBeenCalledWith("agent-one", {
      title: "Agent One",
      lookupKey: "openbot:user:owner-one:agent:agent-one",
    });
    runtime.dispose();
  });

  it("loads agent navigation without hydrating chat messages or observers", async () => {
    const now = "2026-08-24T10:00:00.000Z";
    const baseClient = createOpenBotClient({
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
    });
    const getMessages = vi.fn(async () => ({ items: [], next_page_token: null }));
    const observeMissionControl = vi.fn(async () => undefined);
    const client: OpenBotClient = {
      ...baseClient,
      getSession: async () => ({
        authenticated: true,
        user: { subject: "owner-one", name: "Owner One" },
      }),
      getBootstrap: async () => ({
        sidebar: {
          items: [
            {
              id: "agent-one",
              display_name: "Agent One",
              provider_id: "tilde",
              status: "ready",
              sessions: {
                items: [{ id: "session-one", created_at: now, updated_at: now }],
              },
            },
          ],
        },
      }),
      getMessages,
      observeMissionControl,
    };
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
    });

    await runtime.actions.initialize({ workspace: false });

    expect(runtime.store.getState().sidebar.agents.map(({ id }) => id)).toEqual(["agent-one"]);
    expect(runtime.store.getState().conversation.selectedSessionId).toBe("");
    expect(getMessages).not.toHaveBeenCalled();
    expect(observeMissionControl).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("captures initial sidebar failures without leaking an unhandled rejection", async () => {
    let sidebarRequests = 0;
    const client = createOpenBotClient({
      fetch: async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "/auth/session")
          return Response.json({
            authenticated: true,
            user: { subject: "owner-one", name: "Owner One" },
          });
        if (url.includes("/mission-control/bootstrap")) sidebarRequests += 1;
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
    expect(sidebarRequests).toBe(1);
    runtime.dispose();
  });

  it("hydrates the aggregate snapshot before accepting Mission Control events", async () => {
    let bootstrapRequests = 0;
    const baseClient = createOpenBotClient({
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
    });
    const client: OpenBotClient = {
      ...baseClient,
      getSession: async () => ({
        authenticated: true,
        user: { subject: "owner-one", name: "Owner One" },
      }),
      getBootstrap: async () => {
        bootstrapRequests += 1;
        return { sidebar: { items: [] } };
      },
      observeMissionControl: async (signal, _onEvent, onReady) => {
        await onReady();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    };
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
      schedule: (callback) => setTimeout(callback, 0),
    });

    await runtime.actions.initialize();
    await vi.waitFor(() => expect(bootstrapRequests).toBe(2));
    runtime.dispose();
  });

  it("keeps inactive agents busy and reconciles their messages from the team stream", async () => {
    let emitEvent: Parameters<OpenBotClient["observeMissionControl"]>[1] = () => undefined;
    const now = "2026-08-21T08:21:00.000Z";
    const baseClient = createOpenBotClient({
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
    });
    const client: OpenBotClient = {
      ...baseClient,
      getSession: async () => ({
        authenticated: true,
        user: { subject: "owner-one", name: "Owner One" },
      }),
      getBootstrap: async () => ({
        sidebar: {
          items: [
            {
              id: "agent-one",
              display_name: "Agent One",
              provider_id: "tilde",
              status: "ready",
              sessions: {
                items: [
                  { id: "session-one", created_at: now, updated_at: now },
                  { id: "session-one-thread", created_at: now, updated_at: now },
                ],
              },
            },
            {
              id: "agent-two",
              display_name: "Agent Two",
              provider_id: "tilde",
              status: "ready",
              sessions: {
                items: [{ id: "session-two", created_at: now, updated_at: now }],
              },
            },
          ],
        },
        active_session_id: "session-one",
        active_conversation: {
          messages: { items: [], next_page_token: null },
          queued_turns: { items: [], next_page_token: null },
          snapshot_revision: 0,
        },
      }),
      getConversationSnapshot: async () => ({
        messages: { items: [], next_page_token: null },
        queued_turns: { items: [], next_page_token: null },
        snapshot_revision: 0,
      }),
      getMessages: async () => ({ items: [], next_page_token: null }),
      getQueuedTurns: async () => ({ items: [], next_page_token: null }),
      observeMissionControl: async (signal, onEvent) => {
        emitEvent = onEvent;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    };
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
    });

    await runtime.actions.initialize();
    await emitEvent({
      id: "typing-one",
      type: "InboxInstance.typing_indicator.typing",
      data: {
        kind: {
          kind: "inbox_instance_typing_indicator",
          session_id: "session-one",
          status: "typing",
        },
      },
    });
    const agentOneThread = runtime.store
      .getState()
      .sidebar.agents[0]?.sessions.items.find((session) => session.id === "session-one-thread");
    if (!agentOneThread) throw new Error("Expected the second session for agent one");
    await runtime.actions.selectSession("agent-one", agentOneThread);
    expect(runtime.store.getState().conversation.agentBusy).toBe(false);
    await runtime.actions.selectAgent("agent-two");
    await emitEvent({
      id: "stream-one",
      type: "chatkit.message.streaming",
      data: {
        kind: {
          kind: "message_streaming",
          message_id: "assistant-one",
          session_id: "session-one",
          delta: {
            type: "text-delta",
            delta: "Background result",
          },
        },
      },
    });

    expect(runtime.store.getState().sidebar.busyAgentIds).toContain("agent-one");
    expect(runtime.store.getState().sidebar.busySessionIds).toContain("session-one");
    expect(runtime.store.getState().conversation.agentBusy).toBe(false);
    const backgroundAgent = runtime.store
      .getState()
      .sidebar.agents.find((agent) => agent.id === "agent-one");
    expect(backgroundAgent?.last_message_preview).toBe("Background result");
    expect(backgroundAgent?.sessions.items[0]?.unread).toBe(true);

    await emitEvent({
      id: "idle-one",
      type: "InboxInstance.typing_indicator.idle",
      data: {
        kind: {
          kind: "inbox_instance_typing_indicator",
          session_id: "session-one",
          status: "idle",
        },
      },
    });
    expect(runtime.store.getState().sidebar.busyAgentIds).not.toContain("agent-one");
    expect(runtime.store.getState().sidebar.busySessionIds).not.toContain("session-one");
    runtime.dispose();
  });

  it("replays an event whose first state application fails", async () => {
    let emitEvent: Parameters<OpenBotClient["observeMissionControl"]>[1] = () => undefined;
    let failClock = false;
    const now = new Date("2026-08-21T08:21:00.000Z");
    const baseClient = createOpenBotClient({
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
    });
    const client: OpenBotClient = {
      ...baseClient,
      getSession: async () => ({
        authenticated: true,
        user: { subject: "owner-one", name: "Owner One" },
      }),
      getBootstrap: async () => ({
        sidebar: {
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
                    created_at: now.toISOString(),
                    updated_at: now.toISOString(),
                  },
                ],
              },
            },
          ],
        },
      }),
      getMessages: async () => ({ items: [], next_page_token: null }),
      getQueuedTurns: async () => ({ items: [], next_page_token: null }),
      observeMissionControl: async (signal, onEvent) => {
        emitEvent = onEvent;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    };
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
      now: () => {
        if (failClock) throw new Error("clock failed");
        return now;
      },
    });
    await runtime.actions.initialize();
    await runtime.actions.selectAgent("agent-one");
    const event = {
      id: "replayed-event",
      type: "chatkit.message.streaming",
      data: {
        kind: {
          kind: "message_streaming",
          message_id: "assistant-one",
          session_id: "session-one",
          delta: { type: "text-delta", delta: "Recovered" },
        },
      },
    };

    failClock = true;
    expect(() => emitEvent(event)).toThrow("clock failed");
    failClock = false;
    await emitEvent(event);

    expect(runtime.store.getState().conversation.messages).toMatchObject([
      { id: "assistant-one", role: "assistant" },
    ]);
    runtime.dispose();
  });

  it("shows an active-turn send in the queue and coalesces queue refreshes", async () => {
    let emitEvent: Parameters<OpenBotClient["observeMissionControl"]>[1] = () => undefined;
    let resolveSend!: (value: Awaited<ReturnType<OpenBotClient["submitTurn"]>>) => void;
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
    const sendResponse = new Promise<Awaited<ReturnType<OpenBotClient["submitTurn"]>>>(
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
      getSession: async () => ({
        authenticated: true,
        user: { subject: "owner-one", name: "Owner One" },
      }),
      getBootstrap: async () => ({
        sidebar: {
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
        },
        active_session_id: "session-one",
        active_conversation: {
          messages: { items: [], next_page_token: null },
          queued_turns: { items: [], next_page_token: null },
          snapshot_revision: 0,
        },
      }),
      getConversationSnapshot: async () => ({
        messages: { items: [], next_page_token: null },
        queued_turns: { items: [], next_page_token: null },
        snapshot_revision: 0,
      }),
      getMessages: async () => ({ items: [], next_page_token: null }),
      getQueuedTurns,
      observeMissionControl: async (signal, onEvent) => {
        emitEvent = onEvent;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      submitTurn: vi.fn(() => sendResponse),
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
    await emitEvent({
      type: "chatkit.message.created",
      data: {
        kind: {
          kind: "message_created",
          message: {
            id: "persisted-second",
            type: "ui",
            role: "user",
            session_id: "session-one",
            parts: [{ type: "text", text: "second prompt" }],
            created_at: currentTime.toISOString(),
          },
        },
      },
    });
    expect(runtime.store.getState().conversation.queuedTurns[0]?.trigger_message_ids).toEqual([
      "persisted-second",
    ]);
    await emitEvent({
      type: "ChatKit.agent_turn.queued",
      data: {
        kind: {
          kind: "agent_turn_queued",
          queue_item: {
            id: "durable-queue-one",
            session_id: "session-one",
            queue_position: 1_000,
            status: "pending",
            chat_request: {
              messages: [{ role: "user", content: [{ type: "text", text: "second prompt" }] }],
            },
            trigger_message_ids: ["persisted-second"],
            created_at: currentTime.toISOString(),
          },
        },
      },
    });
    expect(runtime.store.getState().conversation.queuedTurns).toMatchObject([
      {
        id: "durable-queue-one",
        trigger_message_ids: ["persisted-second"],
      },
    ]);
    expect(runtime.store.getState().conversation.queuedTurns[0]?.id).not.toContain(
      "optimistic-queue-",
    );

    resolveSend({
      session: {
        id: "session-one",
        title: "Queue",
        created_at: currentTime.toISOString(),
        updated_at: currentTime.toISOString(),
      },
      conversation: {
        messages: {
          items: runtime.store.getState().conversation.messages,
          next_page_token: null,
        },
        queued_turns: {
          items: runtime.store.getState().conversation.queuedTurns,
          next_page_token: null,
        },
        snapshot_revision: 1,
      },
    });
    await sending;
    holdQueueRefresh = true;
    const firstRefresh = runtime.actions.refreshQueue();
    const secondRefresh = runtime.actions.refreshQueue();
    expect(getQueuedTurns).toHaveBeenCalledTimes(1);
    releaseQueueRefresh();
    await Promise.all([firstRefresh, secondRefresh]);
    await emitEvent({
      type: "ChatKit.agent_turn.dequeued",
      data: {
        kind: {
          agent_turn_dequeued: {
            queue_item: {
              session_id: "session-one",
              trigger_message_ids: ["persisted-second"],
            },
          },
        },
      },
    });
    expect(runtime.store.getState().conversation.queuedTurns).toEqual([]);
    runtime.dispose();
  });

  it("reorders a queued turn using its persisted queue position", async () => {
    let releaseReorder!: () => void;
    const reorderBarrier = new Promise<void>((resolve) => {
      releaseReorder = resolve;
    });
    const baseClient = createOpenBotClient({
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
    });
    const reorderQueuedTurn = vi.fn(async () => reorderBarrier);
    const client: OpenBotClient = {
      ...baseClient,
      reorderQueuedTurn,
      getQueuedTurns: async () => ({ items: [], next_page_token: null }),
    };
    const runtime = createOpenBotRuntime({
      client,
      auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
    });
    const queuedTurns = [
      {
        id: "queued-one",
        session_id: "session-one",
        queue_position: 1_000,
        status: "pending",
        chat_request: {},
        created_at: "2026-08-21T10:00:00.000Z",
      },
      {
        id: "queued-two",
        session_id: "session-one",
        queue_position: 2_000,
        status: "pending",
        chat_request: {},
        created_at: "2026-08-21T10:00:01.000Z",
      },
    ];
    runtime.store.setState((state) => ({
      conversation: {
        ...state.conversation,
        selectedSessionId: "session-one",
        queuedTurns,
      },
    }));

    const reordering = runtime.actions.reorderQueuedTurn("queued-two", 999);

    expect(reorderQueuedTurn).toHaveBeenCalledWith("queued-two", 999);
    expect(runtime.store.getState().conversation.queuedTurns.map((turn) => turn.id)).toEqual([
      "queued-two",
      "queued-one",
    ]);
    expect(runtime.store.getState().conversation.queuedTurns[0]?.queue_position).toBe(999);

    releaseReorder();
    await reordering;
    runtime.dispose();
  });
});

function testRoutine(id: string, name: string): Routine {
  return {
    id,
    agent_id: "agent-one",
    name,
    instruction: "Do the thing",
    enabled: true,
    triggers: [
      {
        id: `${id}-trigger`,
        kind: "schedule",
        schedule: "0 7 * * *",
        description: "Daily at 07:00 UTC",
        routine_id: `rt-${id}`,
      },
    ],
    created_at: "2026-08-24T00:00:00Z",
    updated_at: "2026-08-24T00:00:00Z",
  };
}

function createRoutineRuntime(
  overrides: Partial<OpenBotClient>,
  runtimeOptions: Partial<OpenBotRuntimeOptions> = {},
) {
  const baseClient = createOpenBotClient({
    fetch: async () => {
      throw new Error("Unexpected HTTP request");
    },
  });
  const client: OpenBotClient = { ...baseClient, ...overrides };
  return createOpenBotRuntime({
    client,
    auth: createClientAuthAdapter(client, { signIn: async () => undefined }),
    ...runtimeOptions,
  });
}

describe("OpenBot runtime routines slice", () => {
  it("refreshes routines into the per-agent map", async () => {
    const runtime = createRoutineRuntime({
      listRoutines: async () => [testRoutine("r-1", "Deploy watchdog")],
    });

    await runtime.actions.refreshRoutines("agent-one");

    const routines = runtime.store.getState().routines;
    expect(routines.status).toBe("ready");
    expect(routines.byAgentId["agent-one"]).toMatchObject([{ id: "r-1" }]);
    runtime.dispose();
  });

  it("replaces the agent list wholesale from mutation responses", async () => {
    const runtime = createRoutineRuntime({
      listRoutines: async () => [testRoutine("r-1", "First")],
      createRoutine: async () => [testRoutine("r-1", "First"), testRoutine("r-2", "Second")],
      deleteRoutine: async () => [testRoutine("r-2", "Second")],
    });

    await runtime.actions.refreshRoutines("agent-one");
    await runtime.actions.createRoutine({
      agentId: "agent-one",
      name: "Second",
      instruction: "Do the thing",
      triggers: [{ kind: "schedule", schedule: "0 7 * * *" }],
    });
    expect(runtime.store.getState().routines.byAgentId["agent-one"]).toMatchObject([
      { id: "r-1" },
      { id: "r-2" },
    ]);

    await runtime.actions.deleteRoutine("r-1", "agent-one");
    expect(runtime.store.getState().routines.byAgentId["agent-one"]).toMatchObject([{ id: "r-2" }]);
    runtime.dispose();
  });

  it("runs a routine and refreshes the list afterwards", async () => {
    const listRoutines = vi.fn(async () => [testRoutine("r-1", "Deploy watchdog")]);
    const runtime = createRoutineRuntime({
      listRoutines,
      runRoutine: async () => "session-run",
    });

    await expect(runtime.actions.runRoutine("r-1", "agent-one")).resolves.toBe("session-run");
    expect(listRoutines).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("schedules and cancels polling through the injected scheduler", async () => {
    const scheduled: { callback: () => void; delay: number; handle: number }[] = [];
    const cancelled: unknown[] = [];
    let nextHandle = 1;
    const listRoutines = vi.fn(async () => [testRoutine("r-1", "Deploy watchdog")]);
    const runtime = createRoutineRuntime(
      { listRoutines },
      {
        schedule: (callback, delay) => {
          const handle = nextHandle++;
          scheduled.push({ callback, delay, handle });
          return handle as unknown as ReturnType<typeof setTimeout>;
        },
        cancelScheduled: (handle) => {
          cancelled.push(handle);
        },
      },
    );

    runtime.actions.startRoutinePolling("agent-one");
    expect(listRoutines).toHaveBeenCalledTimes(1);
    expect(scheduled).toMatchObject([{ delay: 30_000 }]);

    scheduled[0]?.callback();
    await vi.waitFor(() => expect(listRoutines).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(scheduled).toHaveLength(2));

    runtime.actions.stopRoutinePolling();
    expect(cancelled).toEqual([scheduled[1]?.handle]);

    scheduled[1]?.callback();
    await vi.waitFor(() => expect(listRoutines).toHaveBeenCalledTimes(3));
    expect(scheduled).toHaveLength(2);
    runtime.dispose();
  });

  it("keeps the poll timer out of published state", async () => {
    const listRoutines = vi.fn(async () => [testRoutine("r-1", "Deploy watchdog")]);
    const runtime = createRoutineRuntime(
      { listRoutines },
      {
        schedule: (_callback, _delay) => 1 as unknown as ReturnType<typeof setTimeout>,
        cancelScheduled: () => undefined,
      },
    );

    runtime.actions.startRoutinePolling("agent-one");
    await vi.waitFor(() => expect(runtime.store.getState().routines.status).toBe("ready"));
    expect(runtime.store.getState().routines).not.toHaveProperty("pollHandle");

    const before = runtime.store.getState().routines;
    let notifications = 0;
    const unsubscribe = runtime.store.subscribe(() => {
      notifications += 1;
    });
    runtime.actions.stopRoutinePolling();
    expect(notifications).toBe(0);
    expect(runtime.store.getState().routines).toBe(before);
    unsubscribe();
    runtime.dispose();
  });

  it("keeps previous items when a refresh fails", async () => {
    let fail = false;
    const runtime = createRoutineRuntime({
      listRoutines: async () => {
        if (fail) throw new Error("Routines unavailable");
        return [testRoutine("r-1", "Deploy watchdog")];
      },
    });

    await runtime.actions.refreshRoutines("agent-one");
    fail = true;
    await expect(runtime.actions.refreshRoutines("agent-one")).rejects.toThrow(
      "Routines unavailable",
    );

    const routines = runtime.store.getState().routines;
    expect(routines.status).toBe("error");
    expect(routines.error).toBe("Routines unavailable");
    expect(routines.byAgentId["agent-one"]).toMatchObject([{ id: "r-1" }]);
    runtime.dispose();
  });
});

describe("OpenBot runtime signals slice", () => {
  it("refreshes providers, instances, and per-instance deliveries", async () => {
    const runtime = createRoutineRuntime({
      listSignalProviders: async () => [
        { type_id: "github", name: "GitHub", requires_signing_key: true, signal_types: [] },
      ],
      listSignalInstances: async () => [
        {
          id: "spi_1",
          display_name: "Acme GitHub",
          provider_type: "github",
          status: "enabled",
          ingress_mode: "webhook",
          created_at: "2026-08-24T00:00:00Z",
          updated_at: "2026-08-24T00:00:00Z",
        },
      ],
      listSignalDeliveries: async () => [
        {
          id: "del-1",
          instance_id: "spi_1",
          signal_type: "github.pull_request.opened",
          status: "completed",
          created_at: "2026-08-24T00:00:00Z",
        },
      ],
    });

    await runtime.actions.refreshSignalProviders();
    await runtime.actions.refreshSignalInstances();
    await runtime.actions.refreshSignalDeliveries("spi_1");

    const signals = runtime.store.getState().signals;
    expect(signals.status).toBe("ready");
    expect(signals.providers).toMatchObject([{ type_id: "github" }]);
    expect(signals.instances).toMatchObject([{ id: "spi_1" }]);
    expect(signals.deliveriesByInstanceId.spi_1).toMatchObject([{ id: "del-1" }]);
    runtime.dispose();
  });

  it("keeps a provider failure visible when a concurrent instance fetch succeeds", async () => {
    const runtime = createRoutineRuntime({
      listSignalProviders: async () => {
        throw new Error("Providers unavailable");
      },
      listSignalInstances: async () => [],
    });

    const providers = runtime.actions.refreshSignalProviders();
    const instances = runtime.actions.refreshSignalInstances();
    await expect(providers).rejects.toThrow("Providers unavailable");
    await instances;

    const signals = runtime.store.getState().signals;
    expect(signals.status).toBe("error");
    expect(signals.error).toBe("Providers unavailable");

    await runtime.actions.refreshSignalProviders().catch(() => undefined);
    runtime.dispose();
  });

  it("clears the error once the failing fetch recovers", async () => {
    let fail = true;
    const runtime = createRoutineRuntime({
      listSignalProviders: async () => {
        if (fail) throw new Error("Providers unavailable");
        return [];
      },
      listSignalInstances: async () => [],
    });

    await expect(runtime.actions.refreshSignalProviders()).rejects.toThrow();
    fail = false;
    await runtime.actions.refreshSignalProviders();
    await runtime.actions.refreshSignalInstances();

    const signals = runtime.store.getState().signals;
    expect(signals.status).toBe("ready");
    expect(signals.error).toBe("");
    runtime.dispose();
  });

  it("forgets a per-source error on sign out", async () => {
    let fail = true;
    const runtime = createRoutineRuntime({
      logout: async () => undefined,
      listSignalProviders: async () => {
        if (fail) throw new Error("Providers unavailable");
        return [];
      },
      listSignalInstances: async () => [],
    });

    await expect(runtime.actions.refreshSignalProviders()).rejects.toThrow();
    await runtime.actions.signOut();
    fail = false;
    await runtime.actions.refreshSignalInstances();

    const signals = runtime.store.getState().signals;
    expect(signals.status).toBe("ready");
    expect(signals.error).toBe("");
    runtime.dispose();
  });

  it("keeps previous instances when a refresh fails and records the error", async () => {
    let fail = false;
    const runtime = createRoutineRuntime({
      listSignalInstances: async () => {
        if (fail) throw new Error("Signals unavailable");
        return [
          {
            id: "spi_1",
            display_name: "Acme GitHub",
            provider_type: "github",
            status: "enabled",
            ingress_mode: "webhook",
            created_at: "2026-08-24T00:00:00Z",
            updated_at: "2026-08-24T00:00:00Z",
          },
        ];
      },
    });

    await runtime.actions.refreshSignalInstances();
    fail = true;
    await expect(runtime.actions.refreshSignalInstances()).rejects.toThrow("Signals unavailable");

    const signals = runtime.store.getState().signals;
    expect(signals.status).toBe("error");
    expect(signals.instances).toMatchObject([{ id: "spi_1" }]);
    runtime.dispose();
  });
});
