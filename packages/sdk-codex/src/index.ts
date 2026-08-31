import {
  type Client,
  type CodingAgentAuditEvent,
  type JsonValue,
  recordCodingAgentEvent,
} from "@trytilde/sdk";
import { isJsonObject, parseJsonValue, stringField } from "@trytilde/sdk/json";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function codexPluginRoot(): string {
  return resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "tilde");
}

export async function recordCodexHook(options: {
  client: Client;
  agentId: string;
  input: unknown;
}): Promise<{ sessionId: string } | null> {
  const event = normalizeCodexHook(options.input);
  if (!event) return null;
  return recordCodingAgentEvent({
    client: options.client,
    agentId: options.agentId,
    source: "codex",
    event,
  });
}

export function normalizeCodexHook(input: unknown): CodingAgentAuditEvent | null {
  if (!isJsonObject(input)) return null;
  const sessionId = stringField(input, "session_id") ?? stringField(input, "thread_id");
  const hook = stringField(input, "hook_event_name");
  if (!sessionId || !hook) return null;
  const base = hookBase(input, sessionId);
  switch (hook.toLowerCase()) {
    case "sessionstart":
      return { ...base, type: "session_started" };
    case "userpromptsubmit": {
      const text = stringField(input, "prompt");
      return text ? { ...base, type: "user_message", text } : null;
    }
    case "pretooluse":
      return toolEvent(input, base, "tool_started");
    case "posttooluse":
      return toolEvent(input, base, "tool_completed");
    case "stop": {
      const text = stringField(input, "last_assistant_message");
      return text ? { ...base, type: "assistant_message", text } : null;
    }
    default:
      return null;
  }
}

function hookBase(input: Record<string, JsonValue>, sessionId: string) {
  return {
    sessionId,
    ...(stringField(input, "cwd") ? { cwd: stringField(input, "cwd") } : {}),
    ...(stringField(input, "model") ? { model: stringField(input, "model") } : {}),
  };
}

function toolEvent(
  input: Record<string, JsonValue>,
  base: ReturnType<typeof hookBase>,
  type: "tool_started" | "tool_completed",
): CodingAgentAuditEvent | null {
  const toolName = stringField(input, "tool_name");
  const executionId = stringField(input, "tool_use_id") ?? stringField(input, "call_id");
  if (!toolName || !executionId) return null;
  return {
    ...base,
    type,
    executionId,
    toolName,
    input: jsonValue(input.tool_input),
    ...(type === "tool_completed" ? { output: jsonValue(input.tool_response) } : {}),
  };
}

function jsonValue(value: JsonValue | undefined): JsonValue {
  if (value === undefined) return {};
  if (typeof value !== "string") return value;
  return parseJsonValue(value) ?? value;
}
