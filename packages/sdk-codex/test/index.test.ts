import { describe, expect, it } from "vite-plus/test";
import { normalizeCodexHook } from "../src/index";

describe("normalizeCodexHook", () => {
  it("maps tool lifecycle hooks", () => {
    expect(
      normalizeCodexHook({
        session_id: "thread-1",
        hook_event_name: "PostToolUse",
        tool_name: "functions.exec",
        tool_use_id: "call-1",
        tool_input: { cmd: "pnpm test" },
        tool_response: { exit_code: 0 },
      }),
    ).toMatchObject({
      type: "tool_completed",
      sessionId: "thread-1",
      executionId: "call-1",
      toolName: "functions.exec",
      output: { exit_code: 0 },
    });
  });
});
