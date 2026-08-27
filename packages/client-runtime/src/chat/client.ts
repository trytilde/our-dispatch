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
import {
  ConversationSnapshotSchema,
  ChatKitSearchPageSchema,
  ChatKitActivitySchema,
  SubmitTurnResponseSchema,
  type ConversationSnapshot,
  type ChatKitSearchPage,
  type ChatKitActivity,
  type SubmitTurnInput,
  type SubmitTurnResponse,
} from "../contracts/mission-control.js";
import {
  RoutineListSchema,
  RunRoutineResponseSchema,
  type CreateRoutineInput,
  type Routine,
  type RoutineTriggerSpec,
  type UpdateRoutineInput,
} from "../contracts/routines.js";
import {
  DeleteSignalInstanceResultSchema,
  SignalDeliveryListSchema,
  SignalInstanceListSchema,
  SignalInstanceSchema,
  SignalProviderListSchema,
  TestSignalInstanceResultSchema,
  type CreateSignalInstanceInput,
  type SignalDelivery,
  type SignalInstance,
  type SignalProvider,
  type TestSignalInstanceInput,
  type TestSignalInstanceResult,
  type UpdateSignalInstanceInput,
} from "../contracts/signals.js";
import { QueuedTurnPageSchema, type QueuedTurnPage } from "../contracts/queue.js";
import {
  ChatSessionPageSchema,
  ChatSessionSchema,
  type AgentSortOrder,
  type ChatSession,
  type ChatSessionPage,
  type SessionSortOrder,
  type SidebarResponse,
} from "../contracts/sidebar.js";
import { ClientRequestError } from "../errors.js";
import {
  MissionControlSocketTicketSchema,
  observeMissionControlSocket,
  type WebSocketFactory,
  type WebSocketLike,
} from "./websocket.js";
import { consumeSse } from "./sse.js";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OpenBotClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  getAccessToken?: () => Promise<string | undefined>;
  createWebSocket?: WebSocketFactory;
  /** Browser by default. Native adapters must opt into Origin-free socket tickets. */
  missionControlTransport?: "browser" | "native";
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
  getActivity(activeSessionId?: string): Promise<ChatKitActivity>;
  getConversationSnapshot(sessionId: string): Promise<ConversationSnapshot>;
  searchChatKit(
    query: string,
    sessionId?: string,
    nextPageToken?: string | null,
  ): Promise<ChatKitSearchPage>;
  getAgentSessions(
    agentId: string,
    nextPageToken?: string | null,
    sessionSort?: SessionSortOrder,
  ): Promise<ChatSessionPage>;
  createSession(
    agentId: string,
    input?: { title?: string; lookupKey?: string },
  ): Promise<ChatSession>;
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
  submitTurn(agentId: string, input: SubmitTurnInput): Promise<SubmitTurnResponse>;
  observeMissionControl(
    signal: AbortSignal,
    onEvent: (event: ChatEvent) => void | Promise<void>,
    onReady: () => void | Promise<void>,
  ): Promise<void>;
  observeSession(
    sessionId: string,
    signal: AbortSignal,
    onEvent: (event: ChatEvent) => void,
  ): Promise<void>;
  getQueuedTurns(sessionId: string): Promise<QueuedTurnPage>;
  steerQueuedTurn(id: string): Promise<void>;
  deleteQueuedTurn(id: string): Promise<void>;
  reorderQueuedTurn(id: string, queuePosition: number): Promise<void>;
  listRoutines(agentId: string): Promise<Routine[]>;
  createRoutine(input: CreateRoutineInput): Promise<Routine[]>;
  updateRoutine(groupId: string, agentId: string, input: UpdateRoutineInput): Promise<Routine[]>;
  deleteRoutine(groupId: string, agentId: string): Promise<Routine[]>;
  runRoutine(groupId: string, agentId: string): Promise<string>;
  listSignalProviders(): Promise<SignalProvider[]>;
  listSignalInstances(): Promise<SignalInstance[]>;
  createSignalInstance(input: CreateSignalInstanceInput): Promise<SignalInstance>;
  updateSignalInstance(id: string, input: UpdateSignalInstanceInput): Promise<SignalInstance>;
  deleteSignalInstance(id: string): Promise<void>;
  testSignalInstance(
    id: string,
    input?: TestSignalInstanceInput,
  ): Promise<TestSignalInstanceResult>;
  listSignalDeliveries(instanceId: string): Promise<SignalDelivery[]>;
  listConnectorProviders(): Promise<ConnectorProvider[]>;
  listConnectorAccounts(providerTypeId?: string): Promise<ConnectorAccount[]>;
  waitForConnectorAccount(accountId: string): Promise<ConnectorAccount>;
  createConnectorAccount(input: CreateConnectorAccountInput): Promise<CreateConnectorAccountResult>;
  bindConnector(agentId: string, accountId: string): Promise<void>;
  deleteConnectorAccounts(accountIds: readonly string[]): Promise<void>;
  getPluginsCatalog(agentIds: readonly string[]): Promise<PluginsCatalog>;
  setToolAccountForAgent(accountId: string, agentId: string, enabled: boolean): Promise<void>;
  setSkillForAgent(skillId: string, agentId: string, enabled: boolean): Promise<void>;
  createAttachment(sessionId: string, input: CreateAttachmentInput): Promise<AttachmentUpload>;
  createAttachments(
    sessionId: string,
    inputs: CreateAttachmentInput[],
  ): Promise<AttachmentUpload[]>;
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
        session_page_size: "50",
        agent_sort: agentSort,
        session_sort: sessionSort,
      });
      if (query.trim()) parameters.set("q", query.trim());
      if (nextAgentToken) parameters.set("agent_next_page_token", nextAgentToken);
      const response = await json(chatPath(`activity?${parameters}`), ChatKitActivitySchema);
      return response.activity;
    },
    async getActivity(activeSessionId) {
      const parameters = new URLSearchParams({
        agent_page_size: "50",
        session_page_size: "12",
        message_page_size: "100",
        queue_page_size: "25",
        agent_sort: "updated_at",
        session_sort: "updated_at",
      });
      if (activeSessionId) parameters.set("active_session_id", activeSessionId);
      return await json(chatPath(`activity?${parameters}`), ChatKitActivitySchema);
    },
    getConversationSnapshot: (sessionId) =>
      json(
        chatPath(
          `sessions/${encodeURIComponent(sessionId)}/activity?message_page_size=100&queue_page_size=25`,
        ),
        ConversationSnapshotSchema,
      ),
    async searchChatKit(query, sessionId, nextPageToken) {
      const parameters = new URLSearchParams({ q: query.trim(), page_size: "25" });
      if (sessionId) parameters.set("session_id", sessionId);
      if (nextPageToken) parameters.set("next_page_token", nextPageToken);
      return await json(chatPath(`search?${parameters}`), ChatKitSearchPageSchema);
    },
    async getAgentSessions(agentId, nextPageToken, sessionSort = "updated_at") {
      const parameters = new URLSearchParams({ page_size: "25", session_sort: sessionSort });
      if (nextPageToken) parameters.set("next_page_token", nextPageToken);
      return await json(
        chatPath(`agents/${encodeURIComponent(agentId)}/sessions?${parameters}`),
        ChatSessionPageSchema,
      );
    },
    async createSession(agentId, input) {
      const response = await json(chatPath("sessions"), SessionEnvelopeSchema, {
        method: "POST",
        body: JSON.stringify({
          agent_id: agentId,
          title: input?.title || null,
          lookup_key: input?.lookupKey || null,
        }),
      });
      return response.session;
    },
    renameSession: (sessionId, title) =>
      json(chatPath(`sessions/${encodeURIComponent(sessionId)}`), ChatSessionSchema, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),
    markSessionUnread: (sessionId) =>
      json(chatPath(`sessions/${encodeURIComponent(sessionId)}/unread`), ChatSessionSchema, {
        method: "POST",
      }),
    interruptSession: (sessionId) =>
      empty(chatPath(`sessions/${encodeURIComponent(sessionId)}/interrupt`), {
        method: "POST",
      }),
    async getMessages(sessionId, nextPageToken) {
      const parameters = new URLSearchParams({ page_size: "100" });
      if (nextPageToken) parameters.set("next_page_token", nextPageToken);
      return await json(
        chatPath(`sessions/${encodeURIComponent(sessionId)}/messages?${parameters}`),
        ChatMessagePageSchema,
      );
    },
    sendMessage: (agentId, sessionId, text, attachmentIds = []) =>
      json(
        chatPath(
          `agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
        ),
        ChatMessagePageSchema,
        { method: "POST", body: JSON.stringify({ text, attachment_ids: attachmentIds }) },
      ),
    submitTurn: (agentId, input) =>
      json(chatPath(`agents/${encodeURIComponent(agentId)}/turns`), SubmitTurnResponseSchema, {
        method: "POST",
        body: JSON.stringify({
          session_id: input.sessionId ?? null,
          title: input.title ?? null,
          text: input.text,
          attachments: (input.attachments ?? []).map((attachment) => ({
            attachment_id: attachment.attachmentId,
            size_bytes: attachment.sizeBytes ?? null,
            sha256: attachment.sha256 ?? null,
          })),
        }),
      }),
    async observeMissionControl(signal, onEvent, onReady) {
      const createWebSocket =
        options.createWebSocket ??
        ((url, protocols) => new globalThis.WebSocket(url, protocols) as WebSocketLike);
      let afterRevision: number | undefined;
      let reconnectAttempt = 0;
      while (!signal.aborted) {
        try {
          const ticket = await json(
            chatPath("mission-control/socket-ticket"),
            MissionControlSocketTicketSchema,
            {
              method: "POST",
              body: JSON.stringify({ transport: options.missionControlTransport ?? "browser" }),
              signal,
            },
          );
          await observeMissionControlSocket({
            signal,
            ticket,
            afterRevision,
            createWebSocket,
            onReady: async () => await onReady(),
            onEvent,
            onRevision: (revision) => {
              afterRevision = Math.max(afterRevision ?? 0, revision);
            },
            onHealthy: () => {
              reconnectAttempt = 0;
            },
          });
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof ClientRequestError && error.status < 500) throw error;
        }
        if (!signal.aborted) {
          await waitForReconnect(signal, reconnectAttempt);
          reconnectAttempt += 1;
        }
      }
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
    async listRoutines(agentId) {
      const parameters = new URLSearchParams({ agent_id: agentId });
      const response = await json(`/api/routines?${parameters}`, RoutineListSchema);
      return response.items;
    },
    async createRoutine(input) {
      const response = await json("/api/routines", RoutineListSchema, {
        method: "POST",
        body: JSON.stringify({
          agent_id: input.agentId,
          name: input.name,
          instruction: input.instruction,
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          triggers: input.triggers.map(routineTriggerBody),
        }),
      });
      return response.items;
    },
    async updateRoutine(groupId, agentId, input) {
      const parameters = new URLSearchParams({ agent_id: agentId });
      const response = await json(
        `/api/routines/${encodeURIComponent(groupId)}?${parameters}`,
        RoutineListSchema,
        {
          method: "PATCH",
          body: JSON.stringify({
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            ...(input.triggers === undefined
              ? {}
              : { triggers: input.triggers.map(routineTriggerBody) }),
          }),
        },
      );
      return response.items;
    },
    async deleteRoutine(groupId, agentId) {
      const parameters = new URLSearchParams({ agent_id: agentId });
      const response = await json(
        `/api/routines/${encodeURIComponent(groupId)}?${parameters}`,
        RoutineListSchema,
        { method: "DELETE" },
      );
      return response.items;
    },
    async runRoutine(groupId, agentId) {
      const parameters = new URLSearchParams({ agent_id: agentId });
      const response = await json(
        `/api/routines/${encodeURIComponent(groupId)}/run?${parameters}`,
        RunRoutineResponseSchema,
        { method: "POST" },
      );
      return response.session_id;
    },
    async listSignalProviders() {
      const response = await json("/api/signals/providers", SignalProviderListSchema);
      return response.items;
    },
    async listSignalInstances() {
      const response = await json("/api/signals/instances", SignalInstanceListSchema);
      return response.items;
    },
    createSignalInstance: (input) =>
      json("/api/signals/instances", SignalInstanceSchema, {
        method: "POST",
        body: JSON.stringify({
          provider_type: input.providerType,
          display_name: input.displayName,
          ...(input.signingSecret === undefined ? {} : { signing_secret: input.signingSecret }),
          ...(input.credentialSourceTypeId === undefined
            ? {}
            : { credential_source_type_id: input.credentialSourceTypeId }),
          ...(input.configuration === undefined ? {} : { configuration: input.configuration }),
          ...(input.ingressMode === undefined ? {} : { ingress_mode: input.ingressMode }),
        }),
      }),
    updateSignalInstance: (id, input) =>
      json(`/api/signals/instances/${encodeURIComponent(id)}`, SignalInstanceSchema, {
        method: "PATCH",
        body: JSON.stringify({
          ...(input.displayName === undefined ? {} : { display_name: input.displayName }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.signingSecret === undefined ? {} : { signing_secret: input.signingSecret }),
          ...(input.configuration === undefined ? {} : { configuration: input.configuration }),
        }),
      }),
    async deleteSignalInstance(id) {
      await json(
        `/api/signals/instances/${encodeURIComponent(id)}`,
        DeleteSignalInstanceResultSchema,
        {
          method: "DELETE",
        },
      );
    },
    testSignalInstance: (id, input = {}) =>
      json(
        `/api/signals/instances/${encodeURIComponent(id)}/test`,
        TestSignalInstanceResultSchema,
        {
          method: "POST",
          body: JSON.stringify({
            ...(input.signalType === undefined ? {} : { signal_type: input.signalType }),
            ...(input.summary === undefined ? {} : { summary: input.summary }),
            ...(input.data === undefined ? {} : { data: input.data }),
          }),
        },
      ),
    async listSignalDeliveries(instanceId) {
      const parameters = new URLSearchParams({ instance_id: instanceId });
      const response = await json(
        `/api/signals/deliveries?${parameters}`,
        SignalDeliveryListSchema,
      );
      return response.items;
    },
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
    waitForConnectorAccount: (accountId) =>
      json(
        `/api/connectors/accounts/${encodeURIComponent(accountId)}/wait`,
        z.object({
          id: z.string(),
          display_name: z.string(),
          status: z.string(),
          provider_type_id: z.string().optional(),
          credential_source_type_id: z.string().optional(),
        }),
      ),
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
    bindConnector: (agentId, accountId) =>
      empty("/api/connectors/bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, account_id: accountId }),
      }),
    async deleteConnectorAccounts(accountIds) {
      await json("/api/connectors/accounts", PluginMutationResultSchema, {
        method: "DELETE",
        body: JSON.stringify({ account_ids: accountIds }),
      });
    },
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
    async createAttachments(sessionId, inputs) {
      const response = await json(
        chatPath(`session/${encodeURIComponent(sessionId)}/attachments/upload`),
        z.object({ items: z.array(AttachmentUploadSchema) }),
        {
          method: "POST",
          body: JSON.stringify({
            items: inputs.map((input) => ({
              filename: input.filename,
              media_type: input.mediaType,
              size_bytes: input.sizeBytes,
              sha256: input.sha256,
            })),
          }),
        },
      );
      return response.items;
    },
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

async function waitForReconnect(signal: AbortSignal, attempt: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const capped = Math.min(250 * 2 ** Math.min(attempt, 8), 10_000);
    const jittered = Math.min(10_000, Math.round(capped * (0.8 + Math.random() * 0.4)));
    const timer = setTimeout(done, jittered);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function routineTriggerBody(spec: RoutineTriggerSpec): Record<string, unknown> {
  const identity = spec.id === undefined ? {} : { id: spec.id };
  return spec.kind === "schedule"
    ? { ...identity, kind: "schedule", schedule: spec.schedule }
    : {
        ...identity,
        kind: "event",
        instance_id: spec.instanceId,
        signal_type: spec.signalType,
        ...(spec.filters === undefined ? {} : { filters: spec.filters }),
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
