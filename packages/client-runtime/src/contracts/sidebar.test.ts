import { describe, expect, it } from "vite-plus/test";
import { agentConversationSessions, type ChatAgent } from "./sidebar.js";

describe("agent conversation sessions", () => {
  it("separates the continuous bot session and orders named threads by activity", () => {
    const agent = {
      id: "agent-one",
      display_name: "Agent One",
      provider_id: "provider",
      status: "enabled",
      sessions: {
        items: [
          {
            id: "older-thread",
            title: "Older",
            created_at: "2026-08-23T08:00:00.000Z",
            updated_at: "2026-08-23T08:00:00.000Z",
          },
          {
            id: "continuous",
            lookup_key: "openbot:user:owner:agent:agent-one",
            title: "Agent One",
            created_at: "2026-08-25T08:00:00.000Z",
            updated_at: "2026-08-25T08:00:00.000Z",
          },
          {
            id: "newer-thread",
            title: "Newer",
            created_at: "2026-08-24T08:00:00.000Z",
            updated_at: "2026-08-24T08:00:00.000Z",
          },
        ],
      },
    } satisfies ChatAgent;

    const result = agentConversationSessions(agent, "owner");

    expect(result.userSession?.id).toBe("continuous");
    expect(result.threads.map((session) => session.id)).toEqual(["newer-thread", "older-thread"]);
  });
});
