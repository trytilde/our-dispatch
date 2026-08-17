export interface Page<T> {
  items: T[];
  next_page_token?: string | null;
}

export interface ChatSession {
  id: string;
  title?: string | null;
  unread?: boolean;
  created_at: string;
  updated_at: string;
  last_user_message_at?: string | null;
}

export interface ChatAgent {
  id: string;
  display_name: string;
  provider_id: string;
  status: string;
  last_message_preview?: string | null;
  last_user_message_at?: string | null;
  sessions: Page<ChatSession>;
}

export interface SidebarResponse extends Page<ChatAgent> {}

export interface ChatPart {
  type: string;
  text?: string | null;
  state?: string | null;
  filename?: string | null;
  media_type?: string;
  mediaType?: string;
  size_bytes?: number | null;
  sizeBytes?: number | null;
  url?: string;
  attachment_id?: string | null;
  attachmentId?: string | null;
  tool_name?: string;
  toolName?: string;
  tool_invocation_id?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  error_text?: string | null;
  errorText?: string | null;
  approval?: unknown;
  title?: string | null;
  source_id?: string;
  data?: unknown;
  provider_metadata?: unknown;
}

export interface ChatMessage {
  id: string;
  type: string;
  role: string;
  session_id: string;
  user_display_name?: string;
  text?: string;
  summary?: string | null;
  data?: Record<string, unknown> | null;
  parts?: ChatPart[];
  created_at: string;
  updated_at?: string;
  metadata?: unknown;
}

export interface Attachment {
  id: string;
  filename?: string | null;
  media_type: string;
  size_bytes?: number | null;
  status: string;
}

interface AttachmentUpload {
  attachment: Attachment;
  upload_url: string;
  upload_headers: Record<string, string>;
}

export interface ChatEvent {
  type: string;
  id?: string;
  data: unknown;
}

export interface QueuedTurn {
  id: string;
  session_id: string;
  queue_position: number;
  status: string;
  chat_request: Record<string, unknown>;
  trigger_message_ids?: string[];
  created_at: string;
}

export type AgentSortOrder = "updated_at" | "created_at" | "manual";
export type SessionSortOrder = "updated_at" | "created_at";

export async function getSidebar(
  query = "",
  agentSort: AgentSortOrder = "updated_at",
  sessionSort: SessionSortOrder = "updated_at",
  nextAgentToken?: string | null,
): Promise<SidebarResponse> {
  const parameters = new URLSearchParams({
    agent_page_size: "50",
    session_page_size: "12",
    agent_sort: agentSort,
    session_sort: sessionSort,
  });
  if (query.trim()) parameters.set("q", query.trim());
  if (nextAgentToken) parameters.set("agent_next_page_token", nextAgentToken);
  return await chatRequest(`mission-control/sidebar?${parameters}`);
}

export async function getAgentSessions(
  agentId: string,
  nextPageToken?: string | null,
  sessionSort: SessionSortOrder = "updated_at",
): Promise<Page<ChatSession>> {
  const parameters = new URLSearchParams({ page_size: "25", session_sort: sessionSort });
  if (nextPageToken) parameters.set("next_page_token", nextPageToken);
  return await chatRequest(
    `mission-control/agents/${encodeURIComponent(agentId)}/sessions?${parameters}`,
  );
}

export async function createSession(agentId: string, title?: string): Promise<ChatSession> {
  const response = await chatRequest<{ session: ChatSession }>(
    `mission-control/agents/${encodeURIComponent(agentId)}/sessions`,
    { method: "POST", body: JSON.stringify({ title: title || null }) },
  );
  return response.session;
}

export async function renameSession(sessionId: string, title: string): Promise<ChatSession> {
  return await chatRequest(`mission-control/sessions/${encodeURIComponent(sessionId)}/rename`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function markSessionUnread(sessionId: string): Promise<ChatSession> {
  return await chatRequest(
    `mission-control/sessions/${encodeURIComponent(sessionId)}/mark-unread`,
    { method: "POST" },
  );
}

export async function interruptSession(sessionId: string): Promise<void> {
  await chatRequest(`mission-control/sessions/${encodeURIComponent(sessionId)}/interrupt`, {
    method: "POST",
  });
}

export async function getMessages(
  sessionId: string,
  nextPageToken?: string | null,
): Promise<Page<ChatMessage>> {
  const parameters = new URLSearchParams({ page_size: "100" });
  if (nextPageToken) parameters.set("next_page_token", nextPageToken);
  return await chatRequest(
    `mission-control/sessions/${encodeURIComponent(sessionId)}/messages?${parameters}`,
  );
}

export async function sendMessage(
  agentId: string,
  sessionId: string,
  text: string,
  attachmentIds: string[],
): Promise<Page<ChatMessage>> {
  return await chatRequest(
    `mission-control/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ text, attachment_ids: attachmentIds }),
    },
  );
}

export async function getQueuedTurns(sessionId: string): Promise<Page<QueuedTurn>> {
  const parameters = new URLSearchParams({
    page_size: "25",
    session_id: sessionId,
    status: "pending",
  });
  return await chatRequest(`agent-turn-queue?${parameters}`);
}

export async function steerQueuedTurn(id: string): Promise<void> {
  await chatRequest(`agent-turn-queue/${encodeURIComponent(id)}/steer`, { method: "POST" });
}

export async function deleteQueuedTurn(id: string): Promise<void> {
  await chatRequest(`agent-turn-queue/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function reorderQueuedTurn(id: string, queuePosition: number): Promise<void> {
  await chatRequest(`agent-turn-queue/${encodeURIComponent(id)}/order`, {
    method: "PATCH",
    body: JSON.stringify({ queue_position: queuePosition }),
  });
}

export async function uploadAttachment(
  sessionId: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<Attachment> {
  const sha256 = await fileSha256(file);
  const created = await chatRequest<AttachmentUpload>(
    `session/${encodeURIComponent(sessionId)}/attachment/upload`,
    {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        media_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        sha256,
      }),
    },
  );
  await uploadFile(
    rewriteTildeUploadUrl(created.upload_url),
    created.upload_headers,
    file,
    onProgress,
  );
  return await chatRequest(
    `session/${encodeURIComponent(sessionId)}/attachment/${encodeURIComponent(created.attachment.id)}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ size_bytes: file.size, sha256 }),
    },
  );
}

export async function deleteAttachment(sessionId: string, attachmentId: string): Promise<void> {
  await chatRequest(
    `session/${encodeURIComponent(sessionId)}/attachment/${encodeURIComponent(attachmentId)}`,
    { method: "DELETE" },
  );
}

export async function getAttachmentDownloadUrl(
  sessionId: string,
  attachmentId: string,
): Promise<string> {
  const response = await chatRequest<{ download_url: string }>(
    `session/${encodeURIComponent(sessionId)}/attachment/${encodeURIComponent(attachmentId)}/download-url`,
  );
  return rewriteTildeUrl(response.download_url);
}

export async function observeSession(
  sessionId: string,
  signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const response = await fetch(
    `/api/chat/session/${encodeURIComponent(sessionId)}/observe?attach_to_child_sessions=true`,
    { headers: { accept: "text/event-stream" }, signal },
  );
  if (!response.ok || !response.body) throw await responseError(response);

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

export function rewriteTildeUrl(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    if (!url.pathname.startsWith("/api/v1/")) return url.toString();
    const rootMarker = "/api/v1/chatkit/";
    const rootIndex = url.pathname.indexOf(rootMarker);
    if (rootIndex >= 0) {
      return `/api/chat/${rootChatKitPrefix}${url.pathname.slice(rootIndex + rootMarker.length)}${url.search}`;
    }
    const teamMarker = "/chatkit/";
    const teamIndex = url.pathname.indexOf(teamMarker);
    if (teamIndex >= 0) {
      return `/api/chat/${url.pathname.slice(teamIndex + teamMarker.length)}${url.search}`;
    }
    return url.toString();
  } catch {
    return value;
  }
}

function rewriteTildeUploadUrl(value: string): string {
  const rewritten = rewriteTildeUrl(value);
  if (rewritten.startsWith("/api/chat/")) return rewritten;
  try {
    const url = new URL(rewritten);
    if (url.protocol === "https:" && url.hostname.endsWith(".r2.cloudflarestorage.com")) {
      return `/api/chat/_upload?url=${encodeURIComponent(url.toString())}`;
    }
  } catch {
    // The upload helper will surface an actionable request failure.
  }
  return rewritten;
}

const rootChatKitPrefix = "_root/";

async function chatRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  const response = await fetch(`/api/chat/${path}`, { ...init, headers });
  if (!response.ok) throw await responseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: string; detail?: string; message?: string }
    | undefined;
  return new Error(
    body?.detail ??
      body?.message ??
      body?.error ??
      `Tilde chat request failed (${response.status})`,
  );
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uploadFile(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
      request.setRequestHeader("content-type", file.type || "application/octet-stream");
    }
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Attachment upload failed (${request.status})`));
    });
    request.addEventListener("error", () => reject(new Error("Attachment upload failed")));
    request.addEventListener("abort", () =>
      reject(new DOMException("Upload aborted", "AbortError")),
    );
    request.send(file);
  });
}

function parseSseFrame(frame: string): ChatEvent | undefined {
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
    // Text events are valid SSE payloads.
  }
  return { type, id, data: parsed };
}
