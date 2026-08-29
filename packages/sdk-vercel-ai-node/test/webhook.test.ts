import { describe, expect, it, vi } from "vite-plus/test";
import {
  type AgentMailSignalByType,
  type ChatKitEndpointOptions,
  type Config,
  chatKitEndpoint,
  convertToAiSdkMessage,
  convertToAiSdkMessages,
  createClient,
  signBody,
  TILDE_WEBHOOK_ID_HEADER,
  TILDE_WEBHOOK_SIGNATURE_HEADER,
  TILDE_WEBHOOK_TIMESTAMP_HEADER,
  verifyWebhookRequest,
} from "../src";

const key = "whsec--test";

function testChatKitEndpoint(
  options: Omit<ChatKitEndpointOptions, "client" | "responseMode"> & {
    client?: Config;
    responseMode?: ChatKitEndpointOptions["responseMode"];
  },
) {
  const { client: clientConfig, responseMode = "agentLoop", ...endpointOptions } = options;
  return chatKitEndpoint({
    responseMode,
    ...endpointOptions,
    client: createClient({
      apiKey: "test-key",
      orgId: "org-123",
      teamId: "team_123",
      ...clientConfig,
    }),
  });
}

function signedRequest(
  body: unknown,
  timestamp = Math.floor(Date.now() / 1000),
  contextHeaders: Record<string, string> = {
    "x-tilde-org-id": "org-123",
    "x-tilde-team-id": "team_123",
    "x-tilde-session-id": "session_1",
    "x-tilde-user-id": "user_123",
    "x-external-user-id": "U123",
    "x-external-user-provider": "slack",
  },
) {
  const raw = new TextEncoder().encode(JSON.stringify(body));
  return new Request("https://example.test/webhook", {
    method: "POST",
    headers: {
      [TILDE_WEBHOOK_ID_HEADER]: "webhook-123",
      [TILDE_WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
      [TILDE_WEBHOOK_SIGNATURE_HEADER]: signBody(key, timestamp, raw),
      ...contextHeaders,
      "Content-Type": "application/json",
    },
    body: raw,
    duplex: "half",
  } as RequestInit);
}

describe("verifyWebhookRequest", () => {
  it("accepts a valid signature", async () => {
    const verified = await verifyWebhookRequest(signedRequest({ ok: true }), {
      webhookSigningKey: key,
    });

    expect(verified.webhookId).toBe("webhook-123");
    expect(verified.json).toEqual({ ok: true });
  });

  it("rejects missing headers", async () => {
    await expect(
      verifyWebhookRequest(new Request("https://example.test", { method: "POST", body: "{}" }), {
        webhookSigningKey: key,
      }),
    ).rejects.toThrow("Missing x-tilde-webhook-id header");
  });

  it("rejects stale timestamps", async () => {
    await expect(
      verifyWebhookRequest(signedRequest({ ok: true }, 1), {
        webhookSigningKey: key,
      }),
    ).rejects.toThrow("Webhook timestamp is outside tolerance");
  });

  it("rejects wrong signatures", async () => {
    const request = signedRequest({ ok: true });
    request.headers.set(TILDE_WEBHOOK_SIGNATURE_HEADER, "hmac-sha256=deadbeef");

    await expect(verifyWebhookRequest(request, { webhookSigningKey: key })).rejects.toThrow(
      "Invalid webhook signature",
    );
  });
});

describe("chatKitEndpoint", () => {
  it("injects active-turn communication tools in tool response mode", async () => {
    const handler = vi.fn(async (request: Request, context) => {
      expect(context.responseMode).toBe("tool");
      expect(context.session.tools).toHaveProperty("sendMessage");
      expect(context.session.tools).toHaveProperty("addReaction");
      expect(context.session.tools).toHaveProperty("removeReaction");
      expect(context.session.tools).toHaveProperty("getThread");
      expect(context.$provider?.tools).toBe(context.session.tools);
      expect(context.session.createMCPClient).toBeTypeOf("function");
      const forwarded = (await request.json()) as {
        messages: Array<{ role?: string }>;
      };
      expect(forwarded.messages[0]?.role).toBe("system");
      return new Response("ok");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      responseMode: "tool",
      client: { apiKey: "test-key" },
      handler,
    });
    const response = await endpoint(
      signedRequest({ messages: [] }, Math.floor(Date.now() / 1000), {
        "x-tilde-org-id": "org-123",
        "x-tilde-team-id": "team_123",
        "x-tilde-session-id": "session_1",
        "x-tilde-agent-instance-id": "agent_instance",
        "x-tilde-target-instance-id": "target_instance",
        "x-tilde-trigger-message-id": "trigger_1",
        "x-tilde-chat-provider-id": "chatkit.channel.slack",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tilde-chatkit-response-mode")).toBe("tool");
  });

  it("adds the configured request timeout to the forwarded signal", async () => {
    const handler = vi.fn(async (request: Request) => {
      await new Promise<void>((resolve) => {
        request.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      expect(request.signal.aborted).toBe(true);
      expect(request.signal.reason).toBeInstanceOf(DOMException);
      expect(request.signal.reason.name).toBe("TimeoutError");
      return new Response("timed out");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: { apiKey: "test-key" },
      requestTimeoutMs: 10,
      handler,
    });

    const response = await endpoint(signedRequest({ messages: [] }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("timed out");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("keeps the incoming abort signal when a request timeout is configured", async () => {
    const controller = new AbortController();
    const handler = vi.fn(async (request: Request) => {
      controller.abort(new Error("client disconnected"));
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) {
          resolve();
          return;
        }
        request.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      expect(request.signal.aborted).toBe(true);
      expect(request.signal.reason).toEqual(new Error("client disconnected"));
      return new Response("aborted");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: { apiKey: "test-key" },
      requestTimeoutMs: 60_000,
      handler,
    });
    const signed = signedRequest({ messages: [] });
    const request = new Request(signed, {
      signal: controller.signal,
      duplex: "half",
    } as RequestInit);

    const response = await endpoint(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("aborted");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("reconstructs the request body after verification", async () => {
    const handler = vi.fn(async (request: Request, context) => {
      expect(context.body).toEqual({ messages: [] });
      expect(context.messages).toEqual([]);
      expect(context.agent).toBeUndefined();
      expect(await request.json()).toEqual({ messages: [] });
      expect(context.orgId).toBe("org-123");
      expect(context.teamId).toBe("team_123");
      expect(context.sessionId).toBe("session_1");
      expect(context.userId).toBe("user_123");
      expect(context.externalUserId).toBe("U123");
      expect(context.externalUserProvider).toBe("slack");
      expect(context.skills).toBeDefined();
      expect(context.client.chatkit).toBeDefined();
      expect(context.skills).toBe(context.client.skills);
      expect(context.session.id).toBe("session_1");
      return new Response("ok");
    });

    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: {
        apiKey: "test-key",
      },
      handler,
    });

    const response = await endpoint(signedRequest({ messages: [] }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("exposes canonical receiving-agent metadata on the endpoint context", async () => {
    const agent = {
      id: "agent-one",
      displayName: "Agent One",
      providerId: "chatkit.agent.http-vercel-ai-sdk",
      status: "enabled",
      principalUserId: "agent-principal",
      avatar: {
        url: "/api/v1/team/team_123/chatkit/agents/agent-one/avatar",
      },
      createdAt: "2026-08-29T04:00:00Z",
      updatedAt: "2026-08-29T04:30:00Z",
    } as const;
    const handler = vi.fn(async (request: Request, context) => {
      expect(context.agent).toEqual(agent);
      expect(context.body.agent).toEqual(agent);
      expect(await request.json()).toEqual({ messages: [], agent });
      return new Response("ok");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: { apiKey: "test-key" },
      handler,
    });

    const response = await endpoint(signedRequest({ messages: [], agent }));

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("promotes validated GitHub message metadata into typed context", async () => {
    const github = {
      event: "created",
      delivery_id: "delivery-123",
      installation_id: 42,
      repository_id: 99,
      owner: "trytilde",
      repo: "agents",
      issue_number: 5,
      pull_number: 5,
      comment_id: 123,
      comment_node_id: "IC_123",
      comment_url: "https://api.github.com/comments/123",
      html_url: "https://github.com/trytilde/agents/pull/5#comment-123",
      thread_kind: "pull_request",
      message_identity: "github-comment:123",
    };
    const handler = vi.fn(async (_request: Request, context) => {
      expect(context.messages[0]?.metadata).toEqual({
        provider: "chatkit.channel.github",
        github,
      });
      expect(context.github).toEqual(github);
      expect(context.slack).toBeUndefined();
      expect(context.$chatkit_meta_provider).toEqual({
        provider: "chatkit.channel.github",
        metadata: github,
      });
      return new Response("ok");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: { apiKey: "test-key" },
      handler,
    });

    const response = await endpoint(
      signedRequest({
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "text", text: "review this" }],
            metadata: {
              provider: "chatkit.channel.github",
              github,
            },
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("promotes validated AgentMail message metadata into typed context", async () => {
    const agentmail = {
      event_id: "evt_123",
      event_type: "message.received" as const,
      inbox_id: "inbox@example.com",
      thread_id: "thr_123",
      message_id: "msg_123",
      subject: "Project update",
      from: "Sender <sender@example.com>",
      html_present: true,
      attachments: [{ attachment_id: "att_123", filename: "status.pdf" }],
    };
    const handler = vi.fn(async (_request: Request, context) => {
      expect(context.agentmail).toEqual(agentmail);
      expect(context.github).toBeUndefined();
      expect(context.slack).toBeUndefined();
      expect(context.$chatkit_meta_provider).toEqual({
        provider: "chatkit.channel.agentmail",
        metadata: agentmail,
      });
      return new Response("ok");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: { apiKey: "test-key" },
      handler,
    });

    const response = await endpoint(
      signedRequest({
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "text", text: "Please review the update" }],
            metadata: {
              provider: "chatkit.channel.agentmail",
              agentmail,
            },
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("keeps malformed provider metadata raw without promoting it", async () => {
    const metadata = {
      provider: "chatkit.channel.github",
      github: {
        owner: "trytilde",
        repo: "agents",
      },
    };
    const handler = vi.fn(async (_request: Request, context) => {
      expect(context.messages[0]?.metadata).toEqual(metadata);
      expect(context.github).toBeUndefined();
      expect(context.$chatkit_meta_provider).toBeUndefined();
      return new Response("ok");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: { apiKey: "test-key" },
      handler,
    });

    const response = await endpoint(
      signedRequest({
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "text", text: "review this" }],
            metadata,
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("promotes validated Slack message metadata into typed context", async () => {
    const slack = {
      team_id: "T123",
      channel_id: "C123",
      thread_ts: "123.456",
      message_ts: "123.789",
      event_ts: "123.999",
      user: "U123",
    };
    const handler = vi.fn(async (_request: Request, context) => {
      expect(context.slack).toEqual(slack);
      expect(context.github).toBeUndefined();
      expect(context.$chatkit_meta_provider).toEqual({
        provider: "chatkit.channel.slack",
        metadata: slack,
      });
      return new Response("ok");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: { apiKey: "test-key" },
      handler,
    });

    const response = await endpoint(
      signedRequest({
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
            metadata: {
              provider: "chatkit.channel.slack",
              route: "mention",
              slack,
            },
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("promotes validated Linq message metadata into typed context", async () => {
    const linq = {
      event_id: "event-123",
      trace_id: "trace-123",
      chat_id: "chat-123",
      owner_handle: "+12064585237",
      message: {
        id: "message-123",
        chat: {
          id: "chat-123",
          owner_handle: { id: "line-1", handle: "+12064585237" },
        },
        sender_handle: { id: "person-1", handle: "+12025550123" },
        parts: [{ type: "text", value: "hello" }],
      },
    };
    const handler = vi.fn(async (_request: Request, context) => {
      expect(context.linq).toEqual(linq);
      expect(context.github).toBeUndefined();
      expect(context.slack).toBeUndefined();
      expect(context.$chatkit_meta_provider).toEqual({
        provider: "chatkit.channel.linq",
        metadata: linq,
      });
      return new Response("ok");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: { apiKey: "test-key" },
      handler,
    });

    const response = await endpoint(
      signedRequest({
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
            metadata: { provider: "chatkit.channel.linq", linq },
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("provides validated Tilde request messages to the handler", async () => {
    const messages = [
      {
        id: "message-1",
        role: "user",
        parts: [
          { type: "text", text: "hello" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "image.png",
            url: "https://example.test/image.png",
          },
          {
            type: "dynamic-tool",
            toolCallId: "tool-1",
            toolName: "lookup",
            state: "output-available",
            input: { query: "hello" },
            output: { ok: true },
          },
          {
            type: "source-url",
            sourceId: "source-1",
            url: "https://example.test/source",
          },
          {
            type: "source-document",
            sourceId: "document-1",
            mediaType: "text/plain",
          },
          { type: "step-start" },
          { type: "data", dataType: "tilde.signal", data: { value: 1 } },
        ],
      },
    ];
    const handler = vi.fn(async (_request: Request, context) => {
      expect(context.messages).toEqual(messages);
      return new Response("ok");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: { apiKey: "test-key" },
      handler,
    });

    const response = await endpoint(signedRequest({ messages }));

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it.each([
    [{}, "body.messages must be an array"],
    [
      {
        messages: [],
        agent: {
          id: "agent-one",
          displayName: "Agent One",
          providerId: "chatkit.agent.http-vercel-ai-sdk",
          status: "retired",
          createdAt: "2026-08-29T04:00:00Z",
          updatedAt: "2026-08-29T04:30:00Z",
        },
      },
      "body.agent.status",
    ],
    [{ messages: [{ id: "message-1", role: "invalid", parts: [] }] }, "body.messages[0].role"],
    [
      {
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "file", url: "https://example.test/file" }],
          },
        ],
      },
      "body.messages[0].parts[0].mediaType",
    ],
    [
      {
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "unsupported" }],
          },
        ],
      },
      "body.messages[0].parts[0].type",
    ],
  ])("rejects an invalid ChatKit request body", async (body, error) => {
    const handler = vi.fn(async () => new Response("ok"));
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: { apiKey: "test-key" },
      handler,
    });

    const response = await endpoint(signedRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining(error),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("loads session history through the typed session client", async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://org-123.api.example.test/api/v1/team/team_123/chatkit/sessions/session_1/messages?page_size=10&next_page_token=next",
      );
      expect(new Headers(init?.headers).has("x-tilde-org-id")).toBe(false);
      return Response.json({
        items: [
          {
            id: "msg_2",
            role: "assistant",
            type: "text",
            text: "there",
            created_at: "2026-07-04T13:00:02Z",
          },
          {
            id: "msg_1",
            role: "user",
            type: "text",
            text: "hello",
            created_at: "2026-07-04T13:00:01Z",
          },
        ],
        next_page_token: "older",
      });
    });
    const handler = vi.fn(async (_request: Request, context) => {
      await expect(
        context.session.history({ pageSize: 10, nextPageToken: "next" }),
      ).resolves.toEqual({
        items: [
          {
            id: "msg_1",
            role: "user",
            type: "text",
            text: "hello",
            created_at: "2026-07-04T13:00:01Z",
          },
          {
            id: "msg_2",
            role: "assistant",
            type: "text",
            text: "there",
            created_at: "2026-07-04T13:00:02Z",
          },
        ],
        nextPageToken: "older",
      });
      return new Response("ok");
    });

    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: {
        baseUrl: "https://api.example.test",
        apiKey: "test-key",
        fetch: fetchMock as typeof fetch,
      },
      handler,
    });

    const response = await endpoint(signedRequest({ messages: [] }));
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves a non-subdomain tunnel base URL for session history", async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://example.ngrok-free.app/api/v1/team/team_123/chatkit/sessions/session_1/messages?page_size=10",
      );
      expect(new Headers(init?.headers).get("x-tilde-org-id")).toBe("org-123");
      return Response.json({ items: [] });
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: {
        baseUrl: "https://example.ngrok-free.app",
        orgSubdomain: false,
        apiKey: "test-key",
        fetch: fetchMock as typeof fetch,
      },
      handler: async (_request, context) => {
        await context.session.history({ pageSize: 10 });
        return new Response("ok");
      },
    });

    const response = await endpoint(signedRequest({ messages: [] }));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps unresolved external identity optional", async () => {
    const handler = vi.fn(async (_request: Request, context) => {
      expect(context.userId).toBeUndefined();
      expect(context.externalUserId).toBeUndefined();
      expect(context.externalUserProvider).toBeUndefined();
      return new Response("ok");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: { apiKey: "test-key" },
      handler,
    });

    const response = await endpoint(
      signedRequest({ messages: [] }, Math.floor(Date.now() / 1000), {
        "x-tilde-org-id": "org-123",
        "x-tilde-team-id": "team_123",
        "x-tilde-session-id": "session_1",
      }),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("loads full session history when no pagination params are passed", async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("page_size=100")) {
        return Response.json({
          items: [
            {
              id: "msg_3",
              role: "assistant",
              type: "text",
              text: "third",
              created_at: "2026-07-04T13:00:03Z",
            },
            {
              id: "current_msg",
              role: "user",
              type: "text",
              text: "current",
              created_at: "2026-07-04T13:00:04Z",
            },
          ],
          next_page_token: "older",
        });
      }
      expect(url).toBe(
        "https://org-123.api.example.test/api/v1/team/team_123/chatkit/sessions/session_1/messages?page_size=100&next_page_token=older",
      );
      return Response.json({
        items: [
          {
            id: "msg_1",
            role: "user",
            type: "text",
            text: "first",
            created_at: "2026-07-04T13:00:01Z",
          },
          {
            id: "msg_2",
            role: "assistant",
            type: "text",
            text: "second",
            created_at: "2026-07-04T13:00:02Z",
          },
        ],
      });
    });
    const handler = vi.fn(async (_request: Request, context) => {
      await expect(context.session.history()).resolves.toEqual({
        items: [
          {
            id: "msg_1",
            role: "user",
            type: "text",
            text: "first",
            created_at: "2026-07-04T13:00:01Z",
          },
          {
            id: "msg_2",
            role: "assistant",
            type: "text",
            text: "second",
            created_at: "2026-07-04T13:00:02Z",
          },
          {
            id: "msg_3",
            role: "assistant",
            type: "text",
            text: "third",
            created_at: "2026-07-04T13:00:03Z",
          },
        ],
      });
      return new Response("ok");
    });

    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: {
        baseUrl: "https://api.example.test",
        apiKey: "test-key",
        fetch: fetchMock as typeof fetch,
      },
      handler,
    });

    const response = await endpoint(
      signedRequest({
        messages: [{ id: "current_msg", role: "user", parts: [] }],
      }),
    );
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("excludes current request message ids from session history", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        items: [
          { id: "current_msg", role: "user", type: "text", text: "current" },
          {
            id: "previous_msg",
            role: "assistant",
            type: "text",
            text: "previous",
          },
        ],
      }),
    );
    const handler = vi.fn(async (_request: Request, context) => {
      await expect(context.session.history()).resolves.toEqual({
        items: [
          {
            id: "previous_msg",
            role: "assistant",
            type: "text",
            text: "previous",
          },
        ],
      });
      return new Response("ok");
    });

    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: {
        baseUrl: "https://api.example.test",
        apiKey: "test-key",
        fetch: fetchMock as typeof fetch,
      },
      handler,
    });

    const response = await endpoint(
      signedRequest({
        messages: [{ id: "current_msg", role: "user", parts: [] }],
      }),
    );
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("caches converted messages in one batch by default inside a ChatKit endpoint handler", async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://org-123.api.example.test/api/v1/team/team_123/chatkit/messages/converted-cache",
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        messages: [
          {
            chatkit_message_id: "msg_1",
            message: {
              id: "msg_1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
              metadata: {
                chatkit: {},
              },
            },
          },
          {
            chatkit_message_id: "msg_2",
            message: {
              id: "msg_2",
              role: "assistant",
              parts: [{ type: "text", text: "there" }],
              metadata: {
                chatkit: {},
              },
            },
          },
        ],
      });
      return Response.json({ success: true });
    });
    const handler = vi.fn(async () => {
      await convertToAiSdkMessages({
        messages: [
          {
            id: "msg_1",
            role: "user",
            type: "text",
            text: "hello",
          },
          {
            id: "msg_2",
            role: "assistant",
            type: "text",
            text: "there",
          },
        ],
      });
      return new Response("ok");
    });

    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: {
        baseUrl: "https://api.example.test",
        apiKey: "test-key",
        fetch: fetchMock as typeof fetch,
      },
      handler,
    });

    const response = await endpoint(signedRequest({ messages: [] }));
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps signal messages in typed session history", async () => {
    const signalMessage = {
      id: "signal_1",
      role: "system",
      type: "signal",
      summary: "Sentry issue created: API-1 - request failed",
      data: {
        action: "created",
        data: { issue: { id: "1", title: "request failed" } },
      },
      metadata: { signal_type: "sentry.issue.created" },
      created_at: "2026-07-04T13:00:01Z",
    };
    const fetchMock = vi.fn(async () => Response.json({ items: [signalMessage] }));
    const handler = vi.fn(async (_request: Request, context) => {
      await expect(context.session.history()).resolves.toEqual({
        items: [signalMessage],
      });
      return new Response("ok");
    });
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: {
        baseUrl: "https://api.example.test",
        apiKey: "test-key",
        fetch: fetchMock as typeof fetch,
      },
      handler,
    });

    const response = await endpoint(signedRequest({ messages: [] }));

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("uses an explicit cache callback instead of the default endpoint cache", async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    const onCacheMessage = vi.fn(async () => undefined);
    const handler = vi.fn(async () => {
      await convertToAiSdkMessages({
        messages: [
          {
            id: "msg_1",
            role: "user",
            type: "text",
            text: "hello",
          },
        ],
        onCacheMessage,
      });
      return new Response("ok");
    });

    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: {
        baseUrl: "https://api.example.test",
        apiKey: "test-key",
        fetch: fetchMock as typeof fetch,
      },
      handler,
    });

    const response = await endpoint(signedRequest({ messages: [] }));
    expect(response.status).toBe(200);
    expect(onCacheMessage).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batches explicit cache callback results", async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://org-123.api.example.test/api/v1/team/team_123/chatkit/messages/converted-cache",
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        messages: [
          {
            chatkit_message_id: "msg_1",
            message: { custom: "msg_1" },
          },
          {
            chatkit_message_id: "msg_2",
            message: { custom: "msg_2" },
          },
        ],
      });
      return Response.json({ success: true });
    });
    const onCacheMessage = vi.fn(async ({ message }) => ({
      chatKitMessageId: message.id,
      message: { custom: message.id },
    }));
    const handler = vi.fn(async () => {
      await convertToAiSdkMessages({
        messages: [
          {
            id: "msg_1",
            role: "user",
            type: "text",
            text: "hello",
          },
          {
            id: "msg_2",
            role: "assistant",
            type: "text",
            text: "there",
          },
        ],
        onCacheMessage,
      });
      return new Response("ok");
    });

    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      client: {
        baseUrl: "https://api.example.test",
        apiKey: "test-key",
        fetch: fetchMock as typeof fetch,
      },
      handler,
    });

    const response = await endpoint(signedRequest({ messages: [] }));
    expect(response.status).toBe(200);
    expect(onCacheMessage).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns 400 before calling the handler when org id is missing", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      handler,
    });

    const response = await endpoint(
      signedRequest({ messages: [] }, Math.floor(Date.now() / 1000), {
        "x-tilde-team-id": "team_123",
        "x-tilde-session-id": "session_1",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Missing x-tilde-org-id header",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 400 before calling the handler when team id is missing", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      handler,
    });

    const response = await endpoint(
      signedRequest({ messages: [] }, Math.floor(Date.now() / 1000), {
        "x-tilde-org-id": "org-123",
        "x-tilde-session-id": "session_1",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Missing x-tilde-team-id header",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 400 before calling the handler when session id is missing", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      handler,
    });

    const response = await endpoint(
      signedRequest({ messages: [] }, Math.floor(Date.now() / 1000), {
        "x-tilde-org-id": "org-123",
        "x-tilde-team-id": "team_123",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Missing x-tilde-session-id header",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 before calling the handler on invalid signatures", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const request = signedRequest({ messages: [] }, Math.floor(Date.now() / 1000), {});
    request.headers.set(TILDE_WEBHOOK_SIGNATURE_HEADER, "hmac-sha256=deadbeef");

    const endpoint = testChatKitEndpoint({
      webhookSigningKey: key,
      handler,
    });

    const response = await endpoint(request);
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("ChatKit AI SDK converters", () => {
  it("converts Tilde request data parts to AI SDK data parts", async () => {
    await expect(
      convertToAiSdkMessage({
        message: {
          id: "request_message",
          role: "user",
          parts: [
            { type: "text", text: "hello" },
            {
              type: "data",
              dataType: "tilde.signal",
              data: { summary: "changed" },
            },
          ],
        },
      }),
    ).resolves.toEqual({
      id: "request_message",
      role: "user",
      parts: [
        { type: "text", text: "hello" },
        {
          type: "data-tilde.signal",
          data: { summary: "changed" },
        },
      ],
    });
  });

  it("converts typed ChatKit text messages", async () => {
    await expect(
      convertToAiSdkMessage({
        message: {
          id: "msg_text",
          role: "user",
          type: "text",
          text: "hello",
          created_at: "2026-07-04T13:00:00Z",
        },
      }),
    ).resolves.toMatchObject({
      id: "msg_text",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
      metadata: { createdAt: "2026-07-04T13:00:00Z" },
    });
  });

  it("uses the file upload hook for unprocessed ChatKit file parts", async () => {
    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "msg_file",
            role: "user",
            type: "ui",
            parts: [
              {
                type: "file",
                media_type: "image/png",
                filename: "image.png",
                url: "/download",
                provider_metadata: {
                  chatkit: { attachmentId: "attachment_1" },
                },
              },
            ],
          },
        ],
        onUnprocessed: {
          fileUpload({ part }) {
            return {
              type: "file",
              mediaType: part.media_type,
              filename: part.filename ?? undefined,
              data: { file_id: "file_123" },
            } as never;
          },
        },
      }),
    ).resolves.toMatchObject([
      {
        id: "msg_file",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            filename: "image.png",
            data: {
              file_id: "file_123",
            },
          },
        ],
      },
    ]);
  });

  it("dispatches Sentry signals to the handler for their signal type", async () => {
    const onCreated = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: `${signal.data.action}:${signal.data.data.issue.title}`,
        },
      ],
    }));
    const onResolved = vi.fn(() => null);

    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_1",
            role: "system",
            type: "signal",
            summary: "Sentry issue created: API-1 - request failed",
            data: {
              action: "created",
              data: {
                issue: {
                  id: "1",
                  shortId: "API-1",
                  title: "request failed",
                },
              },
            },
            metadata: { signal_type: "sentry.issue.created" },
          },
        ],
        onUnprocessed: {
          sentry: {
            "sentry.issue.created": onCreated,
            "sentry.issue.resolved": onResolved,
          },
        },
      }),
    ).resolves.toEqual([
      {
        id: "signal_1",
        role: "user",
        parts: [{ type: "text", text: "created:request failed" }],
      },
    ]);
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("dispatches GitHub signals to typed handlers", async () => {
    const onIssueOpened = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: `${signal.data.repository.full_name}#${signal.data.issue.number}: ${signal.data.issue.title}`,
        },
      ],
    }));
    const onPullRequestMerged = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: `merged:${signal.data.pull_request.title}`,
        },
      ],
    }));
    const onCiFailed = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: `failed:${signal.data.check_run?.name}`,
        },
      ],
    }));

    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_issue",
            role: "system",
            type: "signal",
            data: {
              action: "opened",
              repository: { full_name: "trytilde/openbot" },
              issue: { number: 42, title: "Add GitHub signal handlers" },
            },
            metadata: { signal_type: "github.issue.opened" },
          },
          {
            id: "signal_pr",
            role: "system",
            type: "signal",
            data: {
              action: "closed",
              repository: { full_name: "trytilde/openbot" },
              pull_request: {
                number: 21,
                title: "Add remote tool endpoint helper",
                merged: true,
              },
            },
            metadata: { signal_type: "github.pull_request.merged" },
          },
          {
            id: "signal_ci",
            role: "system",
            type: "signal",
            data: {
              action: "completed",
              repository: { full_name: "trytilde/openbot" },
              check_run: {
                name: "test",
                status: "completed",
                conclusion: "failure",
              },
            },
            metadata: { signal_type: "github.ci_check.failed" },
          },
        ],
        onUnprocessed: {
          github: {
            "github.issue.opened": onIssueOpened,
            "github.pull_request.merged": onPullRequestMerged,
            "github.ci_check.failed": onCiFailed,
          },
        },
      }),
    ).resolves.toEqual([
      {
        id: "signal_issue",
        role: "user",
        parts: [
          {
            type: "text",
            text: "trytilde/openbot#42: Add GitHub signal handlers",
          },
        ],
      },
      {
        id: "signal_pr",
        role: "user",
        parts: [
          {
            type: "text",
            text: "merged:Add remote tool endpoint helper",
          },
        ],
      },
      {
        id: "signal_ci",
        role: "user",
        parts: [{ type: "text", text: "failed:test" }],
      },
    ]);
    expect(onIssueOpened).toHaveBeenCalledOnce();
    expect(onPullRequestMerged).toHaveBeenCalledOnce();
    expect(onCiFailed).toHaveBeenCalledOnce();
  });

  it("dispatches AgentMail signals to typed handlers", async () => {
    const onMessageReceived = vi.fn(
      (signal: AgentMailSignalByType["agentmail.message.received"]) => ({
        id: signal.id,
        role: "user" as const,
        parts: [
          {
            type: "text" as const,
            text: `${signal.data.message.from}:${signal.data.message.subject}`,
          },
        ],
      }),
    );
    const onDomainVerified = vi.fn(
      (signal: AgentMailSignalByType["agentmail.domain.verified"]) => ({
        id: signal.id,
        role: "user" as const,
        parts: [
          {
            type: "text" as const,
            text: `verified:${signal.data.domain.domain}`,
          },
        ],
      }),
    );

    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_message",
            role: "system",
            type: "signal",
            data: {
              event_type: "message.received",
              event_id: "evt_message",
              message: {
                inbox_id: "inbox@example.com",
                thread_id: "thr_123",
                message_id: "msg_123",
                from: "sender@example.com",
                subject: "Project update",
              },
            },
            metadata: { signal_type: "agentmail.message.received" },
          },
          {
            id: "signal_domain",
            role: "system",
            type: "signal",
            data: {
              event_type: "domain.verified",
              event_id: "evt_domain",
              domain: {
                domain_id: "dom_123",
                domain: "example.com",
              },
            },
            metadata: { signal_type: "agentmail.domain.verified" },
          },
        ],
        onUnprocessed: {
          agentmail: {
            "agentmail.message.received": onMessageReceived,
            "agentmail.domain.verified": onDomainVerified,
          },
        },
      }),
    ).resolves.toEqual([
      {
        id: "signal_message",
        role: "user",
        parts: [{ type: "text", text: "sender@example.com:Project update" }],
      },
      {
        id: "signal_domain",
        role: "user",
        parts: [{ type: "text", text: "verified:example.com" }],
      },
    ]);
    expect(onMessageReceived).toHaveBeenCalledOnce();
    expect(onDomainVerified).toHaveBeenCalledOnce();
  });

  it("drops unhandled and malformed AgentMail signals", async () => {
    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_unhandled",
            role: "system",
            type: "signal",
            data: {
              event_type: "message.sent",
              event_id: "evt_sent",
              message: {
                inbox_id: "inbox@example.com",
                thread_id: "thr_123",
                message_id: "msg_123",
              },
            },
            metadata: { signal_type: "agentmail.message.sent" },
          },
          {
            id: "signal_malformed",
            role: "system",
            type: "signal",
            data: {
              event_type: "message.delivered",
              event_id: "evt_delivered",
              message: { inbox_id: "inbox@example.com" },
            },
            metadata: { signal_type: "agentmail.message.delivered" },
          },
        ],
        onUnprocessed: { agentmail: {} },
      }),
    ).resolves.toEqual([]);
  });

  it("dispatches Firecrawl signals to typed handlers", async () => {
    const onPageChanged = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: `${signal.data.monitor.id}:${signal.data.page.url}:${signal.data.page.isMeaningful}`,
        },
      ],
    }));
    const onCheckCompleted = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: `${signal.data.check.id}:${signal.data.result.changed}`,
        },
      ],
    }));

    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_firecrawl_page",
            role: "system",
            type: "signal",
            data: {
              event: "monitor.page",
              monitor: { id: "mon_123" },
              check: { id: "chk_456" },
              page: {
                monitorId: "mon_123",
                checkId: "chk_456",
                url: "https://example.com/pricing",
                status: "changed",
                isMeaningful: true,
                diff: { text: "£10 -> £12" },
              },
              metadata: null,
            },
            metadata: { signal_type: "firecrawl.monitor.page.changed" },
          },
          {
            id: "signal_firecrawl_check",
            role: "system",
            type: "signal",
            data: {
              event: "monitor.check.completed",
              monitor: { id: "mon_123" },
              check: { id: "chk_456" },
              result: {
                monitorId: "mon_123",
                checkId: "chk_456",
                status: "completed",
                changed: 1,
              },
              metadata: null,
            },
            metadata: {
              signal_type: "firecrawl.monitor.check.completed",
            },
          },
        ],
        onUnprocessed: {
          firecrawl: {
            "firecrawl.monitor.page.changed": onPageChanged,
            "firecrawl.monitor.check.completed": onCheckCompleted,
          },
        },
      }),
    ).resolves.toEqual([
      {
        id: "signal_firecrawl_page",
        role: "user",
        parts: [
          {
            type: "text",
            text: "mon_123:https://example.com/pricing:true",
          },
        ],
      },
      {
        id: "signal_firecrawl_check",
        role: "user",
        parts: [{ type: "text", text: "chk_456:1" }],
      },
    ]);
    expect(onPageChanged).toHaveBeenCalledOnce();
    expect(onCheckCompleted).toHaveBeenCalledOnce();
  });

  it("drops unhandled and malformed Firecrawl signals", async () => {
    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_firecrawl_unhandled",
            role: "system",
            type: "signal",
            data: {
              event: "monitor.page",
              monitor: { id: "mon_123" },
              check: { id: "chk_456" },
              page: {
                url: "https://example.com/about",
                status: "same",
              },
              metadata: null,
            },
            metadata: { signal_type: "firecrawl.monitor.page.same" },
          },
          {
            id: "signal_firecrawl_malformed",
            role: "system",
            type: "signal",
            data: {
              event: "monitor.page",
              monitor: { id: "mon_123" },
              check: { id: "chk_456" },
              page: { status: "error" },
              metadata: null,
            },
            metadata: { signal_type: "firecrawl.monitor.page.error" },
          },
        ],
        onUnprocessed: { firecrawl: {} },
      }),
    ).resolves.toEqual([]);
  });

  it("drops unhandled and malformed GitHub signals", async () => {
    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_unhandled",
            role: "system",
            type: "signal",
            data: {
              action: "closed",
              repository: { full_name: "trytilde/openbot" },
              issue: { number: 42, title: "Handled elsewhere" },
            },
            metadata: { signal_type: "github.issue.closed" },
          },
          {
            id: "signal_malformed",
            role: "system",
            type: "signal",
            data: {
              action: "opened",
              repository: { full_name: "trytilde/openbot" },
              issue: { number: 43 },
            },
            metadata: { signal_type: "github.issue.opened" },
          },
        ],
        onUnprocessed: { github: {} },
      }),
    ).resolves.toEqual([]);
  });

  it("drops unhandled and malformed Sentry signals", async () => {
    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_unhandled",
            role: "system",
            type: "signal",
            data: {
              action: "resolved",
              data: { issue: { id: "1", title: "request failed" } },
            },
            metadata: { signal_type: "sentry.issue.resolved" },
          },
          {
            id: "signal_malformed",
            role: "system",
            type: "signal",
            data: {
              action: "assigned",
              data: { issue: { id: "1" } },
            },
            metadata: { signal_type: "sentry.issue.assigned" },
          },
        ],
        onUnprocessed: { sentry: {} },
      }),
    ).resolves.toEqual([]);
  });

  it("dispatches Slack signals to typed handlers", async () => {
    const onAppMention = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: `${signal.data.event.channel}:${signal.data.event.text}`,
        },
      ],
    }));
    const onMessagePosted = vi.fn(() => null);

    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_slack",
            role: "system",
            type: "signal",
            data: {
              event_id: "Ev123",
              team_id: "T123",
              api_app_id: "A123",
              type: "event_callback",
              event_time: 1724500000,
              event: {
                type: "app_mention",
                channel: "C123",
                user: "U123",
                text: "<@U999> deploy please",
                ts: "1724500000.000100",
              },
            },
            metadata: { signal_type: "slack.app_mention" },
          },
        ],
        onUnprocessed: {
          slack: {
            "slack.app_mention": onAppMention,
            "slack.message.posted": onMessagePosted,
          },
        },
      }),
    ).resolves.toEqual([
      {
        id: "signal_slack",
        role: "user",
        parts: [{ type: "text", text: "C123:<@U999> deploy please" }],
      },
    ]);
    expect(onAppMention).toHaveBeenCalledOnce();
    expect(onMessagePosted).not.toHaveBeenCalled();
  });

  it("dispatches Linq signals to event-specific typed handlers", async () => {
    const onMessageReceived = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: `${signal.data.data.chat?.id}:${signal.data.data.parts?.[0]?.type}`,
        },
      ],
    }));

    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_linq",
            role: "system",
            type: "signal",
            data: {
              api_version: "v3",
              webhook_version: "2026-02-03",
              event_type: "message.received",
              event_id: "event-123",
              created_at: "2026-08-27T12:00:00Z",
              trace_id: "trace-123",
              data: {
                id: "message-123",
                chat: { id: "chat-123" },
                parts: [{ type: "text", value: "hello" }],
              },
            },
            metadata: { signal_type: "linq.message.received" },
          },
        ],
        onUnprocessed: {
          linq: { "linq.message.received": onMessageReceived },
        },
      }),
    ).resolves.toEqual([
      {
        id: "signal_linq",
        role: "user",
        parts: [{ type: "text", text: "chat-123:text" }],
      },
    ]);
    expect(onMessageReceived).toHaveBeenCalledOnce();
  });

  it("dispatches fake signals with caller-controlled data", async () => {
    const onIssueOpened = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [{ type: "text" as const, text: JSON.stringify(signal.data) }],
    }));

    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_fake",
            role: "system",
            type: "signal",
            data: { anything: ["goes", 1, true] },
            metadata: { signal_type: "fake.issue.opened" },
          },
        ],
        onUnprocessed: {
          fake: { "fake.issue.opened": onIssueOpened },
        },
      }),
    ).resolves.toEqual([
      {
        id: "signal_fake",
        role: "user",
        parts: [{ type: "text", text: '{"anything":["goes",1,true]}' }],
      },
    ]);
    expect(onIssueOpened).toHaveBeenCalledOnce();
  });

  it("surfaces signal metadata ids and wire fields on the typed message", async () => {
    const onCreated = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: [
            signal.metadata.signal_type,
            signal.metadata.signal_delivery_id,
            signal.metadata.signal_provider_instance_id,
            signal.metadata.routine_trigger_id,
            signal.from_inbox_type_id,
            signal.user_display_name,
          ].join("|"),
        },
      ],
    }));

    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_meta",
            role: "system",
            type: "signal",
            from_inbox_type_id: "sentry",
            user_display_name: "Sentry",
            data: {
              action: "created",
              data: { issue: { id: "1", title: "request failed" } },
            },
            metadata: {
              signal_type: "sentry.issue.created",
              signal_delivery_id: "del_1",
              signal_provider_instance_id: "spi_1",
              routine_trigger_id: "trigger_1",
            },
          },
        ],
        onUnprocessed: {
          sentry: { "sentry.issue.created": onCreated },
        },
      }),
    ).resolves.toEqual([
      {
        id: "signal_meta",
        role: "user",
        parts: [
          {
            type: "text",
            text: "sentry.issue.created|del_1|spi_1|trigger_1|sentry|Sentry",
          },
        ],
      },
    ]);
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it("falls back to the generic signal handler when no provider handler matches", async () => {
    const onSignal = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: `fallback:${signal.metadata?.signal_type}`,
        },
      ],
    }));
    const onIssueOpened = vi.fn(() => null);

    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_unknown_provider",
            role: "system",
            type: "signal",
            data: { anything: true },
            metadata: { signal_type: "linear.issue.created" },
          },
          {
            id: "signal_unknown_type",
            role: "system",
            type: "signal",
            data: { anything: true },
            metadata: { signal_type: "github.issue.deleted" },
          },
          {
            id: "signal_guard_failure",
            role: "system",
            type: "signal",
            data: { action: "opened" },
            metadata: { signal_type: "github.issue.opened" },
          },
          {
            id: "signal_no_provider_handler",
            role: "system",
            type: "signal",
            data: {
              action: "closed",
              repository: { full_name: "trytilde/openbot" },
              issue: { number: 7, title: "closed issue" },
            },
            metadata: { signal_type: "github.issue.closed" },
          },
        ],
        onUnprocessed: {
          github: { "github.issue.opened": onIssueOpened },
          signal: onSignal,
        },
      }),
    ).resolves.toEqual([
      {
        id: "signal_unknown_provider",
        role: "user",
        parts: [{ type: "text", text: "fallback:linear.issue.created" }],
      },
      {
        id: "signal_unknown_type",
        role: "user",
        parts: [{ type: "text", text: "fallback:github.issue.deleted" }],
      },
      {
        id: "signal_guard_failure",
        role: "user",
        parts: [{ type: "text", text: "fallback:github.issue.opened" }],
      },
      {
        id: "signal_no_provider_handler",
        role: "user",
        parts: [{ type: "text", text: "fallback:github.issue.closed" }],
      },
    ]);
    expect(onSignal).toHaveBeenCalledTimes(4);
    expect(onIssueOpened).not.toHaveBeenCalled();
  });

  it("prefers the provider handler over the generic signal fallback", async () => {
    const onSignal = vi.fn(() => null);
    const onCreated = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [{ type: "text" as const, text: signal.data.data.issue.title }],
    }));

    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_sentry",
            role: "system",
            type: "signal",
            data: {
              action: "created",
              data: { issue: { id: "1", title: "typed wins" } },
            },
            metadata: { signal_type: "sentry.issue.created" },
          },
        ],
        onUnprocessed: {
          sentry: { "sentry.issue.created": onCreated },
          signal: onSignal,
        },
      }),
    ).resolves.toEqual([
      {
        id: "signal_sentry",
        role: "user",
        parts: [{ type: "text", text: "typed wins" }],
      },
    ]);
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onSignal).not.toHaveBeenCalled();
  });

  it("drops signals when no handler at all is registered", async () => {
    await expect(
      convertToAiSdkMessages({
        messages: [
          {
            id: "signal_dropped",
            role: "system",
            type: "signal",
            data: { anything: true },
            metadata: { signal_type: "linear.issue.created" },
          },
          {
            id: "signal_slack_dropped",
            role: "system",
            type: "signal",
            data: { event: { type: "app_mention" } },
            metadata: { signal_type: "slack.app_mention" },
          },
        ],
        onUnprocessed: {},
      }),
    ).resolves.toEqual([]);
  });

  it("reuses a cached signal conversion without invoking onUnprocessed again", async () => {
    const cacheConvertedMessages = vi.fn(async () => ({ success: true }));
    const onCreated = vi.fn((signal) => ({
      id: signal.id,
      role: "user" as const,
      parts: [{ type: "text" as const, text: signal.data.data.issue.title }],
    }));
    const cached = {
      id: "signal_cached",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "cached conversion" }],
    };

    await expect(
      convertToAiSdkMessages({
        chatkit: {
          cacheConvertedMessages,
          hydrateConvertedMessages: vi.fn(async () => ({ messages: [] })),
        },
        messages: [
          {
            id: "signal_fresh",
            role: "system",
            type: "signal",
            data: {
              action: "created",
              data: { issue: { id: "1", title: "fresh conversion" } },
            },
            metadata: { signal_type: "sentry.issue.created" },
          },
          {
            id: "signal_cached",
            role: "system",
            type: "signal",
            data: {
              action: "created",
              data: { issue: { id: "2", title: "must not be converted" } },
            },
            metadata: { signal_type: "sentry.issue.created" },
            cached_agent_representation: cached,
          },
        ],
        onUnprocessed: {
          sentry: { "sentry.issue.created": onCreated },
        },
      }),
    ).resolves.toEqual([
      {
        id: "signal_fresh",
        role: "user",
        parts: [{ type: "text", text: "fresh conversion" }],
      },
      cached,
    ]);
    expect(onCreated).toHaveBeenCalledOnce();
    expect(cacheConvertedMessages).toHaveBeenCalledWith({
      messages: [
        {
          chatKitMessageId: "signal_fresh",
          message: {
            id: "signal_fresh",
            role: "user",
            parts: [{ type: "text", text: "fresh conversion" }],
          },
        },
      ],
    });
  });

  it("hydrates cached agent representations before converting raw parts", async () => {
    await expect(
      convertToAiSdkMessage({
        message: {
          id: "msg_cached",
          role: "user",
          type: "ui",
          parts: [],
          cached_agent_representation: {
            id: "msg_cached",
            role: "user",
            parts: [{ type: "text", text: "cached" }],
          },
        },
      }),
    ).resolves.toMatchObject({
      id: "msg_cached",
      role: "user",
      parts: [{ type: "text", text: "cached" }],
    });
  });
});
