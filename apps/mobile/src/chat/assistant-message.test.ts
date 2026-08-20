import { describe, expect, it } from "vite-plus/test";
import { toAssistantMessage } from "./assistant-message";

describe("assistant-ui message projection", () => {
  it("preserves identity, role, text, and streaming status", () => {
    expect(
      toAssistantMessage({
        id: "message-one",
        type: "ui",
        role: "assistant",
        session_id: "session-one",
        parts: [
          { type: "text", text: "Working" },
          { type: "reasoning", state: "streaming" },
        ],
        created_at: "2026-08-20T12:00:00.000Z",
      }),
    ).toMatchObject({
      id: "message-one",
      role: "assistant",
      content: [{ type: "text", text: "Working" }],
      status: { type: "running" },
    });
  });

  it("keeps rich-only messages visible to assistant-ui navigation", () => {
    expect(
      toAssistantMessage({
        id: "message-two",
        type: "ui",
        role: "assistant",
        session_id: "session-one",
        parts: [{ type: "file", filename: "report.pdf", media_type: "application/pdf" }],
        created_at: "2026-08-20T12:00:01.000Z",
      }).content,
    ).toEqual([{ type: "text", text: "report.pdf" }]);
  });
});
