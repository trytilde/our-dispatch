import { z } from "zod";
import { pageSchema, type Page } from "./common.js";

export const ChatPartSchema = z
  .object({
    type: z.string(),
    text: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    filename: z.string().nullable().optional(),
    media_type: z.string().optional(),
    mediaType: z.string().optional(),
    size_bytes: z.number().nullable().optional(),
    sizeBytes: z.number().nullable().optional(),
    url: z.string().optional(),
    attachment_id: z.string().nullable().optional(),
    attachmentId: z.string().nullable().optional(),
    tool_name: z.string().optional(),
    toolName: z.string().optional(),
    tool_invocation_id: z.string().optional(),
    toolCallId: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error_text: z.string().nullable().optional(),
    errorText: z.string().nullable().optional(),
    approval: z.unknown().optional(),
    title: z.string().nullable().optional(),
    source_id: z.string().optional(),
    data_type: z.string().optional(),
    data: z.unknown().optional(),
    provider_metadata: z.unknown().optional(),
  })
  .passthrough();
export type ChatPart = z.infer<typeof ChatPartSchema>;

export const ChatMessageSchema = z
  .object({
    id: z.string().min(1),
    type: z.string(),
    role: z.string(),
    session_id: z.string(),
    in_reply_to_message_id: z.string().nullable().optional(),
    in_reply_to_inbox_id: z.string().nullable().optional(),
    user_display_name: z.string().optional(),
    text: z.string().optional(),
    summary: z.string().nullable().optional(),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
    parts: z.array(ChatPartSchema).optional(),
    created_at: z.string(),
    updated_at: z.string().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatMessagePageSchema = pageSchema(ChatMessageSchema);
export type ChatMessagePage = Page<ChatMessage>;
