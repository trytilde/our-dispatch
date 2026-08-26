import { z } from "zod";
import type { ChatEvent } from "../contracts/events.js";

export const MissionControlSocketTicketSchema = z.object({
  ticket: z.string().min(1),
  protocol: z.string().min(1),
  expires_at: z.string().min(1),
  websocket_url: z.string().min(1),
});
export type MissionControlSocketTicket = z.infer<typeof MissionControlSocketTicketSchema>;

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

export async function observeMissionControlSocket(options: {
  signal: AbortSignal;
  ticket: MissionControlSocketTicket;
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
    "tilde.mission-control.v1",
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
        if (socket.readyState === 1)
          socket.send(JSON.stringify({ jsonrpc: "2.0", method: "ping", params: {} }));
      }, 20_000);
    };
    const message = (messageEvent: { data?: unknown }): void => {
      const frame = parseMissionControlFrame(messageEvent.data);
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
      else fail(new Error("Mission Control WebSocket handshake failed"));
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
      reject(cause instanceof Error ? cause : new Error("Mission Control event handling failed"));
    };

    options.signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("open", open);
    socket.addEventListener("message", message);
    socket.addEventListener("close", close);
    socket.addEventListener("error", error);
    if (options.signal.aborted) abort();
  });
}

function parseMissionControlFrame(
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
  const frame = parsed as {
    method?: unknown;
    params?: {
      snapshot_revision?: unknown;
      revision?: unknown;
      event_type?: unknown;
      event?: unknown;
    };
  };
  if (frame.method === "mission_control.ready") {
    const revision = frame.params?.snapshot_revision;
    return typeof revision === "number" ? { readyRevision: revision } : undefined;
  }
  if (frame.method === "pong") return {};
  const event = frame.params?.event;
  if (event === undefined) return undefined;
  const revision = frame.params?.revision;
  const type =
    typeof frame.params?.event_type === "string"
      ? frame.params.event_type
      : typeof frame.method === "string"
        ? frame.method
        : "chatkit.event";
  const id =
    event && typeof event === "object" && "id" in event && typeof event.id === "string"
      ? event.id
      : undefined;
  return {
    ...(typeof revision === "number" ? { revision } : {}),
    event: { type, ...(id ? { id } : {}), data: event },
  };
}
