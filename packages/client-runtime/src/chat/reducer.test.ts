import { describe, expect, it } from "vite-plus/test";
import { eventBusyState, reduceLiveChatEvent, uniqueMessages } from "./reducer.js";

describe("live chat reducer", () => {
  it("accumulates text deltas into one assistant message", () => {
    const first = reduceLiveChatEvent(
      [],
      {
        id: "event-one",
        occurred_at: "2026-08-17T12:00:00Z",
        type: "message.delta",
        data: {
          message_id: "message-one",
          session_id: "session-one",
          part_id: "text-one",
          sequence: 1,
          delta: { type: "text-delta", delta: "Hello" },
        },
      },
      "session-one",
      new Date("2026-08-17T12:00:00Z"),
    );
    const second = reduceLiveChatEvent(
      first.messages,
      {
        id: "event-two",
        occurred_at: "2026-08-17T12:00:01Z",
        type: "message.delta",
        data: {
          message_id: "message-one",
          session_id: "session-one",
          part_id: "text-one",
          sequence: 2,
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
        id: "event-three",
        occurred_at: "2026-08-17T12:00:00Z",
        type: "message.delta",
        data: {
          message_id: "message-one",
          session_id: "another-session",
          part_id: "text-one",
          sequence: 1,
          delta: { type: "text-delta", delta: "Private" },
        },
      },
      "session-one",
    );
    expect(result.messages).toEqual([]);
  });
});

describe("event busy state", () => {
  it("treats ChatKit typing activity as busy", () => {
    expect(
      eventBusyState({
        id: "event-four",
        occurred_at: "2026-08-17T12:00:00Z",
        type: "activity.typing.started",
        data: {
          session_id: "session-one",
          inbox_instance_id: "agent-one",
        },
      }),
    ).toBe(true);
  });

  it("clears busy when a flat streaming delta finishes", () => {
    expect(
      eventBusyState({
        id: "event-five",
        occurred_at: "2026-08-17T12:00:00Z",
        type: "message.delta",
        data: {
          message_id: "message-one",
          session_id: "session-one",
          part_id: "text-one",
          sequence: 1,
          delta: { type: "finish" },
        },
      }),
    ).toBe(false);
  });

  it("clears busy when a turn completes", () => {
    expect(
      eventBusyState({
        id: "event-six",
        occurred_at: "2026-08-17T12:00:00Z",
        type: "turn.completed",
        data: {
          turn_id: "turn-one",
          session_id: "session-one",
          agent_id: "agent-one",
        },
      }),
    ).toBe(false);
  });

  it("stays busy while a turn is running", () => {
    expect(
      eventBusyState({
        id: "event-seven",
        occurred_at: "2026-08-17T12:00:00Z",
        type: "turn.started",
        data: {
          turn_id: "turn-one",
          session_id: "session-one",
          agent_id: "agent-one",
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
