import type { NormalizedConfig } from "../config";
import { requestJson } from "../internal/fetch-client";
import { buildUrl, pathWithParams, teamPath } from "../internal/paths";
import type { JsonObject, JsonValue } from "../tools";
import { MessagesClient } from "./messages";
import { ChatKitRoomsClient } from "./rooms";
export * from "./rooms";
import { AgentRunsClient } from "./runs";
import { ChatKitRoutinesClient } from "./routines";
import { ChatKitWorkClient } from "./work";

export * from "./jobs";
export * from "./routines";
export * from "./runs";
export * from "./work";

const REGISTER_HTTP_AGENT_PATH = "/api/v1/team/{team_id}/chatkit/agents/http-vercel-ai-sdk";
const REGISTER_VERCEL_UI_CHANNEL_PATH = "/api/v1/team/{team_id}/chatkit/channels/vercel-ui";
const MESSAGE_HISTORY_PATH = "/api/v1/team/{team_id}/chatkit/sessions/{session_id}/messages";
const SESSION_SEND_MESSAGE_PATH =
  "/api/v1/team/{team_id}/chatkit/sessions/{session_id}/tools/sendMessage";
const SESSION_PROVIDER_TOOL_PATH =
  "/api/v1/team/{team_id}/chatkit/sessions/{session_id}/tools/{tool_name}";
const CONVERTED_MESSAGE_CACHE_PATH = "/api/v1/team/{team_id}/chatkit/messages/converted-cache";
const HYDRATE_CONVERTED_MESSAGE_CACHE_PATH =
  "/api/v1/team/{team_id}/chatkit/messages/converted-cache/hydrate";
const COMPACTION_EVENT_PATH =
  "/api/v1/team/{team_id}/chatkit/sessions/{session_id}/compaction-events";
const COMPACTED_HISTORY_PATH =
  "/api/v1/team/{team_id}/chatkit/sessions/{session_id}/messages/from-last-compaction";
const AUTOMATIC_MEMORY_RECALL_PATH =
  "/api/v1/team/{team_id}/chatkit/agents/{agent_id}/sessions/{session_id}/automatic-memory/recall";
const AGENT_PATH = "/api/v1/team/{team_id}/chatkit/agents/{agent_id}";
const ATTACHMENT_DOWNLOAD_URL_PATH =
  "/api/v1/team/{team_id}/chatkit/session/{session_id}/attachment/{attachment_id}/download-url";
const AGENT_TOOLS_PATH = "/api/v1/team/{team_id}/chatkit/agents/{agent_id}/tools";
const AGENT_TOOL_EXECUTIONS_PATH =
  "/api/v1/team/{team_id}/chatkit/agents/{agent_id}/tool-executions";
const CHATKIT_SESSIONS_PATH = "/api/v1/team/{team_id}/chatkit/sessions";
const CHATKIT_MESSAGE_PATH = "/api/v1/team/{team_id}/chatkit/session/{session_id}/message";

type Paginated<T> = {
  items: T[];
  next_page_token?: string | null;
};

export type ConvertedChatKitMessage = {
  chatKitMessageId: string;
  message: JsonObject;
};

export type RegisteredChatKitAgent = JsonObject & {
  id?: string;
  display_name?: string;
  endpoint_url?: string;
};

export type RegisteredChatKitChannel = JsonObject & {
  id?: string;
  display_name?: string;
};

export type ChatKitAttachment = JsonObject & {
  id?: string;
  filename?: string;
  media_type?: string;
};

export type ChatKitCompactionLifecycle =
  | {
      status: "started";
      inputMessageCount: number;
      estimatedInputTokens: number;
      compactedThroughMessageId: string;
    }
  | {
      status: "ended";
      summary: string;
      compactedMessageIds: string[];
      retainedMessageIds: string[];
      inputTokens: number;
      outputTokens: number;
    }
  | {
      status: "failed";
      error: string;
      retryable: boolean;
    };

export type ChatKitCompactionCheckpoint = {
  eventId: string;
  revision: number;
  compactionId: string;
  sessionId: string;
  agentId: string;
  summary: string;
  compactedThroughMessageId: string;
  compactedMessageIds: string[];
  retainedMessageIds: string[];
  inputTokens: number;
  outputTokens: number;
  endedAt: string;
};

export type ChatKitAutomaticMemoryMode = "none" | "personal" | "personal_plus_agent" | "team";

export type ChatKitAutomaticMemoryItem = {
  bankId: string;
  bankName: string;
  memoryId: string;
  memoryType: string;
  content: string;
  evidenceIds: string[];
  source?: string;
  learnedByAgentId?: string;
};

export type ChatKitAutomaticMemoryProjection = {
  items: ChatKitAutomaticMemoryItem[];
  rendered: string;
  estimatedTokens: number;
  truncated: boolean;
};

export type ChatKitAgentMemorySettings = {
  mode: ChatKitAutomaticMemoryMode;
  bankIds: string[];
};

export type AgentToolRegistration = {
  toolId: string;
  wireName: string;
  displayName: string;
  supportsSummary?: boolean;
  summary?: string;
  identity?: JsonObject;
};

export type ToolExecutionState = "started" | "progress" | "completed" | "failed";

export type ReportToolExecutionInput = {
  agentId: string;
  executionId: string;
  toolId: string;
  wireName: string;
  tool?: {
    displayName: string;
    supportsSummary?: boolean;
    summary?: string;
    identity?: JsonObject;
  };
  state: ToolExecutionState;
  input: JsonValue;
  sessionId?: string;
  messageId?: string;
  modelToolCallId?: string;
  parentExecutionId?: string;
  batchId?: string;
  batchIndex?: number;
  output?: JsonValue;
  errorMessage?: string;
  summary?: string;
  startedAt?: string;
  completedAt?: string;
};

export type ChatKitSessionParticipant = JsonObject & {
  participant_type?: "human" | "agent";
  instance?: JsonObject & { id?: string };
  inbox?: JsonObject & { id?: string };
};

export type ChatKitSessionWithParticipants = JsonObject & {
  session: JsonObject & { id?: string };
  participants: ChatKitSessionParticipant[];
};

export type CreateChatKitMessageInput = {
  id?: string;
  sessionId: string;
  fromInboxId: string;
  fromInboxInstanceId?: string;
  toInboxId?: string;
  toInboxInstanceId?: string;
  role: "system" | "user" | "assistant";
  displayName: string;
  text: string;
  metadata?: JsonObject;
};

export type SendSessionMessageInput = {
  sessionId: string;
  agentInboxInstanceId: string;
  targetInboxInstanceId: string;
  triggerMessageId: string;
  toolCallId: string;
  content: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  html?: string;
  replyAll?: boolean;
};

export type SendSessionMessageResult = {
  message: JsonObject;
  providerId: string;
  deliveryStatus: string;
};

export type InvokeSessionProviderToolInput = {
  sessionId: string;
  toolName: string;
  agentInboxInstanceId: string;
  targetInboxInstanceId: string;
  triggerMessageId: string;
  toolCallId: string;
  parameters?: JsonObject;
};

export type InvokeSessionProviderToolResult = {
  providerId: string;
  toolName: string;
  result: JsonValue;
};

export class ChatKitClient {
  readonly #config: NormalizedConfig;
  readonly #messages: MessagesClient;
  readonly rooms: ChatKitRoomsClient;
  readonly runs: AgentRunsClient;

  constructor(config: NormalizedConfig, messages = new MessagesClient(config)) {
    this.#config = config;
    this.#messages = messages;
    this.rooms = new ChatKitRoomsClient(config);
    this.runs = new AgentRunsClient(config);
  }

  /** Bind goal, task, and background-job operations to one agent conversation. */
  work(input: { agentId: string; sessionId: string }): ChatKitWorkClient {
    return new ChatKitWorkClient(this.#config, input.agentId, input.sessionId);
  }

  /** Bind recurring-work operations to one authenticated agent. */
  routines(agentId: string): ChatKitRoutinesClient {
    return new ChatKitRoutinesClient(this.#config, agentId);
  }

  /** Recall using only a durable triggering message; Tilde derives its effective actor. */
  async recallAutomaticMemory(input: {
    agentId: string;
    sessionId: string;
    messageId: string;
    maxTokens?: number;
  }): Promise<ChatKitAutomaticMemoryProjection> {
    const raw = await requestJson<{
      items: Array<{
        bank_id: string;
        bank_name: string;
        memory_id: string;
        memory_type: string;
        content: string;
        evidence_ids?: string[];
        source?: string | null;
        learned_by_agent_id?: string | null;
      }>;
      rendered: string;
      estimated_tokens: number;
      truncated: boolean;
    }>(this.#config, {
      method: "POST",
      path: pathWithParams(teamPath(this.#config, AUTOMATIC_MEMORY_RECALL_PATH), {
        agent_id: input.agentId,
        session_id: input.sessionId,
      }),
      body: {
        message_id: input.messageId,
        ...(input.maxTokens === undefined ? {} : { max_tokens: input.maxTokens }),
      },
    });
    return {
      items: raw.items.map((item) => ({
        bankId: item.bank_id,
        bankName: item.bank_name,
        memoryId: item.memory_id,
        memoryType: item.memory_type,
        content: item.content,
        evidenceIds: item.evidence_ids ?? [],
        ...(item.source ? { source: item.source } : {}),
        ...(item.learned_by_agent_id ? { learnedByAgentId: item.learned_by_agent_id } : {}),
      })),
      rendered: raw.rendered,
      estimatedTokens: raw.estimated_tokens,
      truncated: raw.truncated,
    };
  }

  async getAgentMemorySettings(agentId: string): Promise<ChatKitAgentMemorySettings> {
    const raw = await requestJson<{
      automatic_memory_mode?: ChatKitAutomaticMemoryMode | null;
      memory_bank_ids?: string[] | null;
    }>(this.#config, {
      path: pathWithParams(teamPath(this.#config, AGENT_PATH), { agent_id: agentId }),
    });
    return {
      mode: raw.automatic_memory_mode ?? "none",
      bankIds: raw.memory_bank_ids ?? [],
    };
  }

  async updateAgentMemorySettings(
    agentId: string,
    settings: ChatKitAgentMemorySettings,
  ): Promise<ChatKitAgentMemorySettings> {
    const raw = await requestJson<{
      automatic_memory_mode?: ChatKitAutomaticMemoryMode | null;
      memory_bank_ids?: string[] | null;
    }>(this.#config, {
      method: "PATCH",
      path: pathWithParams(teamPath(this.#config, AGENT_PATH), { agent_id: agentId }),
      body: {
        automatic_memory_mode: settings.mode,
        memory_bank_ids: settings.bankIds,
      },
    });
    return {
      mode: raw.automatic_memory_mode ?? settings.mode,
      bankIds: raw.memory_bank_ids ?? settings.bankIds,
    };
  }

  async registerHttpVercelAiSdkAgent(input: {
    id?: string;
    displayName: string;
    endpointUrl: string;
    streaming?: boolean;
    timeoutMs?: number;
    automaticMemoryMode?: ChatKitAutomaticMemoryMode;
    memoryBankIds?: string[];
  }): Promise<{
    agent: RegisteredChatKitAgent;
    apiKey: string;
    webhookSigningKey: string;
  }> {
    const raw = await requestJson<{
      agent: RegisteredChatKitAgent;
      api_key: string;
      webhook_signing_key: string;
    }>(this.#config, {
      method: "POST",
      path: teamPath(this.#config, REGISTER_HTTP_AGENT_PATH),
      body: {
        id: input.id,
        display_name: input.displayName,
        endpoint_url: input.endpointUrl,
        streaming: input.streaming ?? false,
        timeout_ms: input.timeoutMs,
        automatic_memory_mode: input.automaticMemoryMode ?? "none",
        memory_bank_ids: input.memoryBankIds,
      },
    });
    return {
      agent: raw.agent,
      apiKey: raw.api_key,
      webhookSigningKey: raw.webhook_signing_key,
    };
  }

  async registerVercelUiChannel<
    TResult extends RegisteredChatKitChannel = RegisteredChatKitChannel,
  >(input: { id?: string; displayName: string; defaultAgentInboxId?: string }): Promise<TResult> {
    return requestJson<TResult>(this.#config, {
      method: "POST",
      path: teamPath(this.#config, REGISTER_VERCEL_UI_CHANNEL_PATH),
      body: {
        id: input.id,
        display_name: input.displayName,
        default_agent_inbox_id: input.defaultAgentInboxId,
      },
    });
  }

  async registerAgentTools(input: {
    agentId: string;
    tools: AgentToolRegistration[];
  }): Promise<JsonObject> {
    return requestJson<JsonObject>(this.#config, {
      method: "PUT",
      path: pathWithParams(teamPath(this.#config, AGENT_TOOLS_PATH), {
        agent_id: input.agentId,
      }),
      body: {
        tools: input.tools.map((tool) => ({
          tool_id: tool.toolId,
          wire_name: tool.wireName,
          display_name: tool.displayName,
          supports_summary: tool.supportsSummary ?? false,
          summary: tool.summary,
          identity_snapshot: tool.identity,
        })),
      },
    });
  }

  async reportToolExecution(input: ReportToolExecutionInput): Promise<JsonObject> {
    return requestJson<JsonObject>(this.#config, {
      method: "POST",
      path: pathWithParams(teamPath(this.#config, AGENT_TOOL_EXECUTIONS_PATH), {
        agent_id: input.agentId,
      }),
      body: {
        execution_id: input.executionId,
        session_id: input.sessionId,
        message_id: input.messageId,
        tool_id: input.toolId,
        wire_name: input.wireName,
        tool: input.tool
          ? {
              display_name: input.tool.displayName,
              supports_summary: input.tool.supportsSummary ?? false,
              summary: input.tool.summary,
              identity_snapshot: input.tool.identity,
            }
          : undefined,
        state: input.state,
        model_tool_call_id: input.modelToolCallId,
        parent_execution_id: input.parentExecutionId,
        batch_id: input.batchId,
        batch_index: input.batchIndex,
        input: input.input,
        output: input.output,
        error_message: input.errorMessage,
        summary: input.summary,
        started_at: input.startedAt,
        completed_at: input.completedAt,
      },
    });
  }

  async createAgentSession(input: {
    agentId: string;
    lookupKey: string;
    title?: string;
  }): Promise<ChatKitSessionWithParticipants> {
    return requestJson<ChatKitSessionWithParticipants>(this.#config, {
      method: "POST",
      path: teamPath(this.#config, CHATKIT_SESSIONS_PATH),
      body: {
        agent_id: input.agentId,
        lookup_key: input.lookupKey,
        title: input.title,
      },
    });
  }

  async createMessage(input: CreateChatKitMessageInput): Promise<JsonObject> {
    return requestJson<JsonObject>(this.#config, {
      method: "POST",
      path: pathWithParams(teamPath(this.#config, CHATKIT_MESSAGE_PATH), {
        session_id: input.sessionId,
      }),
      body: {
        type: "text",
        id: input.id,
        from_inbox_type_id: input.fromInboxId,
        to_inbox_type_id: input.toInboxId,
        from_inbox_instance_id: input.fromInboxInstanceId,
        to_inbox_instance_id: input.toInboxInstanceId,
        in_reply_to_message_id: null,
        in_reply_to_inbox_id: null,
        related_task_ids: [],
        role: input.role,
        user_display_name: input.displayName,
        text: input.text,
        metadata: input.metadata,
        inbox_settings: {},
      },
    });
  }

  async listMessageHistory<TMessage extends JsonValue = JsonObject>(input: {
    sessionId: string;
    pageSize?: number;
    nextPageToken?: string;
    channelId?: string;
    participantInboxId?: string;
    externalUserId?: string;
  }): Promise<{ items: TMessage[]; nextPageToken?: string }> {
    try {
      const raw = await requestJson<Paginated<TMessage>>(this.#config, {
        path: pathWithParams(teamPath(this.#config, MESSAGE_HISTORY_PATH), {
          session_id: input.sessionId,
        }),
        query: {
          page_size: input.pageSize ?? 100,
          next_page_token: input.nextPageToken,
          channel_id: input.channelId,
          participant_inbox_id: input.participantInboxId,
          user_external_id: input.externalUserId,
        },
      });
      const result: { items: TMessage[]; nextPageToken?: string } = {
        items: raw.items,
      };
      if (raw.next_page_token) {
        result.nextPageToken = raw.next_page_token;
      }
      return result;
    } catch (error) {
      if (isMissingChatKitRoute(error)) {
        return this.#messages.list<TMessage>(input);
      }
      throw error;
    }
  }

  async sendSessionMessage(input: SendSessionMessageInput): Promise<SendSessionMessageResult> {
    const raw = await requestJson<{
      message: JsonObject;
      provider_id: string;
      delivery_status: string;
    }>(this.#config, {
      method: "POST",
      path: pathWithParams(teamPath(this.#config, SESSION_SEND_MESSAGE_PATH), {
        session_id: input.sessionId,
      }),
      body: {
        agent_inbox_instance_id: input.agentInboxInstanceId,
        target_inbox_instance_id: input.targetInboxInstanceId,
        trigger_message_id: input.triggerMessageId,
        tool_call_id: input.toolCallId,
        content: input.content,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        html: input.html,
        reply_all: input.replyAll,
      },
    });
    return {
      message: raw.message,
      providerId: raw.provider_id,
      deliveryStatus: raw.delivery_status,
    };
  }

  async invokeSessionProviderTool(
    input: InvokeSessionProviderToolInput,
  ): Promise<InvokeSessionProviderToolResult> {
    const raw = await requestJson<{
      provider_id: string;
      tool_name: string;
      result: JsonValue;
    }>(this.#config, {
      method: "POST",
      path: pathWithParams(teamPath(this.#config, SESSION_PROVIDER_TOOL_PATH), {
        session_id: input.sessionId,
        tool_name: input.toolName,
      }),
      body: {
        agent_inbox_instance_id: input.agentInboxInstanceId,
        target_inbox_instance_id: input.targetInboxInstanceId,
        trigger_message_id: input.triggerMessageId,
        tool_call_id: input.toolCallId,
        input: input.parameters ?? {},
      },
    });
    return {
      providerId: raw.provider_id,
      toolName: raw.tool_name,
      result: raw.result,
    };
  }

  async cacheConvertedMessages(input: {
    messages: ConvertedChatKitMessage[];
  }): Promise<{ success: boolean }> {
    const raw = await requestJson<{ success: boolean }>(this.#config, {
      method: "POST",
      path: teamPath(this.#config, CONVERTED_MESSAGE_CACHE_PATH),
      body: {
        messages: input.messages.map((message) => ({
          chatkit_message_id: message.chatKitMessageId,
          message: message.message,
        })),
      },
    });
    return { success: raw.success };
  }

  async hydrateConvertedMessages(input: {
    messageIds: string[];
  }): Promise<{ messages: ConvertedChatKitMessage[] }> {
    const raw = await requestJson<{
      messages: {
        chatkit_message_id: string;
        message: JsonObject;
      }[];
    }>(this.#config, {
      method: "POST",
      path: teamPath(this.#config, HYDRATE_CONVERTED_MESSAGE_CACHE_PATH),
      body: {
        message_ids: input.messageIds,
      },
    });
    return {
      messages: raw.messages.map((message) => ({
        chatKitMessageId: message.chatkit_message_id,
        message: message.message,
      })),
    };
  }

  async reportCompactionEvent(input: {
    sessionId: string;
    agentId: string;
    compactionId: string;
    lifecycle: ChatKitCompactionLifecycle;
  }): Promise<{ eventId: string }> {
    const lifecycle = input.lifecycle;
    const body =
      lifecycle.status === "started"
        ? {
            status: lifecycle.status,
            input_message_count: lifecycle.inputMessageCount,
            estimated_input_tokens: lifecycle.estimatedInputTokens,
            compacted_through_message_id: lifecycle.compactedThroughMessageId,
          }
        : lifecycle.status === "ended"
          ? {
              status: lifecycle.status,
              summary: lifecycle.summary,
              compacted_message_ids: lifecycle.compactedMessageIds,
              retained_message_ids: lifecycle.retainedMessageIds,
              input_tokens: lifecycle.inputTokens,
              output_tokens: lifecycle.outputTokens,
            }
          : {
              status: lifecycle.status,
              error: lifecycle.error,
              retryable: lifecycle.retryable,
            };
    const raw = await requestJson<{ event_id: string }>(this.#config, {
      method: "POST",
      path: pathWithParams(teamPath(this.#config, COMPACTION_EVENT_PATH), {
        session_id: input.sessionId,
      }),
      body: {
        agent_id: input.agentId,
        compaction_id: input.compactionId,
        lifecycle: body,
      },
    });
    return { eventId: raw.event_id };
  }

  async getLatestCompaction(input: {
    sessionId: string;
    agentId: string;
  }): Promise<ChatKitCompactionCheckpoint | undefined> {
    const raw = await requestJson<RawCompactionCheckpoint | null>(this.#config, {
      path: pathWithParams(teamPath(this.#config, `${COMPACTION_EVENT_PATH}/latest`), {
        session_id: input.sessionId,
      }),
      query: { agent_id: input.agentId },
    });
    return raw === null ? undefined : compactionCheckpointFromRaw(raw);
  }

  async getCompactedHistory<TMessage extends JsonValue = JsonObject>(input: {
    sessionId: string;
    agentId: string;
    pageSize?: number;
    nextPageToken?: string;
  }): Promise<{
    checkpoint?: ChatKitCompactionCheckpoint;
    items: TMessage[];
    nextPageToken?: string;
  }> {
    const raw = await requestJson<{
      checkpoint: RawCompactionCheckpoint | null;
      items: TMessage[];
      next_page_token?: string | null;
    }>(this.#config, {
      path: pathWithParams(teamPath(this.#config, COMPACTED_HISTORY_PATH), {
        session_id: input.sessionId,
      }),
      query: {
        agent_id: input.agentId,
        page_size: input.pageSize ?? 100,
        next_page_token: input.nextPageToken,
      },
    });
    return {
      ...(raw.checkpoint ? { checkpoint: compactionCheckpointFromRaw(raw.checkpoint) } : {}),
      items: raw.items,
      ...(raw.next_page_token ? { nextPageToken: raw.next_page_token } : {}),
    };
  }

  async getAttachmentDownloadUrl(input: { sessionId: string; attachmentId: string }): Promise<{
    attachment: ChatKitAttachment;
    downloadUrl: string;
    expiresAt: string;
  }> {
    const raw = await requestJson<{
      attachment: ChatKitAttachment;
      download_url: string;
      expires_at: string;
    }>(this.#config, {
      path: pathWithParams(teamPath(this.#config, ATTACHMENT_DOWNLOAD_URL_PATH), {
        session_id: input.sessionId,
        attachment_id: input.attachmentId,
      }),
    });
    return {
      attachment: raw.attachment,
      downloadUrl: raw.download_url,
      expiresAt: raw.expires_at,
    };
  }

  vercelUiEndpoint(input: {
    sessionId: string;
    inboxId: string;
    instanceId: string;
    stream?: boolean;
  }): string {
    const suffix = input.stream ? "/ai/ui/stream" : "/ai/ui";
    return buildUrl(
      this.#config,
      `/api/v1/team/${encodeURIComponent(this.#config.teamId)}/inbox/session/${encodeURIComponent(input.sessionId)}/inbox/${encodeURIComponent(input.inboxId)}/instance/${encodeURIComponent(input.instanceId)}${suffix}`,
    );
  }
}

export { MessagesClient } from "./messages";

type RawCompactionCheckpoint = {
  event_id: string;
  revision: number;
  compaction_id: string;
  session_id: string;
  agent_id: string;
  summary: string;
  compacted_through_message_id: string;
  compacted_message_ids: string[];
  retained_message_ids: string[];
  input_tokens: number;
  output_tokens: number;
  ended_at: string;
};

function compactionCheckpointFromRaw(raw: RawCompactionCheckpoint): ChatKitCompactionCheckpoint {
  return {
    eventId: raw.event_id,
    revision: raw.revision,
    compactionId: raw.compaction_id,
    sessionId: raw.session_id,
    agentId: raw.agent_id,
    summary: raw.summary,
    compactedThroughMessageId: raw.compacted_through_message_id,
    compactedMessageIds: raw.compacted_message_ids,
    retainedMessageIds: raw.retained_message_ids,
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    endedAt: raw.ended_at,
  };
}

function isMissingChatKitRoute(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 404 || error.status === 405)
  );
}
