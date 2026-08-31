import { describe, expect, it } from "vite-plus/test";
import { normalizeClaudeCodeHook } from "../src/index";

describe("normalizeClaudeCodeHook", () => {
  it("maps failed tool hooks", () => {
    expect(
      normalizeClaudeCodeHook({
        session_id: "session-1",
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_use_id: "toolu-1",
        tool_input: { command: "pnpm test" },
        error: "exit 1",
      }),
    ).toMatchObject({
      type: "tool_failed",
      executionId: "toolu-1",
      errorMessage: "exit 1",
    });
  });
});
