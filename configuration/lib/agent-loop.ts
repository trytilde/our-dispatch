import type { PrepareStepFunction, ToolSet } from "ai";

const DELEGATE_TOOL = "chatkit_delegate";
const WAIT_TOOL = "chatkit_wait_for_response";
const SEND_MESSAGE_TOOL = "sendMessage";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function completedToolResult(
  steps: Parameters<PrepareStepFunction<ToolSet>>[0]["steps"],
  toolName: string,
): boolean {
  return (steps.at(-1)?.toolResults ?? []).some((result) => {
    if (result.toolName !== toolName) return false;
    return !isRecord(result.output) || result.output.isError !== true;
  });
}

function requireTool(tools: ToolSet, toolName: string): void {
  if (!(toolName in tools)) throw new TypeError(`ChatKit agent loop requires the ${toolName} tool`);
}

/** Preserve the reasoning loop across ChatKit communication handoffs. */
export function prepareChatKitAgentStep(tools: ToolSet): PrepareStepFunction<ToolSet> {
  return ({ steps }) => {
    if (completedToolResult(steps, DELEGATE_TOOL)) {
      requireTool(tools, WAIT_TOOL);
      return {
        activeTools: [WAIT_TOOL],
        toolChoice: { type: "tool", toolName: WAIT_TOOL },
      };
    }
    if (completedToolResult(steps, WAIT_TOOL)) {
      requireTool(tools, SEND_MESSAGE_TOOL);
      return {
        activeTools: [SEND_MESSAGE_TOOL],
        toolChoice: { type: "tool", toolName: SEND_MESSAGE_TOOL },
      };
    }
    return undefined;
  };
}
