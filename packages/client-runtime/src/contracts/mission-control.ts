import { z } from "zod";
import { pageSchema } from "./common.js";
import { ChatMessagePageSchema, ChatMessageSchema } from "./messages.js";
import { QueuedTurnPageSchema } from "./queue.js";
import { ChatSessionSchema, SidebarResponseSchema } from "./sidebar.js";

export const ConversationSnapshotSchema = z.object({
  messages: ChatMessagePageSchema,
  queued_turns: QueuedTurnPageSchema,
  snapshot_revision: z.number(),
});
export type ConversationSnapshot = z.infer<typeof ConversationSnapshotSchema>;

export const MissionControlBootstrapSchema = z.object({
  sidebar: SidebarResponseSchema,
  active_session_id: z.string().optional(),
  active_conversation: ConversationSnapshotSchema.optional(),
});
export type MissionControlBootstrap = z.infer<typeof MissionControlBootstrapSchema>;

export const SubmitTurnResponseSchema = z.object({
  session: ChatSessionSchema,
  conversation: ConversationSnapshotSchema,
});
export type SubmitTurnResponse = z.infer<typeof SubmitTurnResponseSchema>;

export const ChatKitSearchHitKindSchema = z.enum(["session_title", "agent", "message"]);
export type ChatKitSearchHitKind = z.infer<typeof ChatKitSearchHitKindSchema>;

export const ChatKitSearchSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ChatKitSearchAgentSchema = z.object({
  id: z.string().min(1),
  display_name: z.string(),
});

export const ChatKitSearchHitSchema = z.object({
  kind: ChatKitSearchHitKindSchema,
  session: ChatKitSearchSessionSchema,
  agent: ChatKitSearchAgentSchema.nullable().optional(),
  message: ChatMessageSchema.nullable().optional(),
});
export type ChatKitSearchHit = z.infer<typeof ChatKitSearchHitSchema>;

export const ChatKitSearchPageSchema = pageSchema(ChatKitSearchHitSchema);
export type ChatKitSearchPage = z.infer<typeof ChatKitSearchPageSchema>;

export interface AttachmentCompletion {
  attachmentId: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface SubmitTurnInput {
  sessionId?: string;
  title?: string;
  text: string;
  attachments?: AttachmentCompletion[];
}
