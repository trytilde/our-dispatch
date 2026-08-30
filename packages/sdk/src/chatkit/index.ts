import type { NormalizedConfig } from "../config";
import { requestJson } from "../internal/fetch-client";
import { buildUrl, pathWithParams, teamPath } from "../internal/paths";
import type { JsonObject, JsonValue } from "../tools";
import { MessagesClient } from "./messages";

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
const ATTACHMENT_DOWNLOAD_URL_PATH =
  "/api/v1/team/{team_id}/chatkit/session/{session_id}/attachment/{attachment_id}/download-url";
const AGENT_TOOLS_PATH = "/api/v1/team/{team_id}/chatkit/agents/{agent_id}/tools";
const AGENT_TOOL_EXECUTIONS_PATH =
  "/api/v1/team/{team_id}/chatkit/agents/{agent_id}/tool-executions";

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

  constructor(config: NormalizedConfig, messages = new MessagesClient(config)) {
    this.#config = config;
    this.#messages = messages;
  }

  async registerHttpVercelAiSdkAgent(input: {
    id?: string;
    displayName: string;
    endpointUrl: string;
    streaming?: boolean;
    timeoutMs?: number;
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

function isMissingChatKitRoute(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 404 || error.status === 405)
  );
}
