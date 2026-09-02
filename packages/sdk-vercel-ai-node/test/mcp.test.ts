import { createClient, MULTI_EXECUTE_TOOL_NAME } from "@trytilde/sdk";
import type { ToolExecutionOptions } from "ai";
import { jsonSchema, tool } from "ai";
import { describe, expect, it, vi } from "vite-plus/test";
import { createMCPClient } from "../src";

const mocks = vi.hoisted(() => {
  const remoteClient = {
    serverInfo: { name: "remote", version: "1.0.0" },
    tools: vi.fn(async () => ({
      REMOTE_SEARCH: { description: "Remote search" },
    })),
    callTool: vi.fn(async (name: string, input?: Record<string, unknown>) => ({
      name,
      input,
    })),
    close: vi.fn(async () => undefined),
  };

  return {
    remoteClient,
    createVercelMCPClient: vi.fn(async (_config: unknown) => remoteClient),
  };
});

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: mocks.createVercelMCPClient,
}));

function mockObservability(client: ReturnType<typeof createClient>) {
  const register = vi.spyOn(client.chatkit, "registerAgentTools").mockResolvedValue({});
  const report = vi.spyOn(client.chatkit, "reportToolExecution").mockResolvedValue({});
  return { register, report };
}

describe("createMCPClient", () => {
  it("creates a Vercel AI SDK MCP client using x-api-key auth", async () => {
    const client = createClient({
      baseUrl: "https://api.example.test",
      teamId: "team 123",
      apiKey: "tilde-key",
    });

    await createMCPClient({
      client,
      serverId: "server/1",
      headers: {
        "x-extra": "value",
      },
    });

    expect(mocks.createVercelMCPClient).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: {
          type: "http",
          url: "https://api.example.test/api/v1/team/team%20123/mcp/mcp-server/server%2F1/mcp",
          headers: {
            "x-extra": "value",
            "x-api-key": "tilde-key",
          },
          fetch: undefined,
        },
      }),
    );
    const config = mocks.createVercelMCPClient.mock.calls.at(-1)?.[0] as
      | { transport: { headers: Record<string, string> } }
      | undefined;
    expect(config?.transport).not.toMatchObject({
      headers: expect.objectContaining({
        Authorization: expect.any(String),
      }),
    });
  });

  it("forwards org context for a non-subdomain tunnel", async () => {
    const client = createClient({
      baseUrl: "https://example.ngrok-free.app",
      orgId: "org-example",
      orgSubdomain: false,
      teamId: "team_123",
      apiKey: "tilde-key",
    });

    await createMCPClient({
      client,
      serverId: "server_1",
    });

    const config = mocks.createVercelMCPClient.mock.calls.at(-1)?.[0] as
      | { transport: { headers: Record<string, string>; url: string } }
      | undefined;
    expect(config?.transport.url).toBe(
      "https://example.ngrok-free.app/api/v1/team/team_123/mcp/mcp-server/server_1/mcp",
    );
    expect(config?.transport.headers).toMatchObject({
      "x-api-key": "tilde-key",
      "x-tilde-org-id": "org-example",
    });
  });

  it("does not let arbitrary headers override the typed ChatKit session", async () => {
    const client = createClient({
      baseUrl: "https://api.example.test",
      teamId: "team_123",
      apiKey: "tilde-key",
    });

    await createMCPClient({
      client,
      serverId: "server_1",
      chatkit: { sessionId: "trusted-session" },
      headers: {
        "x-tilde-chatkit-session-id": "overridden-session",
      },
    });

    const config = mocks.createVercelMCPClient.mock.calls.at(-1)?.[0] as
      | { transport: { headers: Record<string, string> } }
      | undefined;
    expect(config?.transport.headers["x-tilde-chatkit-session-id"]).toBe("trusted-session");
  });

  it("adds trusted session-bound tools without requiring agent registration", async () => {
    const client = createClient({
      baseUrl: "https://api.example.test",
      teamId: "team_123",
      apiKey: "tilde-key",
    });
    const execute = vi.fn(async () => ({ queued: true }));
    const sendMessage = tool({
      description: "Send the bound reply",
      inputSchema: jsonSchema<{ content: string }>({
        type: "object",
        properties: { content: { type: "string" } },
        required: ["content"],
      }),
      execute,
    });

    const { mcp } = await createMCPClient({
      client,
      serverId: "server_1",
      chatkit: {
        sessionId: "session_1",
        boundTools: { sendMessage },
      },
    });

    await expect(mcp.callTool("sendMessage", { content: "hello" })).resolves.toEqual({
      queued: true,
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("registers provided AI SDK tools as local MCP tools", async () => {
    const client = createClient({
      baseUrl: "https://api.example.test",
      teamId: "team_123",
      apiKey: "tilde-key",
    });
    const observability = mockObservability(client);
    const execute = vi.fn(async (input: { value?: string }) => ({
      echoed: input.value,
    }));
    const example = tool({
      description: "Echo input",
      inputSchema: jsonSchema<{ value?: string }>({
        type: "object",
        properties: {
          value: { type: "string" },
        },
      }),
      execute,
    });

    const { mcp } = await createMCPClient({
      client,
      agentId: "agent_1",
      serverId: "server_1",
      chatkit: { sessionId: "session_1" },
      tools: {
        example,
      },
    });

    await expect(mcp.callTool("example", { value: "hello" })).resolves.toEqual({
      echoed: "hello",
    });
    await expect(mcp.callTool("example", { value: "again" })).resolves.toEqual({
      echoed: "again",
    });
    const calls = execute.mock.calls as unknown as Array<
      [input: { value?: string }, options: ToolExecutionOptions<unknown>]
    >;
    const firstOptions = calls[0]?.[1];
    const secondOptions = calls[1]?.[1];
    expect(firstOptions?.toolCallId).toMatch(/^tilde-sdk-execution-/);
    expect(secondOptions?.toolCallId).toMatch(/^tilde-sdk-execution-/);
    expect(firstOptions?.toolCallId).not.toBe(secondOptions?.toolCallId);
    await expect(mcp.tools()).resolves.toMatchObject({
      REMOTE_SEARCH: { description: "Remote search" },
      example: { description: "Echo input" },
    });
    expect(observability.register).toHaveBeenCalledWith({
      agentId: "agent_1",
      tools: expect.arrayContaining([
        expect.objectContaining({
          toolId: "tilde-sdk-local:server_1:example",
          wireName: "example",
          supportsSummary: false,
        }),
        expect.objectContaining({
          toolId: "tilde-sdk-local:server_1:MULTI_EXECUTE_TOOL",
          supportsSummary: true,
        }),
      ]),
    });
    expect(observability.report).toHaveBeenCalledTimes(4);
    expect(observability.report.mock.calls[0]?.[0]).toMatchObject({
      agentId: "agent_1",
      sessionId: "session_1",
      state: "started",
      toolId: "tilde-sdk-local:server_1:example",
      input: { value: "hello" },
    });
    expect(observability.report.mock.calls[1]?.[0]).toMatchObject({
      state: "completed",
      output: { echoed: "hello" },
    });
  });

  it("records local dynamic children with first-class parent and batch correlation", async () => {
    const client = createClient({
      baseUrl: "https://api.example.test",
      teamId: "team_123",
      apiKey: "tilde-key",
    });
    const observability = mockObservability(client);
    const example = tool({
      description: "Echo input",
      inputSchema: jsonSchema<{ value?: string }>({
        type: "object",
        properties: { value: { type: "string" } },
      }),
      execute: async (input) => ({ echoed: input.value }),
    });
    const { mcp } = await createMCPClient({
      client,
      agentId: "agent_1",
      serverId: "server_1",
      tools: { example },
    });

    await mcp.callTool(MULTI_EXECUTE_TOOL_NAME, {
      invocations: [{ tool_name: "example", parameters: { value: "batched" } }],
    });

    const events = observability.report.mock.calls.map(([event]) => event);
    const wrapper = events.find(
      (event) => event.wireName === MULTI_EXECUTE_TOOL_NAME && event.state === "started",
    );
    const child = events.find((event) => event.wireName === "example" && event.state === "started");
    expect(wrapper?.batchId).toBeDefined();
    expect(child).toMatchObject({
      parentExecutionId: wrapper?.executionId,
      batchId: wrapper?.batchId,
      batchIndex: 0,
    });
  });

  it("requires agentId when local tools are provided", async () => {
    const client = createClient({
      baseUrl: "https://api.example.test",
      teamId: "team_123",
      apiKey: "tilde-key",
    });
    const example = tool({
      description: "Echo input",
      inputSchema: jsonSchema({ type: "object" }),
      execute: async () => ({ ok: true }),
    });

    await expect(
      createMCPClient({ client, serverId: "server_1", tools: { example } }),
    ).rejects.toThrow("agentId");
  });

  it("closes the remote MCP client when tool registration fails", async () => {
    mocks.remoteClient.close.mockClear();
    const client = createClient({
      baseUrl: "https://api.example.test",
      teamId: "team_123",
      apiKey: "tilde-key",
    });
    vi.spyOn(client.chatkit, "registerAgentTools").mockRejectedValue(
      new Error("registration unavailable"),
    );

    await expect(
      createMCPClient({ client, agentId: "agent_1", serverId: "server_1" }),
    ).rejects.toThrow("registration unavailable");
    expect(mocks.remoteClient.close).toHaveBeenCalledOnce();
  });

  it("requires an apiKey on the core client", async () => {
    const client = createClient({
      baseUrl: "https://api.example.test",
      teamId: "team_123",
      bearerToken: "tilde-bearer",
    });

    await expect(
      createMCPClient({
        client,
        serverId: "server_1",
      }),
    ).rejects.toThrow("apiKey");
  });

  it("closes the MCP client at most once", async () => {
    mocks.remoteClient.close.mockClear();
    const client = createClient({
      baseUrl: "https://api.example.test",
      teamId: "team_123",
      apiKey: "tilde-key",
    });
    const { closeMcp } = await createMCPClient({
      client,
      serverId: "server_1",
    });

    await closeMcp();
    await closeMcp();

    expect(mocks.remoteClient.close).toHaveBeenCalledOnce();
  });
});
