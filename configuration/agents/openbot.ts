import { createOpenAI } from "@ai-sdk/openai";
import { chatKitEndpoint, convertToAiSdkMessages, createClient, createMCPClient } from "@trytilde/harness-sdk-vercel-ai-node";
import { consumeStream, convertToModelMessages, stepCountIs, streamText } from "ai";

export const displayName = "OpenBot";
export const description = "The default general-purpose OpenBot agent.";
export const maxDuration = 300;
export const registration = { provider: "tilde-agents", streaming: true, timeoutMs: maxDuration * 1_000 } as const;

function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`${names.join(" or ")} is required`);
}

function createAgentHandler() {
  const client = createClient({
    apiKey: requiredEnv("OPENBOT_AGENT_OPENBOT_API_KEY", "OPENBOT_TILDE_API_KEY"),
    baseUrl: process.env.TILDE_BASE_URL ?? "https://api.trytilde.ai",
    orgId: requiredEnv("OPENBOT_TILDE_ORG_ID"),
    orgSubdomain: false,
    teamId: requiredEnv("OPENBOT_TILDE_TEAM_ID"),
  });
  const openai = createOpenAI({ apiKey: requiredEnv("OPENBOT_OPENAI_API_KEY") });

  return chatKitEndpoint({
    client,
    webhookSigningKey: requiredEnv("OPENBOT_AGENT_OPENBOT_WEBHOOK_SIGNING_KEY", "OPENBOT_TILDE_WEBHOOK_SIGNING_KEY"),
    requestTimeoutMs: 285_000,
    async handler(request, context) {
      const serverId = process.env.OPENBOT_TILDE_RUNTIME_MCP_SERVER_ID;
      const runtime = serverId ? await createMCPClient({ client, serverId }) : undefined;
      const close = async () => runtime?.closeMcp();
      try {
        const history = await context.session.history();
        const messages = await convertToAiSdkMessages({
          messages: [...history.items, ...context.messages],
          chatkit: context.chatkit,
        });
        const result = streamText({
          abortSignal: request.signal,
          messages: await convertToModelMessages(messages),
          model: openai(process.env.OPENBOT_OPENAI_MODEL ?? "gpt-5.4"),
          stopWhen: stepCountIs(12),
          system: "You are OpenBot, a concise and capable assistant. Explain actions before using a computer or external tool.",
          tools: await runtime?.mcp.tools(),
          onAbort: close,
          onError: close,
          onFinish: close,
        });
        return result.toUIMessageStreamResponse({ consumeSseStream: consumeStream, originalMessages: messages });
      } catch (error) {
        await close();
        throw error;
      }
    },
  });
}

export async function POST(request: Request) {
  return createAgentHandler()(request);
}
