import { createHash, randomUUID } from "node:crypto";
import type { Client } from "../client";
import type { JsonObject, JsonValue } from "../tools";
import type { ChatKitSessionParticipant, ChatKitSessionWithParticipants } from "./index";

export type CodingAgentSource = "codex" | "claude-code" | "cursor" | "opencode" | "gemini-cli";

type CodingAgentEventBase = {
  sessionId: string;
  cwd?: string;
  model?: string;
  eventId?: string;
};

export type CodingAgentAuditEvent =
  | (CodingAgentEventBase & { type: "session_started" })
  | (CodingAgentEventBase & { type: "session_ended" })
  | (CodingAgentEventBase & { type: "user_message"; text: string })
  | (CodingAgentEventBase & { type: "assistant_message"; text: string })
  | (CodingAgentEventBase & {
      type: "tool_started" | "tool_completed" | "tool_failed";
      executionId: string;
      toolName: string;
      input: JsonValue;
      output?: JsonValue;
      errorMessage?: string;
      startedAt?: string;
      completedAt?: string;
    });

export type RecordCodingAgentEventOptions = {
  client: Client;
  agentId: string;
  source: CodingAgentSource;
  event: CodingAgentAuditEvent;
};

export async function recordCodingAgentEvent(
  options: RecordCodingAgentEventOptions,
): Promise<{ sessionId: string }> {
  const { client, agentId, source, event } = options;
  const session = await client.chatkit.createAgentSession({
    agentId,
    lookupKey: codingAgentSessionLookupKey(source, event.sessionId),
    title: codingAgentSessionTitle(source, event.cwd),
  });
  const sessionId = requiredSessionId(session);

  if (event.type === "session_started" || event.type === "session_ended") {
    return { sessionId };
  }
  if (event.type === "user_message" || event.type === "assistant_message") {
    if (event.text.trim().length === 0) return { sessionId };
    const { from, to } = messageParticipants(session, event.type);
    await client.chatkit.createMessage({
      id: event.eventId ? deterministicUuid(event.eventId) : randomUUID(),
      sessionId,
      fromInboxId: requiredParticipantInboxId(from),
      fromInboxInstanceId: requiredParticipantInstanceId(from),
      toInboxId: requiredParticipantInboxId(to),
      toInboxInstanceId: requiredParticipantInstanceId(to),
      role: event.type === "user_message" ? "user" : "assistant",
      displayName: event.type === "user_message" ? "User" : sourceDisplayName(source),
      text: event.text,
      metadata: eventMetadata(source, event),
    });
    return { sessionId };
  }

  const state =
    event.type === "tool_started"
      ? "started"
      : event.type === "tool_completed"
        ? "completed"
        : "failed";
  await client.chatkit.reportToolExecution({
    agentId,
    executionId: `${source}:${event.sessionId}:${event.executionId}`,
    sessionId,
    toolId: codingAgentToolId(source, event.toolName),
    wireName: event.toolName,
    tool: {
      displayName: event.toolName,
      identity: {
        codingAgentSource: source,
        codingAgentToolName: event.toolName,
      },
    },
    state,
    input: event.input,
    output: event.output,
    errorMessage: state === "failed" ? (event.errorMessage ?? "Tool execution failed") : undefined,
    startedAt: event.startedAt,
    completedAt: event.completedAt,
  });
  return { sessionId };
}

export function codingAgentSessionLookupKey(
  source: CodingAgentSource,
  sourceSessionId: string,
): string {
  return `coding-agent:${source}:${sourceSessionId}`;
}

export function codingAgentToolId(source: CodingAgentSource, toolName: string): string {
  return `coding-agent:${source}:${toolName}`;
}

function codingAgentSessionTitle(source: CodingAgentSource, cwd?: string): string {
  const location = cwd?.split(/[\\/]/).filter(Boolean).at(-1);
  return location
    ? `${sourceDisplayName(source)} · ${location}`
    : `${sourceDisplayName(source)} session`;
}

function sourceDisplayName(source: CodingAgentSource): string {
  switch (source) {
    case "codex":
      return "Codex";
    case "claude-code":
      return "Claude Code";
    case "cursor":
      return "Cursor";
    case "opencode":
      return "OpenCode";
    case "gemini-cli":
      return "Gemini CLI";
  }
}

function requiredSessionId(session: ChatKitSessionWithParticipants): string {
  const id = session.session.id;
  if (!id) throw new TypeError("Tilde ChatKit session response did not include session.id");
  return id;
}

function messageParticipants(
  session: ChatKitSessionWithParticipants,
  type: "user_message" | "assistant_message",
): { from: ChatKitSessionParticipant; to: ChatKitSessionParticipant } {
  const human = session.participants.find(
    (participant) => participant.participant_type === "human",
  );
  const agent = session.participants.find(
    (participant) => participant.participant_type === "agent",
  );
  if (!human || !agent) {
    throw new TypeError("Tilde coding-agent session requires human and agent participants");
  }
  return type === "user_message" ? { from: human, to: agent } : { from: agent, to: human };
}

function requiredParticipantInboxId(participant: ChatKitSessionParticipant): string {
  const id = participant.inbox?.id;
  if (!id) throw new TypeError("Tilde ChatKit participant did not include inbox.id");
  return id;
}

function requiredParticipantInstanceId(participant: ChatKitSessionParticipant): string {
  const id = participant.instance?.id;
  if (!id) throw new TypeError("Tilde ChatKit participant did not include instance.id");
  return id;
}

function eventMetadata(source: CodingAgentSource, event: CodingAgentEventBase): JsonObject {
  return {
    codingAgentSource: source,
    codingAgentSessionId: event.sessionId,
    ...(event.cwd ? { cwd: event.cwd } : {}),
    ...(event.model ? { model: event.model } : {}),
  };
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
