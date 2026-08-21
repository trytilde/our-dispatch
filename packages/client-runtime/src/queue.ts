import type { QueuedTurn } from "./contracts/queue.js";

/** Returns the latest owner-authored text carried by a queued ChatKit request. */
export function queuedTurnText(turn: QueuedTurn): string {
  const messages = turn.chat_request.messages;
  if (!Array.isArray(messages)) return "Queued agent turn";
  const latest = messages.filter((message) => record(message).role === "user").at(-1);
  return nestedText(record(latest).content ?? record(latest).parts) || "Queued agent turn";
}

function nestedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(nestedText).filter(Boolean).join("\n");
  const item = record(value);
  if (typeof item.text === "string") return item.text;
  const nested = item.content ?? item.parts;
  return nested === undefined ? "" : nestedText(nested);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
