import { describe, expect, it, vi } from "vite-plus/test";
import { createClient, runBoundedRoomGroup, type RoomParticipant } from "../src";

const sessionId = "22222222-2222-4222-8222-222222222222";
const invitationId = "33333333-3333-4333-8333-333333333333";

const rawParticipant = {
  participant_type: "human",
  participant_handle: "p123abc",
  membership_source: "invitation",
  role: "member",
  principal_user_id: "user-two",
  joined_at: "2026-09-01T10:00:00Z",
  instance: { id: "human-instance" },
  inbox: { id: "channel" },
};

const rawInvitation = {
  id: invitationId,
  session_id: sessionId,
  org_id: "org-one",
  team_id: "team-one",
  invitee_user_id: "user-two",
  invited_by_user_id: "user-one",
  role: "member",
  participant: {
    participant_type: "human",
    inbox_id: "channel",
    instance_id: "human-instance",
    display_name: "Second user",
  },
  status: "pending",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
};

describe("ChatKitRoomsClient", () => {
  it("exposes the complete invitation and departure workflow", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(rawInvitation))
      .mockResolvedValueOnce(Response.json([rawInvitation]))
      .mockResolvedValueOnce(Response.json({ ...rawInvitation, status: "accepted" }))
      .mockResolvedValueOnce(Response.json([rawParticipant]))
      .mockResolvedValueOnce(Response.json({ success: true }));
    const rooms = createClient({
      apiKey: "owner-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    }).chatkit.rooms;

    const invited = await rooms.invite({
      sessionId,
      inviteeUserId: "user-two",
      participant: {
        type: "human",
        inboxId: "channel",
        instanceId: "human-instance",
        displayName: "Second user",
      },
    });
    expect(invited.inviteeUserId).toBe("user-two");
    expect(await rooms.invitations(sessionId)).toHaveLength(1);
    expect((await rooms.decide({ sessionId, invitationId, decision: "accept" })).status).toBe(
      "accepted",
    );
    expect((await rooms.roster(sessionId))[0]).toMatchObject({
      role: "member",
      principalUserId: "user-two",
    });
    await rooms.leave(sessionId, "human-instance");

    const bodies = fetchMock.mock.calls
      .map((call) => call[1] as RequestInit | undefined)
      .filter((init) => typeof init?.body === "string")
      .map((init) => JSON.parse(init?.body as string));
    expect(bodies).toContainEqual(expect.objectContaining({ invitee_user_id: "user-two" }));
    expect(bodies).toContainEqual({ decision: "accept" });
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain("/participants/human-instance");
  });

  it("stops bounded orchestration on no progress and deduplicates agents", async () => {
    const agent = (handle: string): RoomParticipant => ({
      type: "agent",
      handle,
      role: "member",
      membershipSource: "explicit",
      joinedAt: "2026-09-01T10:00:00Z",
      instance: {},
      inbox: {},
    });
    const runTurn = vi.fn().mockResolvedValue({ continue: true, progress: false });
    const result = await runBoundedRoomGroup({
      participants: [agent("a"), agent("a"), agent("b")],
      runTurn,
      maxRounds: 10,
    });
    expect(result).toEqual({ rounds: 1, turns: 2, stopped: "no_progress" });
  });
});
