import { z } from "zod";
import { ChatEventSchema, type ChatEvent } from "../contracts/events.js";

export const ChatKitRealtimeSocketTicketSchema = z.object({
  ticket: z.string().min(1),
  protocol: z.string().min(1),
  expires_at: z.string().min(1),
  websocket_url: z.string().min(1),
});
export type ChatKitRealtimeSocketTicket = z.infer<typeof ChatKitRealtimeSocketTicketSchema>;

export interface WebSocketLike {
  readonly readyState: number;
  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void,
    options?: object,
  ): void;
  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

export async function observeChatKitRealtimeSocket(options: {
  signal: AbortSignal;
  ticket: ChatKitRealtimeSocketTicket;
  afterRevision?: number;
  createWebSocket: WebSocketFactory;
  onReady: (revision: number) => void | Promise<void>;
  onEvent: (event: ChatEvent) => void | Promise<void>;
  onRevision: (revision: number) => void;
  onHealthy: () => void;
}): Promise<void> {
  const url = new URL(options.ticket.websocket_url);
  if (options.afterRevision !== undefined)
    url.searchParams.set("after_revision", String(options.afterRevision));
  const socket = options.createWebSocket(url.toString(), [
    "tilde.chatkit-realtime.v1",
    `${options.ticket.protocol}.${options.ticket.ticket}`,
  ]);

  await new Promise<void>((resolve, reject) => {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let opened = false;
    let settled = false;
    let processing = Promise.resolve();
    const cleanup = (): void => {
      if (heartbeat) clearInterval(heartbeat);
      options.signal.removeEventListener("abort", abort);
      socket.removeEventListener("open", open);
      socket.removeEventListener("message", message);
      socket.removeEventListener("close", close);
      socket.removeEventListener("error", error);
    };
    const abort = (): void => {
      socket.close();
      finish();
    };
    const open = (): void => {
      opened = true;
      heartbeat = setInterval(() => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "ping" }));
      }, 20_000);
    };
    const message = (messageEvent: { data?: unknown }): void => {
      const frame = parseChatKitRealtimeFrame(messageEvent.data);
      if (!frame) return;
      processing = processing
        .then(async () => {
          if (frame.readyRevision !== undefined) {
            await options.onReady(frame.readyRevision);
            options.onRevision(frame.readyRevision);
            options.onHealthy();
          }
          if (frame.event) {
            await options.onEvent(frame.event);
            if (frame.revision !== undefined) options.onRevision(frame.revision);
            options.onHealthy();
          }
        })
        .catch(fail);
    };
    const close = (): void => {
      void processing.then(finish, fail);
    };
    const error = (): void => {
      socket.close();
      if (opened) finish();
      else fail(new Error("ChatKit realtime WebSocket handshake failed"));
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (cause: unknown): void => {
      if (settled) return;
      settled = true;
      socket.close();
      cleanup();
      reject(cause instanceof Error ? cause : new Error("ChatKit realtime event handling failed"));
    };

    options.signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("open", open);
    socket.addEventListener("message", message);
    socket.addEventListener("close", close);
    socket.addEventListener("error", error);
    if (options.signal.aborted) abort();
  });
}

function parseChatKitRealtimeFrame(
  value: unknown,
): { readyRevision?: number; revision?: number; event?: ChatEvent } | undefined {
  if (typeof value !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const frame = parsed as { type?: unknown; cursor?: unknown; event?: unknown; reason?: unknown };
  if (frame.type === "ready")
    return typeof frame.cursor === "number" ? { readyRevision: frame.cursor } : undefined;
  if (frame.type === "pong") return {};
  if (frame.type === "resync_required")
    throw new Error(
      typeof frame.reason === "string" ? frame.reason : "ChatKit realtime resync required",
    );
  if (frame.type !== "event" || typeof frame.cursor !== "number") return undefined;
  const event = ChatEventSchema.safeParse(frame.event);
  return event.success ? { revision: frame.cursor, event: event.data } : undefined;
}
