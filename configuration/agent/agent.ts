import { configHeaders } from "@trytilde/harness-sdk";
import {
  chatKitEndpoint,
  convertToAiSdkMessages,
  createChatKitAttachmentFilePartHandler,
  createClient,
  createMCPClient,
} from "@trytilde/harness-sdk-vercel-ai-node";
import { createTildeMediaUploader } from "@tryopenbot/computer-tools";
import { consumeStream, convertToModelMessages, stepCountIs, streamText, type ToolSet } from "ai";
import instructions from "./instructions.js";
import awaitShell from "./tools/await_shell.js";
import bash from "./tools/bash.js";
import configureConnector from "./tools/configure_connector.js";
import copyFromComputer from "./tools/copy_from_computer.js";
import copyToComputer from "./tools/copy_to_computer.js";
import glob from "./tools/glob.js";
import grep from "./tools/grep.js";
import readFile from "./tools/read_file.js";
import screenshot from "./tools/screenshot.js";
import writeFile from "./tools/write_file.js";

const agentApiKey = process.env.AGENT_FACTORY_API_KEY!;
const mcpServerId = process.env.AGENT_FACTORY_MCP_SERVER_ID!;

const client = createClient({
  apiKey: agentApiKey,
  orgId: process.env.TILDE_ORG_ID!,
  orgSubdomain: false,
  teamId: process.env.TILDE_TEAM_ID!,
});
function localTools(sessionId: string): ToolSet {
  // Media tools upload through Tilde's session-scoped attachment routes, so the tool set is bound
  // to the turn's session rather than shared across the process.
  const uploadMedia = createTildeMediaUploader({
    baseUrl: client.config.baseUrl,
    headers: () => configHeaders(client.config),
    sessionId,
    teamId: process.env.TILDE_TEAM_ID!,
  });
  return {
    await_shell: awaitShell,
    bash,
    configure_connector: configureConnector,
    copy_from_computer: copyFromComputer,
    copy_to_computer: copyToComputer,
    glob,
    grep,
    read_file: readFile,
    screenshot: screenshot(uploadMedia),
    write_file: writeFile,
  } satisfies ToolSet;
}

/**
 * The MCP client binds its local tools at construction, so a session-bound tool set means one
 * client per turn. `closeMcp` runs when the stream finishes.
 */
async function managedMcpTools(
  sessionId: string,
): Promise<{ tools: ToolSet; closeMcp: () => Promise<void> }> {
  const { mcp, closeMcp } = await createMCPClient({
    client,
    serverId: mcpServerId,
    tools: localTools(sessionId),
  });
  // The Tilde wrapper preserves AI SDK tools but exposes a transport-neutral registry type.
  const tools: Record<string, unknown> = await mcp.tools();
  assertToolSet(tools);
  return { tools, closeMcp };
}

function assertToolSet(tools: Record<string, unknown>): asserts tools is ToolSet {
  for (const [name, definition] of Object.entries(tools))
    if (typeof definition !== "object" || definition === null || !("inputSchema" in definition))
      throw new TypeError(`MCP tool ${name} is not a Vercel AI SDK tool`);
}

function fetchAttachment(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(
    input instanceof Request ? input.url : input.toString(),
    client.config.baseUrl,
  );
  if (url.origin === new URL(client.config.baseUrl).origin) return fetch(input, init);

  const headers = new Headers(init?.headers);
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.delete("x-tilde-org-id");
  headers.delete("x-tilde-team-id");
  return fetch(input, { ...init, headers });
}

export default chatKitEndpoint({
  client,
  webhookSigningKey: process.env.AGENT_FACTORY_WEBHOOK_SIGNING_KEY!,
  requestTimeoutMs: 285_000,
  async handler(request, context) {
    const history = await context.session.history();
    const messages = await convertToAiSdkMessages({
      messages: [...history.items, ...context.messages],
      chatkit: context.chatkit,
      onUnprocessed: {
        fileUpload: createChatKitAttachmentFilePartHandler(client, context, {
          fetch: fetchAttachment,
        }),
      },
    });
    const { tools, closeMcp } = await managedMcpTools(context.sessionId);
    const result = streamText({
      abortSignal: request.signal,
      messages: await convertToModelMessages(messages),
      model: process.env.AI_MODEL ?? "openai/gpt-5.6-sol",
      onFinish: () => void closeMcp(),
      providerOptions: { openai: { reasoningEffort: "medium" } },
      // Connector configuration workflows chain discovery, schema fetches, and
      // control-plane mutations in one turn, so the step budget must cover them.
      stopWhen: stepCountIs(24),
      system: instructions,
      tools,
    });
    return result.toUIMessageStreamResponse({
      consumeSseStream: consumeStream,
      originalMessages: messages,
    });
  },
});
