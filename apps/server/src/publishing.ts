import { agentPublications, createDatabase, eq } from "@openbot/db";
import type { SourceControlProvider } from "@openbot/provider-sdk";
import { configuredProvider } from "./provider-registry.js";
import { loadRepository } from "./repository.js";
import { providerContext } from "./environment.js";

export interface PublishAgentInput {
  id: string;
  displayName: string;
  description?: string;
}

export async function publishAgent(input: PublishAgentInput, signal?: AbortSignal) {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(input.id)) throw new Error("Agent id must be 2-63 lowercase letters, numbers, or hyphens");
  if (!input.displayName.trim()) throw new Error("Agent display name is required");
  const repository = await loadRepository();
  if (repository.agents.some((agent) => agent.id === input.id)) throw new Error(`Agent already exists: ${input.id}`);
  const sourceControl = await configuredProvider<SourceControlProvider>("source-control");
  const publicationId = crypto.randomUUID();
  const branch = `openbot/agent-${input.id}-${publicationId.slice(0, 8)}`;
  const now = new Date();
  const db = createDatabase();
  await db.insert(agentPublications).values({ id: publicationId, agentId: input.id, status: "publishing", branch, createdAt: now, updatedAt: now });
  try {
    const result = await sourceControl.publishPullRequest({
      branch,
      baseBranch: repository.config.publishing.deploymentBranch,
      title: `Add ${input.displayName} agent`,
      body: `Adds the repository-owned \`${input.id}\` agent endpoint. Merge this pull request to deploy and register it.`,
      files: [{ path: `${repository.config.agents.directory}/${input.id}.ts`, content: agentSource(input) }],
    }, providerContext(publicationId, signal));
    await db.update(agentPublications).set({ status: result.status, pullRequestUrl: result.url.toString(), updatedAt: new Date() }).where(eq(agentPublications.id, publicationId));
    return { publicationId, agentId: input.id, branch, pullRequestUrl: result.url.toString(), status: result.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publishing failed";
    await db.update(agentPublications).set({ status: "failed", lastError: message, updatedAt: new Date() }).where(eq(agentPublications.id, publicationId));
    throw error;
  }
}

export async function getAgentPublication(id: string) {
  const [publication] = await createDatabase().select().from(agentPublications).where(eq(agentPublications.id, id));
  return publication;
}

export function agentSource(input: PublishAgentInput): string {
  const name = JSON.stringify(input.displayName.trim());
  const description = JSON.stringify(input.description?.trim() || `${input.displayName.trim()} OpenBot agent`);
  const suffix = input.id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const system = JSON.stringify(`You are ${input.displayName.trim()}. ${input.description?.trim() || "Be concise and helpful."}`);
  return `import { createOpenAI } from "@ai-sdk/openai";\nimport { chatKitEndpoint, convertToAiSdkMessages, createClient, createMCPClient } from "@trytilde/harness-sdk-vercel-ai-node";\nimport { consumeStream, convertToModelMessages, streamText } from "ai";\n\nexport const displayName = ${name};\nexport const description = ${description};\nexport const maxDuration = 300;\nexport const registration = { provider: "tilde-agents", streaming: true, timeoutMs: maxDuration * 1_000 } as const;\n\nfunction requiredEnv(name: string): string {\n  const value = process.env[name]?.trim();\n  if (!value) throw new Error(\`\${name} is required\`);\n  return value;\n}\n\nfunction createAgentHandler() {\n  const client = createClient({\n    apiKey: requiredEnv("OPENBOT_AGENT_${suffix}_API_KEY"),\n    baseUrl: process.env.TILDE_BASE_URL ?? "https://api.trytilde.ai",\n    orgId: requiredEnv("OPENBOT_TILDE_ORG_ID"),\n    orgSubdomain: false,\n    teamId: requiredEnv("OPENBOT_TILDE_TEAM_ID"),\n  });\n  const openai = createOpenAI({ apiKey: requiredEnv("OPENBOT_OPENAI_API_KEY") });\n  return chatKitEndpoint({\n    client,\n    webhookSigningKey: requiredEnv("OPENBOT_AGENT_${suffix}_WEBHOOK_SIGNING_KEY"),\n    requestTimeoutMs: 285_000,\n    async handler(request, context) {\n      const serverId = process.env.OPENBOT_TILDE_RUNTIME_MCP_SERVER_ID;\n      const runtime = serverId ? await createMCPClient({ client, serverId }) : undefined;\n      const close = async () => runtime?.closeMcp();\n      try {\n        const history = await context.session.history();\n        const messages = await convertToAiSdkMessages({ messages: [...history.items, ...context.messages], chatkit: context.chatkit });\n        const result = streamText({\n          abortSignal: request.signal,\n          messages: await convertToModelMessages(messages),\n          model: openai(process.env.OPENBOT_OPENAI_MODEL ?? "gpt-5.4"),\n          system: ${system},\n          tools: await runtime?.mcp.tools(),\n          onAbort: close,\n          onError: close,\n          onFinish: close,\n        });\n        return result.toUIMessageStreamResponse({ consumeSseStream: consumeStream, originalMessages: messages });\n      } catch (error) {\n        await close();\n        throw error;\n      }\n    },\n  });\n}\n\nexport async function POST(request: Request) {\n  return createAgentHandler()(request);\n}\n`;
}
