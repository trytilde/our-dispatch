import { SessionEventSchema, type SessionEvent } from "../contracts/events.js";

export function parseSseFrame(frame: string): SessionEvent | undefined {
  let type = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") type = value;
    else if (field === "id") id = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return undefined;
  const serialized = data.join("\n");
  let parsed: unknown = serialized;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    // Text payloads are valid SSE data.
  }
  return SessionEventSchema.parse({ type, ...(id ? { id } : {}), data: parsed });
}

export async function consumeSse(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: SessionEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("The chat event stream did not include a response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event) onEvent(event);
    }
    if (done) break;
  }
}
