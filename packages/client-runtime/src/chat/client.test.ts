import { describe, expect, it, vi } from "vite-plus/test";
import { createOpenBotClient } from "./client.js";
import {
  observeChatKitRealtimeSocket,
  type ChatKitRealtimeSocketTicket,
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
  it("uses the authenticated installation Tilde origin for signal webhook URLs", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === "/auth/session")
        return Response.json({
          authenticated: true,
          user: { subject: "human-one", name: "Daniel" },
          tilde: { team_id: "team-one", api_base_url: "https://tilde.test/" },
        });
      if (url.startsWith("/api/tilde/signals/providers"))
        return Response.json({
          items: [
            {
              type_id: "github",
              route_descriptors: [{ path: "events" }],
              signal_types: [],
              credential_sources: [],
            },
          ],
        });
      if (url.startsWith("/api/tilde/signals/instances"))
        return Response.json({
          items: [
            {
              id: "spi-one",
              signal_provider_source_type_id: "github",
              ingress_mode: "webhook",
            },
          ],
        });
      return Response.json({ error: `Unhandled ${url}` }, { status: 404 });
    });
    const client = createOpenBotClient({ fetch });

    await client.getSession();
    await expect(client.listSignalInstances()).resolves.toEqual([
      expect.objectContaining({
        webhook_url: "https://tilde.test/api/v1/webhooks/github-signals-spi-one/events",
      }),
    ]);
  });

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
        "https://openbot.test/api/chat/workspace/sidebar?agent_page_size=50&session_page_size=50&agent_sort=updated_at&session_sort=updated_at",
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

  it("creates a stable per-user ChatKit workspace session", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toBe("/api/chat/workspace/agents/agent-one/sessions");
      expect(init?.method).toBe("POST");
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
      expect(JSON.parse(init.body)).toEqual({
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

  it("updates read state for only the authenticated user", async () => {
    let requestBody: unknown;
    const client = createOpenBotClient({
      fetch: async (input, init) => {
        expect(requestUrl(input)).toBe("/api/chat/workspace/sessions/session-one/read-state");
        expect(init?.method).toBe("PUT");
        requestBody = JSON.parse(typeof init?.body === "string" ? init.body : "");
        return Response.json({
          session_id: "session-one",
          user_id: "owner-one",
          last_read_at: "2026-08-27T12:00:00Z",
          unread: false,
          updated_at: "2026-08-27T12:00:00Z",
        });
      },
    });

    await expect(client.updateSessionReadState("session-one", false)).resolves.toMatchObject({
      session_id: "session-one",
      user_id: "owner-one",
      unread: false,
    });
    expect(requestBody).toEqual({ unread: false });
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
        "/api/chat/workspace/search?q=quarterly+review&page_size=25&session_id=session-one&next_page_token=cursor%2Ftwo",
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

  it("connects directly to Tilde ChatKit realtime with a short-lived socket ticket", async () => {
    const events: unknown[] = [];
    const controller = new AbortController();
    const socketUrls: string[] = [];
    let socketProtocols: string[] = [];
    const client = createOpenBotClient({
      fetch: async (input, init) => {
        expect(requestUrl(input)).toBe("/api/chat/realtime/socket-ticket");
        expect(JSON.parse(typeof init?.body === "string" ? init.body : "")).toEqual({
          transport: "browser",
        });
        return Response.json({
          ticket: "short-lived-ticket",
          protocol: "tilde.chatkit-realtime.ticket",
          expires_at: "2026-08-26T12:00:00Z",
          websocket_url: "wss://team.api.trytilde.ai/api/v1/team/team/chatkit/realtime",
        });
      },
      createWebSocket: (url, protocols) => {
        socketUrls.push(url);
        socketProtocols = protocols;
        const socket = new TestWebSocket();
        queueMicrotask(() => {
          socket.emit("open");
          if (socketUrls.length === 1) {
            socket.emit("message", JSON.stringify({ type: "ready", cursor: 41 }));
            socket.emit("close");
            return;
          }
          socket.emit("message", JSON.stringify({ type: "ready", cursor: 41 }));
          socket.emit(
            "message",
            JSON.stringify({
              type: "event",
              cursor: 42,
              event: {
                id: "event-one",
                occurred_at: "2026-08-26T12:00:00Z",
                type: "activity.typing.started",
                data: { session_id: "session-one", inbox_instance_id: "agent-one" },
              },
            }),
          );
        });
        return socket;
      },
    });

    const callbackOrder: string[] = [];
    await client.observeChatKitRealtime(
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
      "wss://team.api.trytilde.ai/api/v1/team/team/chatkit/realtime",
      "wss://team.api.trytilde.ai/api/v1/team/team/chatkit/realtime?after_revision=41",
    ]);
    expect(socketProtocols).toEqual([
      "tilde.chatkit-realtime.v1",
      "tilde.chatkit-realtime.ticket.short-lived-ticket",
    ]);
    expect(events).toEqual([
      {
        id: "event-one",
        occurred_at: "2026-08-26T12:00:00Z",
        type: "activity.typing.started",
        data: { session_id: "session-one", inbox_instance_id: "agent-one" },
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
    const observation = observeChatKitRealtimeSocket({
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
        type: "event",
        cursor: 7,
        event: {
          id: "event-seven",
          occurred_at: "2026-08-26T12:00:00Z",
          type: "activity.typing.started",
          data: { session_id: "session-one", inbox_instance_id: "agent-one" },
        },
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
      realtimeTransport: "native",
      fetch: async (_input, init) => {
        requestedBody = JSON.parse(typeof init?.body === "string" ? init.body : "");
        return Response.json(socketTicket());
      },
      createWebSocket: () => {
        const socket = new TestWebSocket();
        queueMicrotask(() => {
          socket.emit("open");
          socket.emit("message", JSON.stringify({ type: "ready", cursor: 1 }));
        });
        return socket;
      },
    });

    await client.observeChatKitRealtime(
      controller.signal,
      () => undefined,
      () => controller.abort(),
    );
    expect(requestedBody).toEqual({ transport: "native" });
  });

  it("closes a socket that errors after opening", async () => {
    const socket = new TestWebSocket();
    const observation = observeChatKitRealtimeSocket({
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

  it("loads and mutates plugins through native Tilde resources", async () => {
    const calls: { method: string; url: string }[] = [];
    const catalog = {
      tool_providers: [{ type_id: "github", name: "GitHub", credential_sources: [] }],
      tool_accounts: [
        {
          id: "github-work",
          display_name: "Work",
          status: "active",
          tool_group_source_type_id: "github",
        },
      ],
      mcp_servers: [
        {
          id: "server-one",
          agent_id: "agent-one",
          tools: [{ tool_group_instance_id: "github-work" }],
        },
        { id: "server-two", agent_id: "agent-two", tools: [] },
      ],
      proxied_mcp_servers: [],
      skills: [{ id: "skill-one", name: "Research", source_kind: "OpenBot" }],
      skill_providers: [],
      skill_registries: [
        { id: "registry-one", agent_id: "agent-one", skills: [{ id: "skill-one" }] },
      ],
    };
    const client = createOpenBotClient({
      fetch: async (input, init) => {
        const url = requestUrl(input);
        calls.push({ method: init?.method ?? "GET", url });
        const nativePage = nativePluginCatalogPage(url, catalog);
        if (nativePage) return Response.json(nativePage);
        if (url === "/api/tilde/mcp/provider-catalog") return Response.json({ items: [] });
        if (url.includes("enable-and-bind")) return Response.json({ complete: true });
        return Response.json({ ok: true });
      },
    });

    await expect(client.getPluginsCatalog()).resolves.toMatchObject({
      tools: [{ accounts: [{ assigned_agent_ids: ["agent-one"] }] }],
    });
    await client.deleteConnectorAccounts(["github/work", "github-personal"]);
    await client.setToolAccountForAgent("github-work", "agent-two", true);
    await client.setSkillForAgent("skill-one", "agent-one", false);
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: "GET",
          url: "/api/tilde/mcp/available-tool-groups?deployment_alias=latest&include_global=true&page_size=100",
        },
        { method: "GET", url: "/api/tilde/mcp/provider-catalog" },
        { method: "DELETE", url: "/api/tilde/mcp/tool-group/github%2Fwork" },
        { method: "DELETE", url: "/api/tilde/mcp/tool-group/github-personal" },
        {
          method: "POST",
          url: "/api/tilde/mcp/tool-group/github-work/tools/enable-and-bind",
        },
        { method: "PATCH", url: "/api/tilde/skill-registry/registry-one" },
      ]),
    );
    expect(calls.some(({ url }) => url.includes("/openbot/plugins/catalog"))).toBe(false);
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

  it("uses one same-origin room contract for roster and invitation decisions", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const participant = {
      participant_type: "human",
      participant_handle: "p123abc",
      membership_source: "invitation",
      role: "member",
      principal_user_id: "user-two",
      joined_at: "2026-09-01T10:00:00Z",
      instance: { id: "human-instance" },
      inbox: { id: "web-channel" },
    };
    const invitation = {
      id: "invite-one",
      session_id: "session-one",
      org_id: "org-one",
      team_id: "team-one",
      invitee_user_id: "user-two",
      invited_by_user_id: "user-one",
      role: "member",
      participant: {
        participant_type: "human",
        inbox_id: "web-channel",
        display_name: "User two",
      },
      status: "pending",
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
    };
    const client = createOpenBotClient({
      fetch: async (input, init) => {
        const url = requestUrl(input);
        calls.push({
          url,
          method: init?.method ?? "GET",
          ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
        });
        if (url.endsWith("/participants")) return Response.json([participant]);
        return Response.json(invitation);
      },
    });

    await expect(client.getRoomRoster("session-one")).resolves.toHaveLength(1);
    await client.inviteRoomUser("session-one", {
      inviteeUserId: "user-two",
      participant: { type: "human", inboxId: "web-channel", displayName: "User two" },
    });
    await client.decideRoomInvitation("session-one", "invite-one", "accept");
    await client.revokeRoomInvitation("session-one", "invite-one");
    await client.leaveRoom("session-one", "human-instance");

    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "/api/chat/sessions/session-one/participants"],
      ["POST", "/api/chat/sessions/session-one/invitations"],
      ["POST", "/api/chat/sessions/session-one/invitations/invite-one/decision"],
      ["DELETE", "/api/chat/sessions/session-one/invitations/invite-one"],
      ["DELETE", "/api/chat/sessions/session-one/participants/human-instance"],
    ]);
    expect(calls[1]?.body).toMatchObject({ invitee_user_id: "user-two" });
    expect(calls[2]?.body).toEqual({ decision: "accept" });
  });

  it("loads one durable work snapshot and steers a child through same-origin ChatKit", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const job = {
      id: "job-one",
      child_agent_id: "researcher",
      objective: "Compare competitors",
      status: "running",
      transcript_message_ids: [],
      artifacts: [],
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
    };
    const client = createOpenBotClient({
      fetch: async (input, init) => {
        const url = requestUrl(input);
        calls.push({
          url,
          method: init?.method ?? "GET",
          ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
        });
        if (url.includes("/goals"))
          return Response.json({
            items: [
              {
                id: "goal-one",
                objective: "Ship launch",
                status: "active",
                updated_at: "2026-09-01T10:00:00Z",
              },
            ],
          });
        if (url.includes("/tasks")) return Response.json({ items: [] });
        if (url.endsWith("/jobs?page_size=100")) return Response.json({ items: [job] });
        return Response.json(job);
      },
    });

    await expect(client.getWork("factory", "session-one")).resolves.toMatchObject({
      goals: [{ objective: "Ship launch" }],
      jobs: [{ child_agent_id: "researcher" }],
    });
    await client.steerBackgroundJob("factory", "session-one", "job-one", "Focus on pricing");

    expect(calls.slice(0, 3).map((call) => call.url)).toEqual([
      "/api/chat/agents/factory/sessions/session-one/goals?page_size=100",
      "/api/chat/agents/factory/sessions/session-one/tasks?page_size=100",
      "/api/chat/agents/factory/sessions/session-one/jobs?page_size=100",
    ]);
    expect(calls[3]).toMatchObject({
      method: "POST",
      url: "/api/chat/agents/factory/sessions/session-one/jobs/job-one/steer",
      body: { instruction: "Focus on pricing" },
    });
  });
});

function socketTicket(): ChatKitRealtimeSocketTicket {
  return {
    ticket: "short-lived-ticket",
    protocol: "tilde.chatkit-realtime.ticket",
    expires_at: "2026-08-26T12:00:00Z",
    websocket_url: "wss://team.api.trytilde.ai/api/v1/team/team/chatkit/realtime",
  };
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function nativePluginCatalogPage(
  url: string,
  catalog: {
    tool_providers: unknown[];
    tool_accounts: unknown[];
    mcp_servers: unknown[];
    proxied_mcp_servers: unknown[];
    skills: unknown[];
    skill_providers: unknown[];
    skill_registries: unknown[];
  },
): { items: unknown[] } | undefined {
  const path = url.split("?", 1)[0];
  const items =
    path === "/api/tilde/mcp/available-tool-groups"
      ? catalog.tool_providers
      : path === "/api/tilde/mcp/tool-group"
        ? catalog.tool_accounts
        : path === "/api/tilde/mcp/mcp-server"
          ? catalog.mcp_servers
          : path === "/api/tilde/mcp/proxied-mcp-servers"
            ? catalog.proxied_mcp_servers
            : path === "/api/tilde/skill"
              ? catalog.skills
              : path === "/api/tilde/skill-providers"
                ? catalog.skill_providers
                : path === "/api/tilde/skill-registry"
                  ? catalog.skill_registries
                  : undefined;
  return items ? { items } : undefined;
}
