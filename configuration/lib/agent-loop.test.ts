import { describe, expect, it } from "vite-plus/test";
import type { PrepareStepFunction, ToolSet } from "ai";
import {
  prepareChatKitAgentStep,
  requiresComputerDelegation,
  stopAfterChatKitMessage,
} from "./agent-loop.js";

type StepOptions = Parameters<PrepareStepFunction<ToolSet>>[0];

function options(toolName: string, output: unknown): StepOptions {
  return {
    steps: [{ toolResults: [{ toolName, output }] }],
  } as StepOptions;
}

const tools = {
  chatkit_delegate: {},
  chatkit_wait_for_response: {},
  sendMessage: {},
} as unknown as ToolSet;

describe("prepareChatKitAgentStep", () => {
  it("forces delegation before any user-visible message for explicit graphical work", () => {
    const prepare = prepareChatKitAgentStep(tools, { requireDelegationFirst: true });
    expect(prepare({ steps: [] } as unknown as StepOptions)).toEqual({
      activeTools: ["chatkit_delegate"],
      toolChoice: { type: "tool", toolName: "chatkit_delegate" },
    });
  });
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
      instructions: expect.stringContaining("using the completed response"),
      toolChoice: { type: "tool", toolName: "sendMessage" },
    });
  });

  it("leaves failed delegation and ordinary reasoning model-directed", () => {
    const prepare = prepareChatKitAgentStep(tools);
    expect(prepare(options("chatkit_delegate", { isError: true }))).toBeUndefined();
    expect(prepare(options("SEARCH_TOOLS", { tools: [] }))).toBeUndefined();
  });
});

describe("requiresComputerDelegation", () => {
  it.each([
    "Open https://example.com in the browser",
    "Summarize the web page currently open in the browser",
    "Find my calendar tab and click the next-event button",
    "Please scroll down and take a screenshot",
    "Launch the desktop app and dismiss its dialog",
  ])("routes explicit graphical work: %s", (text) => {
    expect(requiresComputerDelegation([{ role: "user", parts: [{ type: "text", text }] }])).toBe(
      true,
    );
  });

  it.each([
    "What is two plus two?",
    "Explain how browser cookies work",
    "What does click-through rate mean?",
    "I clicked the browser yesterday",
    "Find the latest sales figures in the connected CRM",
  ])("leaves non-graphical questions and discussion local: %s", (text) => {
    expect(requiresComputerDelegation([{ role: "user", parts: [{ type: "text", text }] }])).toBe(
      false,
    );
  });
});

describe("stopAfterChatKitMessage", () => {
  it("stops after the first successful visible message", () => {
    expect(stopAfterChatKitMessage(options("sendMessage", { deliveryStatus: "persisted" }))).toBe(
      true,
    );
    expect(stopAfterChatKitMessage(options("sendMessage", { isError: true }))).toBe(false);
    expect(stopAfterChatKitMessage(options("SEARCH_TOOLS", { tools: [] }))).toBe(false);
  });
});
