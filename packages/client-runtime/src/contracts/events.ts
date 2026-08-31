import { z } from "zod";
import { ChatMessageSchema } from "./messages.js";
import { QueuedTurnSchema } from "./queue.js";

const AuthorizationSchema = z.object({
  visibility: z.enum(["team", "private"]),
  ownership: z.enum(["team", "private"]),
});

const OwnershipSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("team"), org_id: z.string(), team_id: z.string() }),
  z.object({ type: z.literal("user"), org_id: z.string(), user_id: z.string() }),
  z.object({
    type: z.literal("user_team"),
    org_id: z.string(),
    team_id: z.string(),
    user_id: z.string(),
  }),
]);

export const RealtimeAgentSchema = z.object({
  id: z.string().min(1),
  display_name: z.string(),
  provider_id: z.string(),
  status: z.string(),
  lookup_key: z.string().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  authorization: AuthorizationSchema,
  ownership: OwnershipSchema,
  created_by_user_id: z.string().nullable().optional(),
  avatar_url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RealtimeAgent = z.infer<typeof RealtimeAgentSchema>;

export const RealtimeSessionSchema = z.object({
  id: z.string().min(1),
  authorization: AuthorizationSchema,
  ownership: OwnershipSchema,
  created_by_user_id: z.string().nullable().optional(),
  parent_session_id: z.string().nullable().optional(),
  lookup_key: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RealtimeSession = z.infer<typeof RealtimeSessionSchema>;

export const SessionUserStateSchema = z.object({
  session_id: z.string().min(1),
  user_id: z.string().min(1),
  last_read_at: z.string().nullable().optional(),
  unread: z.boolean(),
  updated_at: z.string(),
});
export type SessionUserState = z.infer<typeof SessionUserStateSchema>;

const baseEvent = {
  id: z.string().min(1),
  occurred_at: z.string(),
};

export const ParticipantIdentitySchema = z.object({
  participant_handle: z.string().min(1),
  participant_type: z.enum(["human", "agent"]),
  membership_source: z.enum(["explicit", "provider", "recipient"]),
  inbox_id: z.string().min(1),
  inbox_instance_id: z.string().min(1),
  display_name: z.string(),
  external_id: z.string().nullable().optional(),
});
export type ParticipantIdentity = z.infer<typeof ParticipantIdentitySchema>;

const ParticipantJoinedEventSchema = z.object({
  ...baseEvent,
  type: z.literal("participant.joined"),
  data: z.object({ session_id: z.string(), participant: ParticipantIdentitySchema }),
});
const ParticipantLeftEventSchema = z.object({
  ...baseEvent,
  type: z.literal("participant.left"),
  data: z.object({ session_id: z.string(), participant: ParticipantIdentitySchema }),
});
export const ParticipantEventSchema = z.discriminatedUnion("type", [
  ParticipantJoinedEventSchema,
  ParticipantLeftEventSchema,
]);
export type ParticipantEvent = z.infer<typeof ParticipantEventSchema>;

export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({ ...baseEvent, type: z.literal("access.changed") }),
  z.object({
    ...baseEvent,
    type: z.literal("agent.created"),
    data: z.object({ agent: RealtimeAgentSchema }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("agent.updated"),
    data: z.object({ agent: RealtimeAgentSchema }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("agent.deleted"),
    data: z.object({ agent_id: z.string() }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("session.created"),
    data: z.object({ session: RealtimeSessionSchema }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("session.updated"),
    data: z.object({ session: RealtimeSessionSchema }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("session.deleted"),
    data: z.object({ session_id: z.string() }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("session.access.updated"),
    data: z.object({
      session_id: z.string(),
      changed_user_id: z.string(),
      change: z.enum(["added", "removed"]),
    }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("session.user_state.updated"),
    data: z.object({ state: SessionUserStateSchema }),
  }),
  ParticipantJoinedEventSchema,
  ParticipantLeftEventSchema,
  z.object({
    ...baseEvent,
    type: z.literal("session.child.created"),
    data: z.object({ parent_session_id: z.string(), session: RealtimeSessionSchema }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("message.created"),
    data: z.object({ message: ChatMessageSchema }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("message.updated"),
    data: z.object({ message: ChatMessageSchema }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("message.deleted"),
    data: z.object({ message_id: z.string() }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("message.delta"),
    data: z.object({
      message_id: z.string(),
      session_id: z.string(),
      part_id: z.string(),
      sequence: z.number().int(),
      delta: z.unknown(),
    }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("queue_item.enqueued"),
    data: z.object({ queue_item: QueuedTurnSchema }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("queue_item.dequeued"),
    data: z.object({ queue_item: QueuedTurnSchema }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("queue_item.updated"),
    data: z.object({ queue_item: QueuedTurnSchema, change: z.enum(["batched", "reordered"]) }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("queue_item.removed"),
    data: z.object({ queue_item: QueuedTurnSchema }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("turn.started"),
    data: z.object({ turn_id: z.string(), session_id: z.string(), agent_id: z.string() }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("turn.completed"),
    data: z.object({ turn_id: z.string(), session_id: z.string(), agent_id: z.string() }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("turn.failed"),
    data: z.object({
      turn_id: z.string(),
      session_id: z.string(),
      agent_id: z.string(),
      message: z.string(),
    }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("turn.interrupted"),
    data: z.object({ turn_id: z.string(), session_id: z.string(), agent_id: z.string() }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("activity.typing.started"),
    data: z.object({ session_id: z.string(), inbox_instance_id: z.string() }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("activity.typing.stopped"),
    data: z.object({ session_id: z.string(), inbox_instance_id: z.string() }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("task.created"),
    data: z.object({ task: z.unknown() }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("task.updated"),
    data: z.object({ update: z.unknown() }),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("chat.error"),
    data: z.object({
      session_id: z.string(),
      code: z.string(),
      message: z.string(),
      message_id: z.string().nullable().optional(),
    }),
  }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export type ActivityEvent = ChatEvent & { receivedAt: Date };

/** Generic envelope retained for one-session SSE provider streams. */
export const SessionEventSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  data: z.unknown(),
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;
