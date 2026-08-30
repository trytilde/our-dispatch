import { describe, expect, it } from "vite-plus/test";
import type { ChatKitSearchHit } from "@tryopenbot/client-runtime";
import { rankWorkspaceSearchHits, searchHitId } from "./search-results.js";

const now = "2026-08-30T00:00:00.000Z";

function hit(input: Partial<ChatKitSearchHit> & Pick<ChatKitSearchHit, "kind">): ChatKitSearchHit {
  return {
    session: { id: "session", title: "Chat", created_at: now, updated_at: now },
    ...input,
  } as ChatKitSearchHit;
}

describe("workspace search results", () => {
  it("deduplicates a bot returned through several matching chats and ranks its exact name first", () => {
    const results = rankWorkspaceSearchHits(
      [
        hit({
          kind: "message",
          message: {
            id: "message",
            type: "ui",
            role: "assistant",
            session_id: "session",
            created_at: now,
            parts: [{ type: "text", text: "Pirate Poet replied" }],
          },
        }),
        hit({
          kind: "session_title",
          session: { id: "chat", title: "Pirate Poet notes", created_at: now, updated_at: now },
        }),
        hit({ kind: "agent", agent: { id: "pirate-poet", display_name: "Pirate Poet" } }),
        hit({
          kind: "agent",
          session: { id: "another-chat", title: "Another", created_at: now, updated_at: now },
          agent: { id: "pirate-poet", display_name: "Pirate Poet" },
        }),
      ],
      "Pirate Poet",
    );

    expect(results.map(searchHitId)).toEqual([
      "agent:pirate-poet",
      "session_title:chat",
      "message:message",
    ]);
  });
});
