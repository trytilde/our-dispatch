import { describe, expect, it } from "vite-plus/test";
import { normalizeOpenCodeHook } from "../src/index";

describe("normalizeOpenCodeHook", () => {
  it("maps completed tool executions", () => {
    expect(
      normalizeOpenCodeHook({
        session_id: "opencode-1",
        hook_event_name: "tool.execute.after",
        call_id: "call-1",
        tool_name: "bash",
        tool_input: { command: "pnpm test" },
        tool_response: { title: "Tests", output: "passed" },
      }),
    ).toMatchObject({
      type: "tool_completed",
      sessionId: "opencode-1",
      executionId: "call-1",
      toolName: "bash",
    });
  });
});
