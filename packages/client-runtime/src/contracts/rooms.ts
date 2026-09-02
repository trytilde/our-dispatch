import { z } from "zod";

export const RoomParticipantSchema = z.object({
  participant_type: z.enum(["human", "agent"]),
  participant_handle: z.string(),
  membership_source: z.enum(["explicit", "invitation", "provider", "recipient"]),
  role: z.enum(["owner", "admin", "member"]),
  principal_user_id: z.string().nullish(),
  joined_at: z.string(),
  instance: z.record(z.string(), z.unknown()),
  inbox: z.record(z.string(), z.unknown()),
});
export type RoomParticipant = z.infer<typeof RoomParticipantSchema>;

export const RoomInvitationSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  org_id: z.string(),
  team_id: z.string(),
  invitee_user_id: z.string(),
  invited_by_user_id: z.string(),
  role: z.enum(["admin", "member"]),
  participant: z.object({
    participant_type: z.enum(["human", "agent"]),
    inbox_id: z.string(),
    instance_id: z.string().optional(),
    display_name: z.string(),
    external_id: z.string().optional(),
    default_to_participant_instance_id: z.string().optional(),
  }),
  status: z.enum(["pending", "accepted", "declined", "revoked"]),
  created_at: z.string(),
  updated_at: z.string(),
});
export const RoomInvitationListSchema = z.array(RoomInvitationSchema);
export const RoomRosterSchema = z.array(RoomParticipantSchema);
export type RoomInvitation = z.infer<typeof RoomInvitationSchema>;

export interface InviteRoomUserInput {
  inviteeUserId: string;
  role?: "admin" | "member";
  participant: {
    type: "human";
    inboxId: string;
    instanceId?: string;
    displayName: string;
    externalId?: string;
    defaultToParticipantInstanceId?: string;
  };
}
