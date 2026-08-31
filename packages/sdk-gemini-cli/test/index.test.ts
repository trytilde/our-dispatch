import { describe, expect, it } from "vite-plus/test";
import { normalizeGeminiCliHook } from "../src/index";

describe("normalizeGeminiCliHook", () => {
  it("maps final agent responses", () => {
    expect(
      normalizeGeminiCliHook({
        session_id: "gemini-1",
        hook_event_name: "AfterAgent",
        timestamp: "2026-08-31T12:00:00Z",
        prompt_response: "Implemented and tested.",
      }),
    ).toMatchObject({
      type: "assistant_message",
      sessionId: "gemini-1",
      text: "Implemented and tested.",
    });
  });

  it("maps failed tool responses", () => {
    expect(
      normalizeGeminiCliHook({
        session_id: "gemini-1",
        hook_event_name: "AfterTool",
        timestamp: "2026-08-31T12:00:01Z",
        tool_name: "write_file",
        tool_input: { path: "README.md" },
        tool_response: { error: "permission denied" },
      }),
    ).toMatchObject({
      type: "tool_failed",
      executionId: "2026-08-31T12:00:01Z:write_file",
      errorMessage: "permission denied",
    });
  });
});
