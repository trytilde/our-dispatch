import type { PrepareStepFunction, StopCondition, ToolSet } from "ai";

const DELEGATE_TOOL = "chatkit_delegate";
const WAIT_TOOL = "chatkit_wait_for_response";
const SEND_MESSAGE_TOOL = "sendMessage";

export interface ChatKitAgentStepOptions {
  requireDelegationFirst?: boolean;
  requireFinalMessageFirst?: boolean;
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
  return ({ steps, initialInstructions }) => {
    if (options.requireDelegationFirst && steps.length === 0) {
      requireTool(tools, DELEGATE_TOOL);
      return {
        activeTools: [DELEGATE_TOOL],
        toolChoice: { type: "tool", toolName: DELEGATE_TOOL },
      };
    }
    if (options.requireFinalMessageFirst && steps.length === 0) {
      requireTool(tools, SEND_MESSAGE_TOOL);
      return {
        activeTools: [SEND_MESSAGE_TOOL],
        instructions: [
          typeof initialInstructions === "string" ? initialInstructions : undefined,
          "Answer the user's request completely now through sendMessage. Provide the actual answer, not an acknowledgement, plan, future-tense promise, or status update.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        toolChoice: { type: "tool", toolName: SEND_MESSAGE_TOOL },
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
        instructions: [
          typeof initialInstructions === "string" ? initialInstructions : undefined,
          "The delegated task is complete. Call sendMessage exactly once, using the completed response in the immediately preceding chatkit_wait_for_response tool result as the answer. Preserve its concrete result and caveats. Never send an acknowledgement, future-tense promise, or status update at this step.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        toolChoice: { type: "tool", toolName: SEND_MESSAGE_TOOL },
      };
    }
    return undefined;
  };
}

/** Identify self-contained informational requests that need no external action or discovery. */
export function requiresImmediateAnswer(
  messages: readonly { role?: string; parts?: readonly unknown[] }[],
): boolean {
  const latest = [...messages].reverse().find((message) => message.role === "user");
  if (!latest?.parts?.length) return false;
  if (latest.parts.some((part) => !isRecord(part) || part.type !== "text")) return false;
  const text = latest.parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join(" ")
    .trim();
  if (!text || text.length > 300) return false;
  const informational = /^(?:what|who|when|where|why|how|explain|define|describe)\b/i.test(text);
  const externalContext =
    /(?:https?:\/\/|\b(?:my|latest|current|today|tomorrow|file|attachment|email|calendar|github|slack|stripe|crm|repository|workspace|search|find|open|create|send|update|delete|upload|download)\b)/i;
  return informational && !externalContext.test(text);
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
  const graphicalSurface =
    /\b(?:browser|website|webpage|web page|desktop|desktop app|screen|window|dialog|button|menu|form|tab|toolbar|address bar)\b/i;
  const graphicalAction =
    /\b(?:open|visit|navigate|go to|launch|inspect|read|summarize|check|interact|fill|submit|select|choose|upload|download|close|dismiss|switch to|find)\b/i;
  const urlAction =
    /\b(?:open|visit|navigate to|go to|inspect|read|summarize|check)\s+(?:the\s+)?https?:\/\//i;
  const imperativeInput =
    /(?:^|[.!?]\s*|\b(?:please|can you|could you|would you)\s+)(?:click|tap|scroll|drag|type into|press|take a screenshot)\b/i;
  return (
    urlAction.test(text) ||
    (graphicalAction.test(text) && graphicalSurface.test(text)) ||
    imperativeInput.test(text)
  );
}

/** End the reasoning loop after the first successfully persisted user-facing message. */
export const stopAfterChatKitMessage: StopCondition<ToolSet> = ({ steps }) =>
  completedToolResult(steps, SEND_MESSAGE_TOOL);
