import { describe, expect, it, vi } from "vite-plus/test";
import { createOpenBotClient } from "./client.js";
import {
  observeMissionControlSocket,
  type MissionControlSocketTicket,
  type WebSocketLike,
} from "./websocket.js";

class TestWebSocket implements WebSocketLike {
  readyState = 0;
  closeCalls = 0;
  private readonly listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(): void {}

  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  emit(type: string, data?: unknown): void {
    if (type === "open") this.readyState = 1;
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

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
        "https://openbot.test/api/chat/activity?agent_page_size=50&session_page_size=50&agent_sort=updated_at&session_sort=updated_at",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer owner-token");
      return Response.json({
        activity: {
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
        active_session_id: null,
        active_conversation: null,
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

  it("creates a stable per-user Mission Control session", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toBe("/api/chat/sessions");
      expect(init?.method).toBe("POST");
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
      expect(JSON.parse(init.body)).toEqual({
        agent_id: "agent-one",
        title: "Agent One",
        lookup_key: "openbot:user:owner-one:agent:agent-one",
      });
      return Response.json({
        session: {
          id: "session-one",
          lookup_key: "openbot:user:owner-one:agent:agent-one",
          title: "Agent One",
          created_at: "2026-08-25T10:00:00.000Z",
          updated_at: "2026-08-25T10:00:00.000Z",
        },
      });
    });
    const client = createOpenBotClient({ fetch });

    await expect(
      client.createSession("agent-one", {
        title: "Agent One",
        lookupKey: "openbot:user:owner-one:agent:agent-one",
      }),
    ).resolves.toMatchObject({ id: "session-one" });
  });

  it("rejects malformed upstream resources at the client boundary", async () => {
    const client = createOpenBotClient({
      fetch: async () => Response.json({ items: [{ id: "missing-fields" }] }),
    });
    await expect(client.getSidebar()).rejects.toThrow();
  });

  it("searches ChatKit with encoded query, session, and cursor parameters", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(requestUrl(input)).toBe(
        "/api/chat/search?q=quarterly+review&page_size=25&session_id=session-one&next_page_token=cursor%2Ftwo",
      );
      return Response.json({
        items: [
          {
            kind: "message",
            session: {
              id: "session-one",
              title: "Quarterly planning",
              created_at: "2026-08-01T10:00:00Z",
              updated_at: "2026-08-02T10:00:00Z",
            },
            message: {
              id: "message-one",
              type: "message",
              role: "user",
              session_id: "session-one",
              text: "Quarterly review",
              created_at: "2026-08-02T10:00:00Z",
            },
          },
        ],
        next_page_token: "cursor-three",
      });
    });
    const client = createOpenBotClient({ fetch });

    await expect(
      client.searchChatKit("quarterly review", "session-one", "cursor/two"),
    ).resolves.toMatchObject({
      items: [{ kind: "message", message: { id: "message-one" } }],
      next_page_token: "cursor-three",
    });
  });

  it("connects directly to Tilde Mission Control with a short-lived socket ticket", async () => {
    const events: unknown[] = [];
    const controller = new AbortController();
    const socketUrls: string[] = [];
    let socketProtocols: string[] = [];
    const client = createOpenBotClient({
      fetch: async (input, init) => {
        expect(requestUrl(input)).toBe("/api/chat/mission-control/socket-ticket");
        expect(JSON.parse(typeof init?.body === "string" ? init.body : "")).toEqual({
          transport: "browser",
        });
        return Response.json({
          ticket: "short-lived-ticket",
          protocol: "tilde.mission-control.ticket",
          expires_at: "2026-08-26T12:00:00Z",
          websocket_url: "wss://team.api.trytilde.ai/api/v1/team/team/chatkit/mission-control/ws",
        });
      },
      createWebSocket: (url, protocols) => {
        socketUrls.push(url);
        socketProtocols = protocols;
        const socket = new TestWebSocket();
        queueMicrotask(() => {
          socket.emit("open");
          if (socketUrls.length === 1) {
            socket.emit(
              "message",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "mission_control.ready",
                params: { snapshot_revision: 41 },
              }),
            );
            socket.emit("close");
            return;
          }
          socket.emit(
            "message",
            JSON.stringify({
              jsonrpc: "2.0",
              method: "mission_control.ready",
              params: { snapshot_revision: 41 },
            }),
          );
          socket.emit(
            "message",
            JSON.stringify({
              jsonrpc: "2.0",
              method: "mission_control.event",
              params: {
                revision: 42,
                event_type: "chatkit.message.streaming",
                event: {
                  id: "event-one",
                  kind: { kind: "message_streaming", session_id: "session-one" },
                },
              },
            }),
          );
        });
        return socket;
      },
    });

    const callbackOrder: string[] = [];
    await client.observeMissionControl(
      controller.signal,
      (event) => {
        callbackOrder.push("event");
        events.push(event);
        controller.abort();
      },
      async () => {
        callbackOrder.push("ready:start");
        await Promise.resolve();
        callbackOrder.push("ready:end");
      },
    );

    expect(socketUrls).toEqual([
      "wss://team.api.trytilde.ai/api/v1/team/team/chatkit/mission-control/ws",
      "wss://team.api.trytilde.ai/api/v1/team/team/chatkit/mission-control/ws?after_revision=41",
    ]);
    expect(socketProtocols).toEqual([
      "tilde.mission-control.v1",
      "tilde.mission-control.ticket.short-lived-ticket",
    ]);
    expect(events).toEqual([
      {
        id: "event-one",
        type: "chatkit.message.streaming",
        data: {
          id: "event-one",
          kind: { kind: "message_streaming", session_id: "session-one" },
        },
      },
    ]);
    expect(callbackOrder).toEqual([
      "ready:start",
      "ready:end",
      "ready:start",
      "ready:end",
      "event",
    ]);
  });

  it("does not advance an event cursor when applying the event fails", async () => {
    const socket = new TestWebSocket();
    const revisions: number[] = [];
    const observation = observeMissionControlSocket({
      signal: new AbortController().signal,
      ticket: socketTicket(),
      createWebSocket: () => socket,
      onReady: () => undefined,
      onEvent: async () => {
        throw new Error("reducer failed");
      },
      onRevision: (revision) => revisions.push(revision),
      onHealthy: () => undefined,
    });
    socket.emit("open");
    socket.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        method: "mission_control.event",
        params: { revision: 7, event_type: "chatkit.test", event: { id: "event-seven" } },
      }),
    );

    await expect(observation).rejects.toThrow("reducer failed");
    expect(revisions).toEqual([]);
    expect(socket.closeCalls).toBe(1);
  });

  it("requests an explicit native socket ticket only when configured by an adapter", async () => {
    const controller = new AbortController();
    let requestedBody: unknown;
    const client = createOpenBotClient({
      missionControlTransport: "native",
      fetch: async (_input, init) => {
        requestedBody = JSON.parse(typeof init?.body === "string" ? init.body : "");
        return Response.json(socketTicket());
      },
      createWebSocket: () => {
        const socket = new TestWebSocket();
        queueMicrotask(() => {
          socket.emit("open");
          socket.emit(
            "message",
            JSON.stringify({
              jsonrpc: "2.0",
              method: "mission_control.ready",
              params: { snapshot_revision: 1 },
            }),
          );
        });
        return socket;
      },
    });

    await client.observeMissionControl(
      controller.signal,
      () => undefined,
      () => controller.abort(),
    );
    expect(requestedBody).toEqual({ transport: "native" });
  });

  it("closes a socket that errors after opening", async () => {
    const socket = new TestWebSocket();
    const observation = observeMissionControlSocket({
      signal: new AbortController().signal,
      ticket: socketTicket(),
      createWebSocket: () => socket,
      onReady: () => undefined,
      onEvent: () => undefined,
      onRevision: () => undefined,
      onHealthy: () => undefined,
    });
    socket.emit("open");
    socket.emit("error");

    await expect(observation).resolves.toBeUndefined();
    expect(socket.closeCalls).toBe(1);
  });

  it("loads and mutates plugin configuration through the control service", async () => {
    const calls: { method: string; url: string }[] = [];
    const client = createOpenBotClient({
      fetch: async (input, init) => {
        const url = requestUrl(input);
        calls.push({ method: init?.method ?? "GET", url });
        if (url.startsWith("/api/plugins?"))
          return Response.json({
            tools: [
              {
                provider: {
                  type_id: "github",
                  name: "GitHub",
                  credential_sources: [],
                },
                accounts: [
                  {
                    id: "github-work",
                    display_name: "Work",
                    status: "active",
                    assigned_agent_ids: ["agent-one"],
                  },
                ],
              },
            ],
            skills: [],
          });
        return Response.json({ ok: true });
      },
    });

    await expect(client.getPluginsCatalog(["agent-one", "agent-two"])).resolves.toMatchObject({
      tools: [{ accounts: [{ assigned_agent_ids: ["agent-one"] }] }],
    });
    await client.deleteConnectorAccounts(["github/work", "github-personal"]);
    await client.setToolAccountForAgent("github-work", "agent-two", true);
    await client.setSkillForAgent("skill-one", "agent-one", false);
    expect(calls).toEqual([
      { method: "GET", url: "/api/plugins?agent_id=agent-one&agent_id=agent-two" },
      { method: "DELETE", url: "/api/connectors/accounts" },
      { method: "POST", url: "/api/plugins/tools/github-work/agents/agent-two" },
      { method: "DELETE", url: "/api/plugins/skills/skill-one/agents/agent-one" },
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

function socketTicket(): MissionControlSocketTicket {
  return {
    ticket: "short-lived-ticket",
    protocol: "tilde.mission-control.ticket",
    expires_at: "2026-08-26T12:00:00Z",
    websocket_url: "wss://team.api.trytilde.ai/api/v1/team/team/chatkit/mission-control/ws",
  };
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}
