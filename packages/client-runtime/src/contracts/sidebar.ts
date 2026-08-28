import { z } from "zod";
import { pageSchema, type Page } from "./common.js";

export const ChatSessionSchema = z.object({
  id: z.string().min(1),
  lookup_key: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  authorization: z.unknown().optional(),
  ownership: z.unknown().optional(),
  unread: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  last_user_message_at: z.string().nullable().optional(),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

export const ChatAgentSchema = z.object({
  id: z.string().min(1),
  display_name: z.string(),
  provider_id: z.string(),
  status: z.string(),
  avatar_url: z.string().nullable().optional(),
  lookup_key: z.string().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  authorization: z.unknown().optional(),
  ownership: z.unknown().optional(),
  last_message_preview: z.string().nullable().optional(),
  last_user_message_at: z.string().nullable().optional(),
  sessions: pageSchema(ChatSessionSchema),
});
export type ChatAgent = z.infer<typeof ChatAgentSchema>;

export const SidebarResponseSchema = pageSchema(ChatAgentSchema);
export type SidebarResponse = Page<ChatAgent>;

export const ChatSessionPageSchema = pageSchema(ChatSessionSchema);
export type ChatSessionPage = Page<ChatSession>;

export type AgentSortOrder = "updated_at" | "created_at" | "manual";
export type SessionSortOrder = "updated_at" | "created_at";

const openBotUserSessionPrefix = "openbot:user:";

export function userSessionLookupKey(userId: string, agentId: string): string {
  return `${openBotUserSessionPrefix}${encodeURIComponent(userId)}:agent:${encodeURIComponent(agentId)}`;
}

export function userSessionForAgent(agent: ChatAgent, userId: string): ChatSession | undefined {
  const expectedKey = userSessionLookupKey(userId, agent.id);
  const exact = agent.sessions.items.find((session) => session.lookup_key === expectedKey);
  if (exact) return exact;

  // OpenBot historically exposed only the latest session for each bot. Keep that conversation as
  // the legacy default until any explicitly keyed OpenBot user session exists for this bot.
  const hasKeyedUserSession = agent.sessions.items.some((session) =>
    session.lookup_key?.startsWith(openBotUserSessionPrefix),
  );
  return hasKeyedUserSession ? undefined : agent.sessions.items[0];
}

export function agentConversationSessions(
  agent: ChatAgent,
  userId: string,
): { userSession?: ChatSession; threads: ChatSession[] } {
  const userSession = userSessionForAgent(agent, userId);
  return {
    ...(userSession ? { userSession } : {}),
    threads: agent.sessions.items
      .filter((session) => session.id !== userSession?.id)
      .toSorted(
        (left, right) =>
          Date.parse(right.last_user_message_at || right.updated_at) -
          Date.parse(left.last_user_message_at || left.updated_at),
      ),
  };
}
