import {
  type Client,
  type CodingAgentAuditEvent,
  type JsonValue,
  recordCodingAgentEvent,
} from "@trytilde/sdk";
import { isJsonObject, parseJsonValue, stringField } from "@trytilde/sdk/json";

export async function recordGeminiCliHook(options: {
  client: Client;
  agentId: string;
  input: unknown;
}): Promise<{ sessionId: string } | null> {
  const event = normalizeGeminiCliHook(options.input);
  if (!event) return null;
  return recordCodingAgentEvent({
    client: options.client,
    agentId: options.agentId,
    source: "gemini-cli",
    event,
  });
}

export function normalizeGeminiCliHook(input: unknown): CodingAgentAuditEvent | null {
  if (!isJsonObject(input)) return null;
  const sessionId = stringField(input, "session_id");
  const hook = stringField(input, "hook_event_name");
  if (!sessionId || !hook) return null;
  const timestamp = stringField(input, "timestamp");
  const base = {
    sessionId,
    ...(stringField(input, "cwd") ? { cwd: stringField(input, "cwd") } : {}),
    ...(timestamp ? { eventId: `${sessionId}:${hook}:${timestamp}` } : {}),
  };
  switch (hook) {
    case "SessionStart":
      return { ...base, type: "session_started" };
    case "SessionEnd":
      return { ...base, type: "session_ended" };
    case "BeforeAgent": {
      const text = stringField(input, "prompt");
      return text ? { ...base, type: "user_message", text } : null;
    }
    case "AfterAgent": {
      const text = stringField(input, "prompt_response");
      return text ? { ...base, type: "assistant_message", text } : null;
    }
    case "AfterTool": {
      const toolName = stringField(input, "tool_name");
      if (!toolName) return null;
      const response = input.tool_response;
      const errorMessage = isJsonObject(response) ? stringField(response, "error") : undefined;
      return {
        ...base,
        type: errorMessage ? "tool_failed" : "tool_completed",
        executionId: `${timestamp ?? "completed"}:${toolName}`,
        toolName,
        input: jsonValue(input.tool_input),
        ...(errorMessage
          ? { errorMessage }
          : { output: jsonValue(response), ...(timestamp ? { completedAt: timestamp } : {}) }),
      };
    }
    default:
      return null;
  }
}

function jsonValue(value: JsonValue | undefined): JsonValue {
  if (value === undefined) return {};
  if (typeof value !== "string") return value;
  return parseJsonValue(value) ?? value;
}
