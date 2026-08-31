import {
  type Client,
  type CodingAgentAuditEvent,
  type JsonValue,
  recordCodingAgentEvent,
} from "@trytilde/sdk";
import { isJsonObject, parseJsonValue, stringField } from "@trytilde/sdk/json";

export async function recordCursorHook(options: {
  client: Client;
  agentId: string;
  input: unknown;
}): Promise<{ sessionId: string } | null> {
  const event = normalizeCursorHook(options.input);
  if (!event) return null;
  return recordCodingAgentEvent({
    client: options.client,
    agentId: options.agentId,
    source: "cursor",
    event,
  });
}

export function normalizeCursorHook(input: unknown): CodingAgentAuditEvent | null {
  if (!isJsonObject(input)) return null;
  const sessionId =
    stringField(input, "session_id") ??
    stringField(input, "conversation_id") ??
    stringField(input, "generation_id");
  const hook =
    stringField(input, "hook_event_name") ??
    stringField(input, "event_name") ??
    stringField(input, "hookEventName");
  if (!sessionId || !hook) return null;
  const normalizedHook = hook.toLowerCase();
  const base = {
    sessionId,
    ...(stringField(input, "cwd") ? { cwd: stringField(input, "cwd") } : {}),
    ...(stringField(input, "model") ? { model: stringField(input, "model") } : {}),
  };
  if (normalizedHook === "sessionstart") return { ...base, type: "session_started" };
  if (normalizedHook === "sessionend") return { ...base, type: "session_ended" };
  if (normalizedHook === "beforesubmitprompt") {
    const text = stringField(input, "prompt");
    return text ? { ...base, type: "user_message", text } : null;
  }
  if (normalizedHook === "afteragentresponse") {
    const text = stringField(input, "text") ?? stringField(input, "response");
    return text ? { ...base, type: "assistant_message", text } : null;
  }
  if (
    normalizedHook === "pretooluse" ||
    normalizedHook === "posttooluse" ||
    normalizedHook === "posttoolusefailure"
  ) {
    const toolName = stringField(input, "tool_name") ?? stringField(input, "toolName");
    const executionId =
      stringField(input, "tool_use_id") ??
      stringField(input, "tool_call_id") ??
      stringField(input, "call_id");
    if (!toolName || !executionId) return null;
    const type =
      normalizedHook === "pretooluse"
        ? "tool_started"
        : normalizedHook === "posttooluse"
          ? "tool_completed"
          : "tool_failed";
    return {
      ...base,
      type,
      executionId,
      toolName,
      input: jsonValue(input.tool_input ?? input.toolInput),
      ...(type === "tool_completed"
        ? { output: jsonValue(input.tool_response ?? input.result_json ?? input.result) }
        : {}),
      ...(type === "tool_failed"
        ? { errorMessage: stringField(input, "error") ?? "Tool execution failed" }
        : {}),
    };
  }
  return null;
}

function jsonValue(value: JsonValue | undefined): JsonValue {
  if (value === undefined) return {};
  if (typeof value !== "string") return value;
  return parseJsonValue(value) ?? value;
}
