import { z } from "zod";
import {
  AttachmentDownloadSchema,
  AttachmentSchema,
  AttachmentUploadSchema,
  type Attachment,
  type AttachmentUpload,
  type CreateAttachmentInput,
} from "../contracts/attachments.js";
import { AuthenticatedSessionSchema, type AuthenticatedSession } from "../contracts/auth.js";
import {
  ConnectorAccountPageSchema,
  ConnectorProviderPageSchema,
  CreateConnectorAccountResultSchema,
  type ConnectorAccount,
  type ConnectorProvider,
  type CreateConnectorAccountInput,
  type CreateConnectorAccountResult,
} from "../contracts/connectors.js";
import type { ChatEvent } from "../contracts/events.js";
import {
  PluginMutationResultSchema,
  PluginsCatalogSchema,
  type PluginsCatalog,
} from "../contracts/plugins.js";
import {
  AgentSetupStartedSchema,
  AgentSetupStatusSchema,
  type AgentSetupStarted,
  type AgentSetupStatus,
} from "../contracts/agents.js";
import { ChatMessagePageSchema, type ChatMessagePage } from "../contracts/messages.js";
import { QueuedTurnPageSchema, type QueuedTurnPage } from "../contracts/queue.js";
import {
  ChatSessionPageSchema,
  ChatSessionSchema,
  SidebarResponseSchema,
  type AgentSortOrder,
  type ChatSession,
  type ChatSessionPage,
  type SessionSortOrder,
  type SidebarResponse,
} from "../contracts/sidebar.js";
import { ClientRequestError } from "../errors.js";
import { consumeSse } from "./sse.js";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OpenBotClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  getAccessToken?: () => Promise<string | undefined>;
}

export interface OpenBotClient {
  getSession(): Promise<AuthenticatedSession | null>;
  logout(): Promise<void>;
  startAgentSetup(name: string): Promise<AgentSetupStarted>;
  getAgentSetup(jobId: string): Promise<AgentSetupStatus>;
  getSidebar(
    query?: string,
    agentSort?: AgentSortOrder,
    sessionSort?: SessionSortOrder,
    nextAgentToken?: string | null,
  ): Promise<SidebarResponse>;
  getAgentSessions(
    agentId: string,
    nextPageToken?: string | null,
    sessionSort?: SessionSortOrder,
  ): Promise<ChatSessionPage>;
  createSession(agentId: string, title?: string): Promise<ChatSession>;
  renameSession(sessionId: string, title: string): Promise<ChatSession>;
  markSessionUnread(sessionId: string): Promise<ChatSession>;
  interruptSession(sessionId: string): Promise<void>;
  getMessages(sessionId: string, nextPageToken?: string | null): Promise<ChatMessagePage>;
  sendMessage(
    agentId: string,
    sessionId: string,
    text: string,
    attachmentIds?: string[],
  ): Promise<ChatMessagePage>;
  observeMissionControl(signal: AbortSignal, onEvent: (event: ChatEvent) => void): Promise<void>;
  observeSession(
    sessionId: string,
    signal: AbortSignal,
    onEvent: (event: ChatEvent) => void,
  ): Promise<void>;
  getQueuedTurns(sessionId: string): Promise<QueuedTurnPage>;
  steerQueuedTurn(id: string): Promise<void>;
  deleteQueuedTurn(id: string): Promise<void>;
  reorderQueuedTurn(id: string, queuePosition: number): Promise<void>;
  listConnectorProviders(): Promise<ConnectorProvider[]>;
  listConnectorAccounts(providerTypeId?: string): Promise<ConnectorAccount[]>;
  createConnectorAccount(input: CreateConnectorAccountInput): Promise<CreateConnectorAccountResult>;
  getPluginsCatalog(agentIds: readonly string[]): Promise<PluginsCatalog>;
  setToolAccountForAgent(accountId: string, agentId: string, enabled: boolean): Promise<void>;
  setSkillForAgent(skillId: string, agentId: string, enabled: boolean): Promise<void>;
  createAttachment(sessionId: string, input: CreateAttachmentInput): Promise<AttachmentUpload>;
  completeAttachment(
    sessionId: string,
    attachmentId: string,
    input: Pick<CreateAttachmentInput, "sizeBytes" | "sha256">,
  ): Promise<Attachment>;
  deleteAttachment(sessionId: string, attachmentId: string): Promise<void>;
  getAttachmentDownloadUrl(sessionId: string, attachmentId: string): Promise<string>;
  rewriteTildeUrl(value: string): string;
  rewriteTildeUploadUrl(value: string): string;
}

const SessionEnvelopeSchema = z.object({ session: ChatSessionSchema });
const ErrorBodySchema = z.object({
  error: z.string().optional(),
  detail: z.string().optional(),
  message: z.string().optional(),
});

export function createOpenBotClient(options: OpenBotClientOptions = {}): OpenBotClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";

  const resolve = (path: string): string => `${baseUrl}${path}`;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const accessToken = await options.getAccessToken?.();
    if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
    return await fetchImplementation(resolve(path), { ...init, headers });
  }

  async function json<Schema extends z.ZodType>(
    path: string,
    schema: Schema,
    init: RequestInit = {},
  ): Promise<z.infer<Schema>> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    headers.set("accept", "application/json");
    const response = await request(path, { ...init, headers });
    if (!response.ok) throw await responseError(response);
    return schema.parse(await response.json());
  }

  async function empty(path: string, init: RequestInit = {}): Promise<void> {
    const response = await request(path, init);
    if (!response.ok) throw await responseError(response);
  }

  function chatPath(path: string): string {
    return `/api/chat/${path}`;
  }

  function rewriteTildeUrl(value: string): string {
    try {
      const url = new URL(value, baseUrl || "http://openbot.local");
      if (!url.pathname.startsWith("/api/v1/")) return value;
      const rootMarker = "/api/v1/chatkit/";
      const rootIndex = url.pathname.indexOf(rootMarker);
      if (rootIndex >= 0) {
        return resolve(
          chatPath(`_root/${url.pathname.slice(rootIndex + rootMarker.length)}${url.search}`),
        );
      }
      const teamMarker = "/chatkit/";
      const teamIndex = url.pathname.indexOf(teamMarker);
      return teamIndex >= 0
        ? resolve(chatPath(`${url.pathname.slice(teamIndex + teamMarker.length)}${url.search}`))
        : value;
    } catch {
      return value;
    }
  }

  function rewriteTildeUploadUrl(value: string): string {
    const rewritten = rewriteTildeUrl(value);
    if (
      rewritten.startsWith("/api/chat/") ||
      (baseUrl && rewritten.startsWith(`${baseUrl}/api/chat/`))
    )
      return rewritten;
    try {
      const url = new URL(rewritten);
      if (url.protocol === "https:" && url.hostname.endsWith(".r2.cloudflarestorage.com"))
        return resolve(chatPath(`_upload?url=${encodeURIComponent(url.toString())}`));
    } catch {
      // The platform upload adapter will report the request failure.
    }
    return rewritten;
  }

  return {
    async getSession() {
      const response = await request("/auth/session", { headers: { accept: "application/json" } });
      if (response.status === 401) return null;
      if (!response.ok) throw await responseError(response);
      return AuthenticatedSessionSchema.parse(await response.json());
    },
    logout: () => empty("/auth/logout", { method: "POST" }),
    async startAgentSetup(name) {
      return await json("/api/agents", AgentSetupStartedSchema, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    },
    async getAgentSetup(jobId) {
      return await json(`/api/agents/setup/${encodeURIComponent(jobId)}`, AgentSetupStatusSchema);
    },
    async getSidebar(
      query = "",
      agentSort = "updated_at",
      sessionSort = "updated_at",
      nextAgentToken,
    ) {
      const parameters = new URLSearchParams({
        agent_page_size: "50",
        session_page_size: "12",
        agent_sort: agentSort,
        session_sort: sessionSort,
      });
      if (query.trim()) parameters.set("q", query.trim());
      if (nextAgentToken) parameters.set("agent_next_page_token", nextAgentToken);
      return await json(chatPath(`mission-control/sidebar?${parameters}`), SidebarResponseSchema);
    },
    async getAgentSessions(agentId, nextPageToken, sessionSort = "updated_at") {
      const parameters = new URLSearchParams({ page_size: "25", session_sort: sessionSort });
      if (nextPageToken) parameters.set("next_page_token", nextPageToken);
      return await json(
        chatPath(`mission-control/agents/${encodeURIComponent(agentId)}/sessions?${parameters}`),
        ChatSessionPageSchema,
      );
    },
    async createSession(agentId, title) {
      const response = await json(
        chatPath(`mission-control/agents/${encodeURIComponent(agentId)}/sessions`),
        SessionEnvelopeSchema,
        { method: "POST", body: JSON.stringify({ title: title || null }) },
      );
      return response.session;
    },
    renameSession: (sessionId, title) =>
      json(
        chatPath(`mission-control/sessions/${encodeURIComponent(sessionId)}/rename`),
        ChatSessionSchema,
        {
          method: "PATCH",
          body: JSON.stringify({ title }),
        },
      ),
    markSessionUnread: (sessionId) =>
      json(
        chatPath(`mission-control/sessions/${encodeURIComponent(sessionId)}/mark-unread`),
        ChatSessionSchema,
        { method: "POST" },
      ),
    interruptSession: (sessionId) =>
      empty(chatPath(`mission-control/sessions/${encodeURIComponent(sessionId)}/interrupt`), {
        method: "POST",
      }),
    async getMessages(sessionId, nextPageToken) {
      const parameters = new URLSearchParams({ page_size: "100" });
      if (nextPageToken) parameters.set("next_page_token", nextPageToken);
      return await json(
        chatPath(
          `mission-control/sessions/${encodeURIComponent(sessionId)}/messages?${parameters}`,
        ),
        ChatMessagePageSchema,
      );
    },
    sendMessage: (agentId, sessionId, text, attachmentIds = []) =>
      json(
        chatPath(
          `mission-control/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
        ),
        ChatMessagePageSchema,
        { method: "POST", body: JSON.stringify({ text, attachment_ids: attachmentIds }) },
      ),
    async observeMissionControl(signal, onEvent) {
      const response = await request(chatPath("mission-control/events"), {
        headers: { accept: "text/event-stream" },
        signal,
      });
      if (!response.ok) throw await responseError(response);
      await consumeSse(response, signal, onEvent);
    },
    async observeSession(sessionId, signal, onEvent) {
      const response = await request(
        chatPath(`session/${encodeURIComponent(sessionId)}/observe?attach_to_child_sessions=true`),
        { headers: { accept: "text/event-stream" }, signal },
      );
      if (!response.ok) throw await responseError(response);
      await consumeSse(response, signal, onEvent);
    },
    getQueuedTurns: (sessionId) => {
      const parameters = new URLSearchParams({
        page_size: "25",
        session_id: sessionId,
        status: "pending",
      });
      return json(chatPath(`agent-turn-queue?${parameters}`), QueuedTurnPageSchema);
    },
    steerQueuedTurn: (id) =>
      empty(chatPath(`agent-turn-queue/${encodeURIComponent(id)}/steer`), { method: "POST" }),
    deleteQueuedTurn: (id) =>
      empty(chatPath(`agent-turn-queue/${encodeURIComponent(id)}`), { method: "DELETE" }),
    reorderQueuedTurn: (id, queuePosition) =>
      empty(chatPath(`agent-turn-queue/${encodeURIComponent(id)}/order`), {
        method: "PATCH",
        body: JSON.stringify({ queue_position: queuePosition }),
        headers: { "content-type": "application/json" },
      }),
    async listConnectorProviders() {
      const response = await json("/api/connectors/providers", ConnectorProviderPageSchema);
      return response.items;
    },
    async listConnectorAccounts(providerTypeId) {
      const parameters = new URLSearchParams();
      if (providerTypeId) parameters.set("provider", providerTypeId);
      const query = parameters.size > 0 ? `?${parameters}` : "";
      const response = await json(`/api/connectors/accounts${query}`, ConnectorAccountPageSchema);
      return response.items;
    },
    createConnectorAccount: (input) =>
      json("/api/connectors/accounts", CreateConnectorAccountResultSchema, {
        method: "POST",
        body: JSON.stringify({
          provider_type_id: input.providerTypeId,
          credential_source_type_id: input.credentialSourceTypeId,
          display_name: input.displayName,
          resource_server_values: input.resourceServerValues ?? null,
          user_credential_values: input.userCredentialValues ?? null,
          return_url: input.returnUrl ?? null,
        }),
      }),
    getPluginsCatalog(agentIds) {
      const parameters = new URLSearchParams();
      for (const agentId of agentIds) parameters.append("agent_id", agentId);
      const query = parameters.size > 0 ? `?${parameters}` : "";
      return json(`/api/plugins${query}`, PluginsCatalogSchema);
    },
    async setToolAccountForAgent(accountId, agentId, enabled) {
      await json(
        `/api/plugins/tools/${encodeURIComponent(accountId)}/agents/${encodeURIComponent(agentId)}`,
        PluginMutationResultSchema,
        { method: enabled ? "POST" : "DELETE" },
      );
    },
    async setSkillForAgent(skillId, agentId, enabled) {
      await json(
        `/api/plugins/skills/${encodeURIComponent(skillId)}/agents/${encodeURIComponent(agentId)}`,
        PluginMutationResultSchema,
        { method: enabled ? "POST" : "DELETE" },
      );
    },
    createAttachment: (sessionId, input) =>
      json(
        chatPath(`session/${encodeURIComponent(sessionId)}/attachment/upload`),
        AttachmentUploadSchema,
        {
          method: "POST",
          body: JSON.stringify({
            filename: input.filename,
            media_type: input.mediaType,
            size_bytes: input.sizeBytes,
            sha256: input.sha256,
          }),
        },
      ),
    completeAttachment: (sessionId, attachmentId, input) =>
      json(
        chatPath(
          `session/${encodeURIComponent(sessionId)}/attachment/${encodeURIComponent(attachmentId)}/complete`,
        ),
        AttachmentSchema,
        {
          method: "POST",
          body: JSON.stringify({ size_bytes: input.sizeBytes, sha256: input.sha256 }),
        },
      ),
    deleteAttachment: (sessionId, attachmentId) =>
      empty(
        chatPath(
          `session/${encodeURIComponent(sessionId)}/attachment/${encodeURIComponent(attachmentId)}`,
        ),
        { method: "DELETE" },
      ),
    async getAttachmentDownloadUrl(sessionId, attachmentId) {
      const response = await json(
        chatPath(
          `session/${encodeURIComponent(sessionId)}/attachment/${encodeURIComponent(attachmentId)}/download-url`,
        ),
        AttachmentDownloadSchema,
      );
      return rewriteTildeUrl(response.download_url);
    },
    rewriteTildeUrl,
    rewriteTildeUploadUrl,
  };
}

async function responseError(response: Response): Promise<ClientRequestError> {
  const parsed = ErrorBodySchema.safeParse(await response.json().catch(() => undefined));
  const body = parsed.success ? parsed.data : undefined;
  return new ClientRequestError(
    body?.detail ?? body?.message ?? body?.error ?? `OpenBot request failed (${response.status})`,
    response.status,
  );
}
