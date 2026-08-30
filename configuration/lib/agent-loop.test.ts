import { describe, expect, it } from "vite-plus/test";
import type { PrepareStepFunction, ToolSet } from "ai";
import { prepareChatKitAgentStep } from "./agent-loop.js";

type StepOptions = Parameters<PrepareStepFunction<ToolSet>>[0];

function options(toolName: string, output: unknown): StepOptions {
  return {
    steps: [{ toolResults: [{ toolName, output }] }],
  } as StepOptions;
}

const tools = {
  chatkit_wait_for_response: {},
  sendMessage: {},
} as unknown as ToolSet;

describe("prepareChatKitAgentStep", () => {
  it("forces the wait immediately after delegation", () => {
    expect(prepareChatKitAgentStep(tools)(options("chatkit_delegate", { isError: false }))).toEqual(
      {
        activeTools: ["chatkit_wait_for_response"],
        toolChoice: { type: "tool", toolName: "chatkit_wait_for_response" },
      },
    );
  });

  it("forces a visible message after the delegated response", () => {
    expect(
      prepareChatKitAgentStep(tools)(options("chatkit_wait_for_response", { status: "completed" })),
    ).toEqual({
      activeTools: ["sendMessage"],
      toolChoice: { type: "tool", toolName: "sendMessage" },
    });
  });

  it("leaves failed delegation and ordinary reasoning model-directed", () => {
    const prepare = prepareChatKitAgentStep(tools);
    expect(prepare(options("chatkit_delegate", { isError: true }))).toBeUndefined();
    expect(prepare(options("SEARCH_TOOLS", { tools: [] }))).toBeUndefined();
  });
});
