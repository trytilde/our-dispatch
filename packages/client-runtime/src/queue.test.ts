import { describe, expect, it } from "vite-plus/test";
import type { QueuedTurn } from "./contracts/queue.js";
import { queuedTurnText } from "./queue.js";

const queuedTurn = (chatRequest: Record<string, unknown>): QueuedTurn => ({
  id: "turn-one",
  session_id: "session-one",
  queue_position: 1,
  status: "pending",
  chat_request: chatRequest,
  created_at: "2026-08-20T12:00:00.000Z",
});

describe("queuedTurnText", () => {
  it("reads the latest owner message from nested ChatKit parts", () => {
    expect(
      queuedTurnText(
        queuedTurn({
          messages: [
            { role: "user", content: "First" },
            { role: "assistant", content: "Reply" },
            { role: "user", content: [{ type: "text", text: "Ship it" }] },
          ],
        }),
      ),
    ).toBe("Ship it");
  });

  it("uses a stable fallback for malformed requests", () => {
    expect(queuedTurnText(queuedTurn({}))).toBe("Queued agent turn");
  });
});
