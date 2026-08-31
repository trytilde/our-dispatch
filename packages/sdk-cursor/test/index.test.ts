import { describe, expect, it } from "vite-plus/test";
import { normalizeCursorHook } from "../src/index";

describe("normalizeCursorHook", () => {
  it("maps agent responses", () => {
    expect(
      normalizeCursorHook({
        conversation_id: "conversation-1",
        hook_event_name: "afterAgentResponse",
        response: "Implemented and tested.",
      }),
    ).toMatchObject({
      type: "assistant_message",
      sessionId: "conversation-1",
      text: "Implemented and tested.",
    });
  });
});
