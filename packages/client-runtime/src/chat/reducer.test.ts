import { describe, expect, it } from "vite-plus/test";
import { eventBusyState, reduceLiveChatEvent, uniqueMessages } from "./reducer.js";

describe("live chat reducer", () => {
  it("accumulates text deltas into one assistant message", () => {
    const first = reduceLiveChatEvent(
      [],
      {
        type: "message_streaming",
        data: {
          message_id: "message-one",
          session_id: "session-one",
          delta: { type: "text-delta", delta: "Hello" },
        },
      },
      "session-one",
      new Date("2026-08-17T12:00:00Z"),
    );
    const second = reduceLiveChatEvent(
      first.messages,
      {
        type: "message_streaming",
        data: {
          message_id: "message-one",
          session_id: "session-one",
          delta: { type: "text-delta", delta: " world" },
        },
      },
      "session-one",
      new Date("2026-08-17T12:00:01Z"),
    );

    expect(second.streaming).toBe(true);
    expect(second.messages[0]?.parts?.[0]?.text).toBe("Hello world");
  });

  it("ignores messages belonging to another session", () => {
    const result = reduceLiveChatEvent(
      [],
      {
        type: "message_streaming",
        data: {
          message_id: "message-one",
          session_id: "another-session",
          delta: { type: "text-delta", delta: "Private" },
        },
      },
      "session-one",
    );
    expect(result.messages).toEqual([]);
  });
});

describe("event busy state", () => {
  it("treats Mission Control typing indicators as busy", () => {
    expect(
      eventBusyState({
        type: "InboxInstance.typing_indicator.typing",
        data: {
          kind: {
            kind: "inbox_instance_typing_indicator",
            session_id: "session-one",
            status: "typing",
          },
        },
      }),
    ).toBe(true);
  });

  it("clears busy when a flat streaming delta finishes", () => {
    expect(
      eventBusyState({
        type: "message_streaming",
        data: {
          message_id: "message-one",
          session_id: "session-one",
          delta: { type: "finish" },
        },
      }),
    ).toBe(false);
  });

  it("clears busy when a nested streaming delta finishes", () => {
    expect(
      eventBusyState({
        type: "message_streaming",
        data: {
          kind: {
            message_streaming: {
              message_id: "message-one",
              session_id: "session-one",
              delta: { type: "finish" },
            },
          },
        },
      }),
    ).toBe(false);
  });

  it("stays busy while a nested streaming delta carries text", () => {
    expect(
      eventBusyState({
        type: "message_streaming",
        data: {
          kind: {
            message_streaming: {
              message_id: "message-one",
              session_id: "session-one",
              delta: { type: "text-delta", delta: "Hello" },
            },
          },
        },
      }),
    ).toBe(true);
  });
});

describe("message ordering", () => {
  it("keeps a late queued response beside the message that triggered it", () => {
    const message = (id: string, role: string, createdAt: string, replyTo?: string) => ({
      id,
      type: "ui",
      role,
      session_id: "session-one",
      parts: [{ type: "text", text: id }],
      created_at: createdAt,
      ...(replyTo ? { in_reply_to_message_id: replyTo } : {}),
    });

    expect(
      uniqueMessages([
        message("first-prompt", "user", "2026-08-20T09:00:00Z"),
        message("second-prompt", "user", "2026-08-20T09:01:00Z"),
        message("first-reply", "assistant", "2026-08-20T11:00:00Z", "first-prompt"),
        message("second-reply", "assistant", "2026-08-20T11:01:00Z", "second-prompt"),
      ]).map((item) => item.id),
    ).toEqual(["first-prompt", "first-reply", "second-prompt", "second-reply"]);
  });
});
