import {
  type Client,
  type CodingAgentAuditEvent,
  type JsonValue,
  recordCodingAgentEvent,
} from "@trytilde/sdk";
import { isJsonObject, parseJsonValue, stringField } from "@trytilde/sdk/json";

export async function recordClaudeCodeHook(options: {
  client: Client;
  agentId: string;
  input: unknown;
}): Promise<{ sessionId: string } | null> {
  const event = normalizeClaudeCodeHook(options.input);
  if (!event) return null;
  return recordCodingAgentEvent({
    client: options.client,
    agentId: options.agentId,
    source: "claude-code",
    event,
  });
}

export function normalizeClaudeCodeHook(input: unknown): CodingAgentAuditEvent | null {
  if (!isJsonObject(input)) return null;
  const sessionId = stringField(input, "session_id");
  const hook = stringField(input, "hook_event_name");
  if (!sessionId || !hook) return null;
  const base = {
    sessionId,
    ...(stringField(input, "cwd") ? { cwd: stringField(input, "cwd") } : {}),
    ...(stringField(input, "model") ? { model: stringField(input, "model") } : {}),
  };
  switch (hook) {
    case "SessionStart":
      return { ...base, type: "session_started" };
    case "SessionEnd":
      return { ...base, type: "session_ended" };
    case "UserPromptSubmit": {
      const text = stringField(input, "prompt");
      return text ? { ...base, type: "user_message", text } : null;
    }
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure": {
      const toolName = stringField(input, "tool_name");
      const executionId = stringField(input, "tool_use_id");
      if (!toolName || !executionId) return null;
      const type =
        hook === "PreToolUse"
          ? "tool_started"
          : hook === "PostToolUse"
            ? "tool_completed"
            : "tool_failed";
      return {
        ...base,
        type,
        executionId,
        toolName,
        input: jsonValue(input.tool_input),
        ...(hook === "PostToolUse" ? { output: jsonValue(input.tool_response) } : {}),
        ...(hook === "PostToolUseFailure"
          ? { errorMessage: stringField(input, "error") ?? "Tool execution failed" }
          : {}),
      };
    }
    case "Stop": {
      const text = stringField(input, "last_assistant_message");
      return text ? { ...base, type: "assistant_message", text } : null;
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
