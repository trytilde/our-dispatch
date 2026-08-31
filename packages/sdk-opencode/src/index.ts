import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Client,
  type CodingAgentAuditEvent,
  type JsonValue,
  recordCodingAgentEvent,
} from "@trytilde/sdk";
import { isJsonObject, parseJsonValue, stringField } from "@trytilde/sdk/json";

export function opencodePluginPath(): string {
  return resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "plugin", "tilde-audit.js");
}

export async function recordOpenCodeHook(options: {
  client: Client;
  agentId: string;
  input: unknown;
}): Promise<{ sessionId: string } | null> {
  const event = normalizeOpenCodeHook(options.input);
  if (!event) return null;
  return recordCodingAgentEvent({
    client: options.client,
    agentId: options.agentId,
    source: "opencode",
    event,
  });
}

export function normalizeOpenCodeHook(input: unknown): CodingAgentAuditEvent | null {
  if (!isJsonObject(input)) return null;
  const sessionId = stringField(input, "session_id");
  const hook = stringField(input, "hook_event_name");
  if (!sessionId || !hook) return null;
  const eventId = stringField(input, "event_id");
  const base = {
    sessionId,
    ...(stringField(input, "cwd") ? { cwd: stringField(input, "cwd") } : {}),
    ...(stringField(input, "model") ? { model: stringField(input, "model") } : {}),
    ...(eventId ? { eventId } : {}),
  };
  switch (hook) {
    case "chat.message": {
      const text = stringField(input, "text");
      return text ? { ...base, type: "user_message", text } : null;
    }
    case "experimental.text.complete": {
      const text = stringField(input, "text");
      return text ? { ...base, type: "assistant_message", text } : null;
    }
    case "tool.execute.before":
    case "tool.execute.after": {
      const toolName = stringField(input, "tool_name");
      const executionId = stringField(input, "call_id");
      if (!toolName || !executionId) return null;
      return {
        ...base,
        type: hook === "tool.execute.before" ? "tool_started" : "tool_completed",
        executionId,
        toolName,
        input: jsonValue(input.tool_input),
        ...(hook === "tool.execute.after" ? { output: jsonValue(input.tool_response) } : {}),
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
