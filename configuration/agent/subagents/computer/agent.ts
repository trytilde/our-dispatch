import { configHeaders } from "@trytilde/sdk";
import {
  chatKitEndpoint,
  convertToAiSdkMessages,
  createClient,
} from "@trytilde/sdk-vercel-ai-node";
import {
  createTildeAttachmentMessageHandlers,
  createCuaTools,
  createTildeMediaUploader,
} from "@tryopenbot/computer-tools";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import type { ToolSet } from "@ai-sdk/provider-utils";
import { prepareInference } from "./inference.js";
import instructions from "./instructions.js";

const agentApiKey = process.env.AGENT_COMPUTER_API_KEY!;

const client = createClient({
  apiKey: agentApiKey,
  orgId: process.env.TILDE_ORG_ID!,
  orgSubdomain: false,
  teamId: process.env.TILDE_TEAM_ID!,
});
async function localTools(sessionId: string, displayAgentId: string): Promise<ToolSet> {
  const uploadMedia = createTildeMediaUploader({
    baseUrl: client.config.baseUrl,
    headers: () => configHeaders(client.config),
    sessionId,
    teamId: process.env.TILDE_TEAM_ID!,
  });
  return await createCuaTools({
    agentId: displayAgentId,
    uploadMedia,
  });
}

function queuedRequestCutoff(messages: readonly { metadata?: unknown }[]): string | undefined {
  return messages
    .map((message) => {
      if (typeof message.metadata !== "object" || message.metadata === null) return undefined;
      const metadata = message.metadata as Record<string, unknown>;
      const value = metadata.createdAt ?? metadata.created_at;
      return typeof value === "string" ? value : undefined;
    })
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

export default chatKitEndpoint({
  client,
  responseMode: "agentLoop",
  webhookSigningKey: process.env.AGENT_COMPUTER_WEBHOOK_SIGNING_KEY!,
  requestTimeoutMs: 285_000,
  async handler(request, context) {
    const history = await context.session.history();
    const cutoff = queuedRequestCutoff(context.messages);
    const requestHistory = cutoff
      ? history.items.filter((message) => !message.created_at || message.created_at <= cutoff)
      : history.items;
    const attachmentHandlers = createTildeAttachmentMessageHandlers(client, context);
    const messages = await convertToAiSdkMessages({
      messages: [...requestHistory, ...context.messages],
      chatkit: context.chatkit,
      onUnprocessed: {
        fileUpload: attachmentHandlers.fileUpload,
      },
      onCacheMessage: attachmentHandlers.onCacheMessage,
      onHydrateMessage: attachmentHandlers.onHydrateMessage,
    });
    const displayAgentId = context.body.session?.parentAgentId ?? "computer";
    const tools = await localTools(context.sessionId, displayAgentId);
    const inference = await prepareInference(tools, request.signal);
    const result = streamText({
      ...inference,
      allowSystemInMessages: true,
      abortSignal: request.signal,
      instructions,
      messages: await convertToModelMessages(messages),
      stopWhen: stepCountIs(20),
    });
    return result.toUIMessageStreamResponse({
      originalMessages: messages,
    });
  },
});
