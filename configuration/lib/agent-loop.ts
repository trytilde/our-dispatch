import type { PrepareStepFunction, StopCondition, ToolSet } from "ai";

const DELEGATE_TOOL = "chatkit_delegate";
const WAIT_TOOL = "chatkit_wait_for_response";
const SEND_MESSAGE_TOOL = "sendMessage";

export interface ChatKitAgentStepOptions {
  requireDelegationFirst?: boolean;
}

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
export function prepareChatKitAgentStep(
  tools: ToolSet,
  options: ChatKitAgentStepOptions = {},
): PrepareStepFunction<ToolSet> {
  return ({ steps }) => {
    if (options.requireDelegationFirst && steps.length === 0) {
      requireTool(tools, DELEGATE_TOOL);
      return {
        activeTools: [DELEGATE_TOOL],
        toolChoice: { type: "tool", toolName: DELEGATE_TOOL },
      };
    }
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

/** Identify explicit graphical work that must begin in the Computer specialist. */
export function requiresComputerDelegation(
  messages: readonly { role?: string; parts?: readonly unknown[] }[],
): boolean {
  const latest = [...messages].reverse().find((message) => message.role === "user");
  const text = (latest?.parts ?? [])
    .flatMap((part) => {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return [];
      return [part.text];
    })
    .join(" ");
  return /(?:\b(?:browser|website|webpage|web page|graphical|desktop app|on[- ]screen|click|navigate)\b|\bopen\s+https?:\/\/)/i.test(
    text,
  );
}

/** End the reasoning loop after the first successfully persisted user-facing message. */
export const stopAfterChatKitMessage: StopCondition<ToolSet> = ({ steps }) =>
  completedToolResult(steps, SEND_MESSAGE_TOOL);
