import { describe, expect, it } from "vite-plus/test";
import { eventBusyState, reduceLiveChatEvent } from "./reducer.js";

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
