import type { ChatEvent } from "../contracts/events.js";
import type { ChatMessage, ChatPart } from "../contracts/messages.js";

export interface LiveMessageReduction {
  messages: ChatMessage[];
  streaming: boolean;
}

export function reduceLiveChatEvent(
  current: ChatMessage[],
  event: ChatEvent,
  activeSessionId: string,
  now = new Date(),
): LiveMessageReduction {
  const kind = event.type.toLowerCase();
  const payload =
    eventKindPayload(event.data, "message_streaming") ??
    eventKindPayload(event.data, "MessageStreaming") ??
    (kind.includes("message_streaming") || kind.includes("message.streaming")
      ? record(event.data)
      : undefined);
  if (payload) {
    const sessionId = firstString(payload, "session_id", "sessionId") || activeSessionId;
    const messageId = firstString(payload, "message_id", "messageId");
    if (sessionId !== activeSessionId || !messageId) return { messages: current, streaming: true };
    const deltaKind = findField(payload.delta ?? payload, "type");
    if (deltaKind === "finish" || deltaKind === "abort")
      return { messages: current, streaming: false };
    if (deltaKind === "error") {
      const text =
        findField(payload.delta ?? payload, "errorText", "error_text", "error", "message") ||
        "The agent failed to respond.";
      return {
        messages: upsertMessage(current, {
          id: `agent-stream-error:${messageId}`,
          type: "text",
          role: "assistant",
          session_id: sessionId,
          user_display_name: "Agent",
          text,
          created_at: now.toISOString(),
        }),
        streaming: false,
      };
    }
    const textDelta = findTextDelta(payload);
    const toolPart = findToolPart(payload);
    if (!textDelta && !toolPart) return { messages: current, streaming: true };
    const index = current.findIndex((message) => message.id === messageId);
    if (index < 0) {
      return {
        messages: uniqueMessages([
          ...current,
          {
            id: messageId,
            type: "ui",
            role: "assistant",
            session_id: sessionId,
            user_display_name: "Agent",
            parts: [
              ...(textDelta ? [{ type: "text", text: textDelta }] : []),
              ...(toolPart ? [toolPart] : []),
            ],
            created_at: now.toISOString(),
          },
        ]),
        streaming: true,
      };
    }
    return {
      messages: current.map((message, messageIndex) =>
        messageIndex === index
          ? {
              ...message,
              type: "ui",
              parts: mergeStreamingParts(message.parts ?? [], textDelta, toolPart),
              updated_at: now.toISOString(),
            }
          : message,
      ),
      streaming: true,
    };
  }

  const createdPayload =
    eventKindPayload(event.data, "message_created") ??
    eventKindPayload(event.data, "MessageCreated") ??
    (kind.includes("message_created") || kind.includes("message.created")
      ? record(event.data)
      : undefined);
  const created = record(createdPayload?.message ?? createdPayload);
  if (
    typeof created.id === "string" &&
    created.session_id === activeSessionId &&
    typeof created.type === "string" &&
    typeof created.role === "string" &&
    typeof created.created_at === "string"
  ) {
    return {
      messages: upsertMessage(current, created as unknown as ChatMessage),
      streaming: false,
    };
  }
  return { messages: current, streaming: false };
}

export function eventStatus(event: ChatEvent): string {
  const kind = eventName(event);
  const data = record(event.data);
  if (kind.includes("turn") || kind.includes("status")) {
    const status = stringValue(data.status) || stringValue(record(data.payload).status);
    return status ? humanEventName(status) : humanEventName(event.type);
  }
  if (kind.includes("streaming")) return "Streaming response";
  if (kind.includes("queued")) return "Queued";
  if (kind.includes("message.created")) return "Message received";
  return "";
}

export function eventBusyState(event: ChatEvent): boolean | undefined {
  const kind = normalizedEventName(event);
  const data = record(event.data);
  // Streaming deltas arrive either flat on `data` or nested under `data.kind.message_streaming`,
  // so resolve the payload the same way the reducer does before reading its delta type.
  const streaming =
    eventKindPayload(event.data, "message_streaming") ??
    eventKindPayload(event.data, "MessageStreaming") ??
    (kind.includes("message.streaming") ? data : undefined);
  if (streaming) {
    const deltaType = findField(streaming.delta ?? streaming, "type").toLowerCase();
    return ["finish", "abort", "error"].includes(deltaType) ? false : true;
  }
  const deltaType = findField(data, "type").toLowerCase();
  if (["finish", "abort", "error"].includes(deltaType)) return false;
  const status = (
    firstString(data, "status") ||
    firstString(record(data.payload), "status") ||
    firstString(record(data.kind), "status")
  ).toLowerCase();
  if (
    /^(idle|complete|completed|finished|failed|error|aborted|cancelled|canceled|interrupted)$/.test(
      status,
    )
  )
    return false;
  if (/^(busy|working|running|streaming|typing|queued|pending|starting|in_progress)$/.test(status))
    return true;
  if (kind.includes("turn.started")) return true;
  if (kind.includes("turn.completed") || kind.includes("turn.failed")) return false;
  return undefined;
}

/** Tilde names events with underscores; the checks below read as dotted paths. */
function normalizedEventName(event: ChatEvent): string {
  return eventName(event).toLowerCase().replaceAll("_", ".");
}

export function eventName(event: ChatEvent): string {
  const nestedKind = record(record(event.data).kind);
  const named = firstString(nestedKind, "kind") || Object.keys(nestedKind)[0] || event.type;
  return named
    .replace(/([a-z0-9])([A-Z])/g, "$1.$2")
    .toLowerCase()
    .replaceAll("_", ".");
}

export function uniqueMessages(messages: ChatMessage[]): ChatMessage[] {
  const chronological = [
    ...new Map(messages.map((message) => [message.id, message])).values(),
  ].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  const ids = new Set(chronological.map((message) => message.id));
  const replies = new Map<string, ChatMessage[]>();
  for (const message of chronological) {
    const parentId = message.in_reply_to_message_id;
    if (!parentId || !ids.has(parentId)) continue;
    replies.set(parentId, [...(replies.get(parentId) ?? []), message]);
  }
  const ordered: ChatMessage[] = [];
  const visited = new Set<string>();
  const append = (message: ChatMessage): void => {
    if (visited.has(message.id)) return;
    visited.add(message.id);
    ordered.push(message);
    for (const reply of replies.get(message.id) ?? []) append(reply);
  };
  for (const message of chronological)
    if (!message.in_reply_to_message_id || !ids.has(message.in_reply_to_message_id))
      append(message);
  for (const message of chronological) append(message);
  return ordered;
}

export function messageText(message: ChatMessage): string {
  if (message.text) return message.text;
  return (message.parts ?? []).map((part) => part.text || "").join("");
}

export function latestMessagePreview(messages: readonly ChatMessage[]): string {
  const latest = [...messages]
    .filter((message) => message.type !== "signal")
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
    .at(-1);
  if (!latest) return "";
  const value =
    latest.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join(" ") ||
    latest.text ||
    latest.summary ||
    "";
  const text = value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text) return text;
  const attachment = latest.parts?.find((part) => part.type === "file" || part.type === "image");
  return attachment?.filename ? `Sent ${attachment.filename}` : "";
}

function mergeStreamingParts(
  parts: ChatPart[],
  textDelta: string,
  toolPart: ChatPart | undefined,
): ChatPart[] {
  let next = parts;
  if (textDelta) {
    const lastTextIndex = next.findLastIndex((part) => part.type === "text");
    next =
      lastTextIndex < 0
        ? [...next, { type: "text", text: textDelta }]
        : next.map((part, index) =>
            index === lastTextIndex ? { ...part, text: `${part.text ?? ""}${textDelta}` } : part,
          );
  }
  if (toolPart) {
    const toolIndex = next.findIndex(
      (part) => part.type === "tool" && part.tool_invocation_id === toolPart.tool_invocation_id,
    );
    next =
      toolIndex < 0
        ? [...next, toolPart]
        : next.map((part, index) => (index === toolIndex ? { ...part, ...toolPart } : part));
  }
  return next;
}

function upsertMessage(current: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const withoutOptimistic = current.filter(
    (candidate) =>
      !(
        candidate.id.startsWith("optimistic-") &&
        candidate.role === message.role &&
        messageText(candidate) === messageText(message)
      ),
  );
  const index = withoutOptimistic.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return uniqueMessages([...withoutOptimistic, message]);
  return withoutOptimistic.map((candidate, candidateIndex) =>
    candidateIndex === index ? message : candidate,
  );
}

function eventKindPayload(value: unknown, key: string): Record<string, unknown> | undefined {
  const event = record(value);
  const kind = record(event.kind);
  if (kind.kind === key) return kind;
  const payload = kind[key];
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : undefined;
}

function findTextDelta(value: unknown, depth = 0): string {
  if (depth > 6) return "";
  const item = record(value);
  const type = firstString(item, "type", "delta_type", "deltaType");
  if (
    (type === "text-delta" || type === "text_delta" || type === "text") &&
    typeof item.delta === "string"
  )
    return item.delta;
  if ((type === "text-delta" || type === "text_delta") && typeof item.text === "string")
    return item.text;
  for (const key of ["delta", "ui", "Ui", "text", "Text", "value", "payload"]) {
    if (typeof item[key] === "object" && item[key] !== null) {
      const found = findTextDelta(item[key], depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function findToolPart(value: unknown, depth = 0): ChatPart | undefined {
  if (depth > 6) return undefined;
  const item = record(value);
  const type = firstString(item, "type");
  if (type === "dynamic-tool" || type.startsWith("tool-")) {
    const toolName =
      firstString(item, "toolName", "tool_name") ||
      (type.startsWith("tool-") ? type.slice(5) : "tool");
    const toolInvocationId = firstString(item, "toolCallId", "tool_call_id", "id") || toolName;
    return {
      type: "tool",
      tool_name: toolName,
      tool_invocation_id: toolInvocationId,
      state: toolState(type, firstString(item, "state")),
      input: item.input,
      output: item.output,
      error_text: firstString(item, "errorText", "error_text", "error", "message") || undefined,
    };
  }
  for (const key of ["delta", "ui", "Ui", "value", "payload", "part"]) {
    if (typeof item[key] === "object" && item[key] !== null) {
      const found = findToolPart(item[key], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function toolState(type: string, explicit: string): string {
  if (explicit) return explicit;
  if (type === "tool-input-start" || type === "tool-input-delta") return "input-streaming";
  if (type === "tool-input-available") return "input-available";
  if (type === "tool-output-available") return "output-available";
  if (type === "tool-output-error") return "output-error";
  return "input-available";
}

function findField(value: unknown, ...keys: string[]): string {
  const item = record(value);
  const direct = firstString(item, ...keys);
  if (direct) return direct;
  for (const key of ["delta", "ui", "Ui", "value", "payload"]) {
    if (typeof item[key] === "object" && item[key] !== null) {
      const found = findField(item[key], ...keys);
      if (found) return found;
    }
  }
  return "";
}

function firstString(value: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) if (typeof value[key] === "string") return value[key];
  return "";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function humanEventName(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
