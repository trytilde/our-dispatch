import { randomUUID } from "node:crypto";
import {
  createMCPClient as createVercelMCPClient,
  type MCPClient,
  type MCPClientConfig,
} from "@ai-sdk/mcp";
import type { Client, JsonObject, LocalMcpTool, ToolRegistry, ToolResult } from "@trytilde/sdk";
import { configHeaders, wrapMcpClientWithLocalTools } from "@trytilde/sdk";
import { isJsonObject } from "@trytilde/sdk/json";
import type { ToolExecutionOptions, ToolSet } from "ai";

/**
 * What an agent may do inside the ChatKit session its connection is scoped to.
 *
 * These are *narrowing hints*, not grants. The runtime supplies them, so they
 * cannot be the authority — otherwise an agent would widen its own reach by
 * editing its own client options. Tilde intersects every entry with the
 * caller's real grants, so `true` means "anything this agent already has
 * visibility on", never "anything in the team".
 */
export type ChatKitSessionPermissions = {
  /**
   * Allow delegating to other agents by opening a child session.
   *
   * `true` permits any agent this one can already see; a list is intended to
   * narrow that further to the named agent inbox ids.
   *
   * Today Tilde enforces delegation with a visibility check on the target
   * agent, which is the actual authority. The list narrowing is sent but not
   * yet applied server-side, so treat it as a declaration of intent rather
   * than a control.
   */
  delegateToOtherAgents?: true | string[];
  /**
   * Allow the agent to create a multi-party session and choose who is in it.
   *
   * Declared now and not yet implemented server-side: agent-initiated
   * membership is deliberately out of the first release, so every roster is one
   * a human chose. Passing it today is accepted and ignored.
   */
  createMultiplayerSessions?: {
    withAgents?: true | string[];
    withUsers?: true | string[];
  };
};

/**
 * Scopes an MCP connection to one ChatKit session.
 *
 * A scoped connection is offered extra tools by Tilde:
 *
 * - `chatkit_list_agents` — agents this agent may delegate to
 * - `chatkit_delegate` — ask one of them to do something, in a private child
 *   conversation off the current session
 * - `chatkit_wait_for_response` — wait for that reply
 * - `chatkit_list_participants` — who is in the current conversation
 *
 * None of them take a session id: the session comes from this connection, so a
 * conversation the caller was not authorized for cannot be addressed. Reaching
 * a new agent needs no setup — it appears in `chatkit_list_agents` as soon as
 * this agent has visibility on it.
 */
export type ChatKitConnectionOptions = {
  /**
   * Session this connection acts inside.
   *
   * Tilde validates it against the caller and rejects the connection if the
   * caller may not use it, rather than quietly omitting the session tools.
   */
  sessionId: string;
  permissions?: ChatKitSessionPermissions;
  /** Session-bound tools created from trusted ChatKit endpoint context. */
  boundTools?: ToolSet;
};

export type CreateMCPClientOptions<TTools extends ToolSet = ToolSet> = Omit<
  MCPClientConfig,
  "transport"
> & {
  client: Client;
  /** ChatKit agent that owns this MCP connection and its process-local tools. */
  agentId?: string;
  serverId: string;
  tools?: TTools;
  headers?: Record<string, string>;
  /**
   * Scope this connection to a ChatKit session.
   *
   * Session-scoped tools — delegation among them — are only offered when this
   * is present, because they read the session from the connection instead of
   * taking it as a tool parameter.
   */
  chatkit?: ChatKitConnectionOptions;
};

/** Header carrying the ChatKit session id. Mirrors `CHATKIT_SESSION_HEADER`. */
const CHATKIT_SESSION_HEADER = "x-tilde-chatkit-session-id";

/** Header carrying the requested, server-narrowed session permissions. */
const CHATKIT_PERMISSIONS_HEADER = "x-tilde-chatkit-permissions";

/**
 * Build the ChatKit scoping headers for a connection.
 *
 * Exported for tests and for runtimes that construct their own transport.
 */
export function chatkitConnectionHeaders(
  chatkit: ChatKitConnectionOptions | undefined,
): Record<string, string> {
  if (!chatkit) return {};
  const sessionId = chatkit.sessionId.trim();
  if (sessionId.length === 0) {
    throw new TypeError("createMCPClient chatkit.sessionId must not be empty");
  }
  const headers: Record<string, string> = { [CHATKIT_SESSION_HEADER]: sessionId };
  if (chatkit.permissions) {
    headers[CHATKIT_PERMISSIONS_HEADER] = JSON.stringify(chatkit.permissions);
  }
  return headers;
}

export type TildeMCPClient<TTools extends ToolSet = ToolSet> = Omit<MCPClient, "tools"> & {
  readonly serverId: string;
  readonly localTools: readonly LocalMcpTool[];
  callTool<TResult extends ToolResult = ToolResult>(
    name: string,
    input?: JsonObject,
  ): Promise<TResult>;
  tools(): Promise<ToolRegistry & TTools>;
};

export type TildeMCPClientHandle<TTools extends ToolSet = ToolSet> = {
  mcp: TildeMCPClient<TTools>;
  closeMcp(): Promise<void>;
};

export async function createMCPClient<TTools extends ToolSet = ToolSet>(
  options: CreateMCPClientOptions<TTools>,
): Promise<TildeMCPClientHandle<TTools>> {
  const apiKey = options.client.config.apiKey;
  if (!apiKey) {
    throw new TypeError("createMCPClient requires client config apiKey");
  }
  const localToolSet = options.tools ?? ({} as TTools);
  const boundToolSet = options.chatkit?.boundTools ?? {};
  const hasLocalTools = Object.keys(localToolSet).length > 0;
  const agentId = options.agentId?.trim();
  if (hasLocalTools && !agentId) {
    throw new TypeError("createMCPClient requires agentId when tools are provided");
  }

  const clientHeaders = Object.fromEntries(configHeaders(options.client.config).entries());
  delete clientHeaders.authorization;
  const remoteClient = await createVercelMCPClient({
    ...options,
    transport: {
      type: "http",
      url: options.client.mcp.getServerUrl({ id: options.serverId }),
      headers: {
        ...clientHeaders,
        ...chatkitConnectionHeaders(options.chatkit),
        ...options.headers,
        "x-api-key": apiKey,
      },
      ...(options.client.config.fetch ? { fetch: options.client.config.fetch } : {}),
    },
  });

  const authoredLocalTools = toLocalTools(
    localToolSet,
    options.client,
    agentId ?? "",
    options.serverId,
    options.chatkit?.sessionId,
  );
  const boundLocalTools = toUnobservedLocalTools(boundToolSet);
  const localTools = [...boundLocalTools, ...authoredLocalTools];
  try {
    if (agentId) {
      await options.client.chatkit.registerAgentTools({
        agentId,
        tools: [
          ...authoredLocalTools.map((tool) => ({
            toolId: localToolId(options.serverId, tool.name),
            wireName: tool.name,
            displayName: tool.name,
            supportsSummary: false,
            identity: {
              mcpServerId: options.serverId,
              inputSchema: tool.inputSchema,
              ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
            },
          })),
          ...(hasLocalTools
            ? [
                {
                  toolId: localToolId(options.serverId, "MULTI_EXECUTE_TOOL"),
                  wireName: "MULTI_EXECUTE_TOOL",
                  displayName: "Execute multiple tools",
                  supportsSummary: true,
                  summary: "Executed a batch of tools",
                  identity: {
                    mcpServerId: options.serverId,
                    dynamicWrapper: true,
                  },
                },
              ]
            : []),
        ],
      });
    }
  } catch (error) {
    await remoteClient.close();
    throw error;
  }

  const mcp = wrapMcpClientWithLocalTools({
    client: remoteClient,
    serverId: options.serverId,
    tools: localTools,
    ...(agentId && hasLocalTools
      ? {
          observeMultiExecute: async (event) => {
            await options.client.chatkit.reportToolExecution({
              agentId,
              executionId: event.executionId,
              batchId: event.batchId,
              ...(options.chatkit?.sessionId ? { sessionId: options.chatkit.sessionId } : {}),
              toolId: localToolId(options.serverId, "MULTI_EXECUTE_TOOL"),
              wireName: "MULTI_EXECUTE_TOOL",
              state: event.state,
              input: event.input,
              ...(event.output ? { output: event.output } : {}),
              ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
              summary: "Executed a batch of tools",
            });
          },
        }
      : {}),
  }) as TildeMCPClient<TTools>;
  let mcpClosed = false;
  const closeMcp = async () => {
    if (mcpClosed) return;
    mcpClosed = true;
    await mcp.close();
  };
  return { mcp, closeMcp };
}

function toUnobservedLocalTools(tools: ToolSet): LocalMcpTool[] {
  return Object.entries(tools).map(([name, value]) => {
    const tool = value as unknown as ExecutableToolLike;
    if (typeof tool.execute !== "function") {
      throw new TypeError(`Session-bound MCP tool requires execute: ${name}`);
    }
    const execute = tool.execute;
    const localTool: LocalMcpTool = {
      name,
      description: tool.description ?? name,
      inputSchema: jsonSchemaObject(tool.inputSchema),
      async execute(input) {
        return (await execute(input, {
          toolCallId: `${name}-${randomUUID()}`,
          messages: [],
          abortSignal: new AbortController().signal,
          context: undefined,
        })) as ToolResult;
      },
    };
    if (tool.outputSchema !== undefined) {
      localTool.outputSchema = jsonSchemaObject(tool.outputSchema);
    }
    return localTool;
  });
}

function toLocalTools(
  tools: ToolSet,
  client: Client,
  agentId: string,
  serverId: string,
  sessionId?: string,
): LocalMcpTool[] {
  return Object.entries(tools).map(([name, tool]) =>
    toLocalTool(name, tool, client, agentId, serverId, sessionId),
  );
}

type ExecutableToolLike = {
  description?: string;
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
  execute?: (
    input: JsonObject,
    options: ToolExecutionOptions<unknown>,
  ) => ToolResult | Promise<ToolResult>;
};

function toLocalTool(
  name: string,
  value: ToolSet[string],
  client: Client,
  agentId: string,
  serverId: string,
  sessionId?: string,
): LocalMcpTool {
  const tool = value as unknown as ExecutableToolLike;
  if (typeof tool.execute !== "function") {
    throw new TypeError(`Local MCP tool requires execute: ${name}`);
  }
  const execute = tool.execute;
  const localTool: LocalMcpTool = {
    name,
    description: tool.description ?? name,
    inputSchema: jsonSchemaObject(tool.inputSchema),
    async execute(input, localContext) {
      const executionId = `tilde-sdk-execution-${randomUUID()}`;
      const toolId = localToolId(serverId, name);
      const correlation = localContext.execution
        ? {
            parentExecutionId: localContext.execution.parentExecutionId,
            batchId: localContext.execution.batchId,
            batchIndex: localContext.execution.batchIndex,
          }
        : {};
      const session = sessionId ? { sessionId } : {};
      await client.chatkit.reportToolExecution({
        agentId,
        executionId,
        ...session,
        toolId,
        wireName: name,
        state: "started",
        input,
        ...correlation,
      });
      try {
        const output = (await execute(input, {
          toolCallId: executionId,
          messages: [],
          abortSignal: new AbortController().signal,
          context: undefined,
        })) as ToolResult;
        await client.chatkit.reportToolExecution({
          agentId,
          executionId,
          ...session,
          toolId,
          wireName: name,
          state: "completed",
          input,
          ...(output === undefined ? {} : { output }),
          ...correlation,
        });
        return output;
      } catch (error) {
        await client.chatkit.reportToolExecution({
          agentId,
          executionId,
          ...session,
          toolId,
          wireName: name,
          state: "failed",
          input,
          errorMessage: error instanceof Error ? error.message : String(error),
          ...correlation,
        });
        throw error;
      }
    },
  };
  if (tool.outputSchema !== undefined) {
    localTool.outputSchema = jsonSchemaObject(tool.outputSchema);
  }
  return localTool;
}

function localToolId(serverId: string, name: string): string {
  return `tilde-sdk-local:${serverId}:${name}`;
}

function jsonSchemaObject(schema: JsonObject | undefined): JsonObject {
  return schema && isJsonObject(schema) ? schema : { type: "object" };
}
