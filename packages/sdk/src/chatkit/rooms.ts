import type { NormalizedConfig } from "../config";
import { requestJson } from "../internal/fetch-client";
import { pathWithParams, teamPath } from "../internal/paths";
import type { JsonObject } from "../tools";

const ROOMS_PATH = "/api/v1/team/{team_id}/chatkit/sessions";
const ROSTER_PATH = `${ROOMS_PATH}/{session_id}/participants`;
const INVITATIONS_PATH = `${ROOMS_PATH}/{session_id}/invitations`;

export type RoomRole = "owner" | "admin" | "member";
export type RoomVisibility = "private" | "team";
export type RoomInvitationStatus = "pending" | "accepted" | "declined" | "revoked";

export type RoomParticipantInput = {
  type: "human" | "agent";
  inboxId: string;
  instanceId?: string;
  displayName: string;
  externalId?: string;
  defaultToParticipantInstanceId?: string;
};

export type RoomParticipant = {
  type: "human" | "agent";
  handle: string;
  role: RoomRole;
  principalUserId?: string;
  membershipSource: "explicit" | "invitation" | "provider" | "recipient";
  joinedAt: string;
  instance: JsonObject;
  inbox: JsonObject;
};

export type RoomInvitation = {
  id: string;
  sessionId: string;
  inviteeUserId: string;
  invitedByUserId: string;
  role: Exclude<RoomRole, "owner">;
  participant: RoomParticipantInput;
  status: RoomInvitationStatus;
  createdAt: string;
  updatedAt: string;
};

type RawParticipant = {
  participant_type: "human" | "agent";
  participant_handle: string;
  membership_source: RoomParticipant["membershipSource"];
  role: RoomRole;
  principal_user_id?: string | null;
  joined_at: string;
  instance: JsonObject;
  inbox: JsonObject;
};

type RawInvitation = {
  id: string;
  session_id: string;
  invitee_user_id: string;
  invited_by_user_id: string;
  role: Exclude<RoomRole, "owner">;
  participant: {
    participant_type: "human" | "agent";
    inbox_id: string;
    instance_id?: string;
    display_name: string;
    external_id?: string;
    default_to_participant_instance_id?: string;
  };
  status: RoomInvitationStatus;
  created_at: string;
  updated_at: string;
};

function participantBody(input: RoomParticipantInput): JsonObject {
  return {
    participant_type: input.type,
    inbox_id: input.inboxId,
    instance_id: input.instanceId,
    display_name: input.displayName,
    external_id: input.externalId,
    default_to_participant_instance_id: input.defaultToParticipantInstanceId,
  };
}

function mapParticipant(raw: RawParticipant): RoomParticipant {
  return {
    type: raw.participant_type,
    handle: raw.participant_handle,
    role: raw.role,
    principalUserId: raw.principal_user_id ?? undefined,
    membershipSource: raw.membership_source,
    joinedAt: raw.joined_at,
    instance: raw.instance,
    inbox: raw.inbox,
  };
}

function mapInvitation(raw: RawInvitation): RoomInvitation {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    inviteeUserId: raw.invitee_user_id,
    invitedByUserId: raw.invited_by_user_id,
    role: raw.role,
    participant: {
      type: raw.participant.participant_type,
      inboxId: raw.participant.inbox_id,
      instanceId: raw.participant.instance_id,
      displayName: raw.participant.display_name,
      externalId: raw.participant.external_id,
      defaultToParticipantInstanceId: raw.participant.default_to_participant_instance_id,
    },
    status: raw.status,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/** High-level multiplayer room operations backed by durable ChatKit sessions. */
export class ChatKitRoomsClient {
  constructor(private readonly config: NormalizedConfig) {}

  async create(input: {
    title?: string;
    visibility: RoomVisibility;
    participants?: RoomParticipantInput[];
  }): Promise<{ session: JsonObject; participants: RoomParticipant[] }> {
    const mode = input.visibility === "private" ? "private" : "team";
    const raw = await requestJson<{ session: JsonObject; participants: RawParticipant[] }>(
      this.config,
      {
        method: "POST",
        path: teamPath(this.config, ROOMS_PATH),
        body: {
          title: input.title,
          authorization: { visibility: mode, ownership: mode },
          participants: input.participants?.map(participantBody) ?? [],
        },
      },
    );
    return { session: raw.session, participants: raw.participants.map(mapParticipant) };
  }

  async roster(sessionId: string): Promise<RoomParticipant[]> {
    const raw = await requestJson<RawParticipant[]>(this.config, {
      path: pathWithParams(teamPath(this.config, ROSTER_PATH), { session_id: sessionId }),
    });
    return raw.map(mapParticipant);
  }

  async add(sessionId: string, participant: RoomParticipantInput): Promise<RoomParticipant> {
    const raw = await requestJson<RawParticipant>(this.config, {
      method: "POST",
      path: pathWithParams(teamPath(this.config, ROSTER_PATH), { session_id: sessionId }),
      body: { participant: participantBody(participant) },
    });
    return mapParticipant(raw);
  }

  async leave(sessionId: string, participantInstanceId: string): Promise<void> {
    await requestJson(this.config, {
      method: "DELETE",
      path: pathWithParams(teamPath(this.config, `${ROSTER_PATH}/{participant_instance_id}`), {
        session_id: sessionId,
        participant_instance_id: participantInstanceId,
      }),
    });
  }

  async invite(input: {
    sessionId: string;
    inviteeUserId: string;
    role?: Exclude<RoomRole, "owner">;
    participant: RoomParticipantInput;
  }): Promise<RoomInvitation> {
    const raw = await requestJson<RawInvitation>(this.config, {
      method: "POST",
      path: pathWithParams(teamPath(this.config, INVITATIONS_PATH), {
        session_id: input.sessionId,
      }),
      body: {
        invitee_user_id: input.inviteeUserId,
        role: input.role ?? "member",
        participant: participantBody(input.participant),
      },
    });
    return mapInvitation(raw);
  }

  async invitations(sessionId: string): Promise<RoomInvitation[]> {
    const raw = await requestJson<RawInvitation[]>(this.config, {
      path: pathWithParams(teamPath(this.config, INVITATIONS_PATH), { session_id: sessionId }),
    });
    return raw.map(mapInvitation);
  }

  async decide(input: {
    sessionId: string;
    invitationId: string;
    decision: "accept" | "decline";
  }): Promise<RoomInvitation> {
    const raw = await requestJson<RawInvitation>(this.config, {
      method: "POST",
      path: pathWithParams(teamPath(this.config, `${INVITATIONS_PATH}/{invitation_id}/decision`), {
        session_id: input.sessionId,
        invitation_id: input.invitationId,
      }),
      body: { decision: input.decision },
    });
    return mapInvitation(raw);
  }

  async revoke(sessionId: string, invitationId: string): Promise<RoomInvitation> {
    const raw = await requestJson<RawInvitation>(this.config, {
      method: "DELETE",
      path: pathWithParams(teamPath(this.config, `${INVITATIONS_PATH}/{invitation_id}`), {
        session_id: sessionId,
        invitation_id: invitationId,
      }),
    });
    return mapInvitation(raw);
  }
}

export type GroupTurn = { round: number; participant: RoomParticipant };

/** Run a bounded deterministic round-robin and stop when no participant makes progress. */
export async function runBoundedRoomGroup(input: {
  participants: RoomParticipant[];
  runTurn(turn: GroupTurn): Promise<{ continue: boolean; progress: boolean }>;
  maxRounds?: number;
  maxParticipants?: number;
}): Promise<{ rounds: number; turns: number; stopped: "complete" | "no_progress" | "cap" }> {
  const maxRounds = Math.min(Math.max(input.maxRounds ?? 3, 1), 20);
  const maxParticipants = Math.min(Math.max(input.maxParticipants ?? 8, 1), 32);
  const participants = [...new Map(input.participants.map((item) => [item.handle, item])).values()]
    .filter((item) => item.type === "agent")
    .slice(0, maxParticipants);
  let turns = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    let roundProgress = false;
    for (const participant of participants) {
      const result = await input.runTurn({ round, participant });
      turns += 1;
      roundProgress ||= result.progress;
      if (!result.continue) return { rounds: round, turns, stopped: "complete" };
    }
    if (!roundProgress) return { rounds: round, turns, stopped: "no_progress" };
  }
  return { rounds: maxRounds, turns, stopped: "cap" };
}
