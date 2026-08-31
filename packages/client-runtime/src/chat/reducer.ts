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
  if (event.type === "message.delta") {
    const { session_id: sessionId, message_id: messageId, delta } = event.data;
    if (sessionId !== activeSessionId || !messageId) return { messages: current, streaming: true };
    const deltaKind = findField(delta, "type");
    if (deltaKind === "finish" || deltaKind === "abort")
      return { messages: current, streaming: false };
    if (deltaKind === "error") {
      const text =
        findField(delta, "errorText", "error_text", "error", "message") ||
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
    const textDelta = findTextDelta(delta);
    const toolPart = findToolPart(delta);
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

  if (event.type === "message.created" || event.type === "message.updated") {
    const message = event.data.message;
    if (message.session_id !== activeSessionId) return { messages: current, streaming: false };
    return {
      messages: upsertMessage(current, message),
      streaming: false,
    };
  }
  if (event.type === "message.deleted")
    return {
      messages: current.filter((message) => message.id !== event.data.message_id),
      streaming: false,
    };
  return { messages: current, streaming: false };
}

export function eventStatus(event: ChatEvent): string {
  switch (event.type) {
    case "message.delta":
      return "Streaming response";
    case "message.created":
      return "Message received";
    case "queue_item.enqueued":
      return "Queued";
    case "queue_item.updated":
      return event.data.change === "reordered" ? "Queue reordered" : "Queued message updated";
    case "queue_item.dequeued":
      return "Starting queued message";
    case "queue_item.removed":
      return "Queued message removed";
    case "turn.started":
      return "Agent is working";
    case "turn.completed":
      return "Completed";
    case "turn.failed":
      return "Turn failed";
    case "turn.interrupted":
      return "Interrupted";
    default:
      return "";
  }
}

export function eventBusyState(event: ChatEvent): boolean | undefined {
  if (event.type === "message.delta") {
    const deltaType = findField(event.data.delta, "type").toLowerCase();
    return ["finish", "abort", "error"].includes(deltaType) ? false : true;
  }
  if (event.type === "turn.started" || event.type === "activity.typing.started") return true;
  if (
    event.type === "turn.completed" ||
    event.type === "turn.failed" ||
    event.type === "turn.interrupted" ||
    event.type === "activity.typing.stopped"
  )
    return false;
  return undefined;
}

export function eventName(event: ChatEvent): string {
  return event.type;
}

export function uniqueMessages(messages: ChatMessage[]): ChatMessage[] {
  const chronological = [
    ...new Map(
      messages
        .filter((message) => !isLegacyParticipantLifecycleMessage(message))
        .map((message) => [message.id, message]),
    ).values(),
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

function isLegacyParticipantLifecycleMessage(message: ChatMessage): boolean {
  return (message.parts ?? []).some(
    (part) => part.type === "data" && part.data_type === "tilde.chatkit.participant",
  );
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
