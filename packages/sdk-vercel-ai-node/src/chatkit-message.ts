import type { JsonObject, JsonValue } from "@trytilde/sdk";
import { isJsonObject } from "@trytilde/sdk/json";
import type { UIMessage } from "ai";
import { withSpeakerPrefix } from "./chatkit-identity";
import {
  type ChatKitContextClient,
  type ChatKitConvertedMessage,
  currentChatKitContext,
} from "./chatkit-context";
import {
  type ChatKitRequestFilePart,
  type ChatKitRequestMessage,
  type ChatKitRequestMessagePart,
  isChatKitRequestMessage,
} from "./chatkit-request";
import type { LinqChat, LinqHandle, LinqMessagePart } from "./chatkit-provider-metadata";

type Awaitable<T> = T | Promise<T>;

export type ChatKitMessageRole = UIMessage["role"];

export type ChatKitMessageBase = {
  id: string;
  role: ChatKitMessageRole;
  created_at?: string;
  updated_at?: string;
  metadata?: JsonObject | null;
  provider_metadata?: JsonObject | null;
  cached_agent_representation?: JsonObject | null;
};

export type ChatKitTextMessage = ChatKitMessageBase & {
  type: "text";
  text: string;
};

export type ChatKitUiTextPart = {
  type: "text";
  text?: string | null;
  provider_metadata?: JsonObject | null;
};

export type ChatKitUiReasoningPart = {
  type: "reasoning";
  text?: string | null;
  provider_metadata?: JsonObject | null;
};

export type ChatKitUiFilePart = {
  type: "file";
  media_type?: string;
  mediaType?: string;
  mimeType?: string;
  filename?: string | null;
  url: string;
  attachment_id?: string | null;
  size_bytes?: number | null;
  sha256?: string | null;
  provider_metadata?: JsonObject | null;
  providerMetadata?: JsonObject | null;
};

export type ChatKitUiPart = ChatKitUiTextPart | ChatKitUiReasoningPart | ChatKitUiFilePart;

export type ChatKitUiMessage = ChatKitMessageBase & {
  type: "ui";
  parts: ChatKitUiPart[];
};

export type ChatKitMessage = ChatKitTextMessage | ChatKitUiMessage;

/** Metadata attached by Tilde to every delivered signal message. */
export type SignalMetadata = JsonObject & {
  signal_type: string;
  signal_delivery_id?: string;
  signal_provider_instance_id?: string;
  routine_trigger_id?: string;
  /** Present only on signal messages persisted before native Routine triggers. */
  signal_rule_id?: string;
};

export type ChatKitSignalMessage = ChatKitMessageBase & {
  type: "signal";
  role: "system";
  summary?: string | null;
  data?: JsonValue | null;
  from_inbox_type_id?: string;
  user_display_name?: string;
};

export type ChatKitHistoryMessage = ChatKitMessage | ChatKitSignalMessage;

export type AgentMailWebhookEventType =
  | "domain.verified"
  | "message.bounced"
  | "message.complained"
  | "message.delivered"
  | "message.received"
  | "message.received.blocked"
  | "message.received.spam"
  | "message.received.unauthenticated"
  | "message.rejected"
  | "message.security.completed"
  | "message.security.override"
  | "message.security.review"
  | "message.sent";

export type AgentMailSignalType = `agentmail.${AgentMailWebhookEventType}`;

export type AgentMailAttachment = JsonObject & {
  attachment_id?: string | null;
  size?: number | null;
  filename?: string | null;
  content_type?: string | null;
  content_disposition?: string | null;
  content_id?: string | null;
};

export type AgentMailMessage = JsonObject & {
  inbox_id: string;
  thread_id: string;
  message_id: string;
  from?: string | null;
  to?: string[];
  reply_to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string | null;
  preview?: string | null;
  text?: string | null;
  html?: string | null;
  extracted_text?: string | null;
  extracted_html?: string | null;
  attachments?: AgentMailAttachment[];
  labels?: string[];
  timestamp?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AgentMailThread = JsonObject & {
  inbox_id: string;
  thread_id: string;
  subject?: string | null;
  preview?: string | null;
  senders?: string[];
  recipients?: string[];
  last_message_id?: string | null;
  message_count?: number;
  attachments?: AgentMailAttachment[];
  labels?: string[];
  timestamp?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AgentMailDomainRecord = JsonObject & {
  type: string;
  name: string;
  value: string;
  status?: string | null;
  priority?: number | null;
};

export type AgentMailDomain = JsonObject & {
  domain_id: string;
  domain: string;
  status?: string | null;
  feedback_enabled?: boolean;
  subdomains_enabled?: boolean;
  tracking_enabled?: boolean;
  records?: AgentMailDomainRecord[];
  created_at?: string | null;
  updated_at?: string | null;
};

export type AgentMailSignalData<TType extends AgentMailSignalType = AgentMailSignalType> =
  JsonObject & {
    event_type: TType extends `agentmail.${infer TEvent extends AgentMailWebhookEventType}`
      ? TEvent
      : never;
    event_id: string;
    thread?: AgentMailThread | null;
  } & (TType extends "agentmail.domain.verified"
      ? { domain: AgentMailDomain; message?: null }
      : { message: AgentMailMessage; domain?: AgentMailDomain | null });

export type AgentMailSignalMessage<TType extends AgentMailSignalType = AgentMailSignalType> =
  ChatKitSignalMessage & {
    metadata: SignalMetadata & { signal_type: TType };
    data: AgentMailSignalData<TType>;
  };

export type AgentMailSignalByType = {
  [TType in AgentMailSignalType]: AgentMailSignalMessage<TType>;
};

export type FirecrawlMonitorPageStatus = "same" | "new" | "changed" | "removed" | "error";

export type FirecrawlMonitorPageSignalType = `firecrawl.monitor.page.${FirecrawlMonitorPageStatus}`;
export type FirecrawlMonitorCheckCompletedSignalType = "firecrawl.monitor.check.completed";
export type FirecrawlSignalType =
  | FirecrawlMonitorPageSignalType
  | FirecrawlMonitorCheckCompletedSignalType;

export type FirecrawlSignalReference<TId extends string | null = string | null> = {
  id: TId;
};

export type FirecrawlMonitorPage = JsonObject & {
  monitorId?: string | null;
  checkId?: string | null;
  url: string;
  status: string;
  id?: string | null;
  scrapeId?: string | null;
  error?: string | null;
  isMeaningful?: boolean | null;
  judgment?: JsonValue;
  diff?: JsonValue;
};

export type FirecrawlMonitorPageSignalData = JsonObject & {
  event: "monitor.page";
  monitor: FirecrawlSignalReference;
  check: FirecrawlSignalReference;
  page: FirecrawlMonitorPage;
  metadata: JsonValue;
};

export type FirecrawlMonitorCheckResult = JsonObject & {
  monitorId?: string | null;
  checkId?: string | null;
  id?: string | null;
  status?: string | null;
  same?: number;
  new?: number;
  changed?: number;
  removed?: number;
  error?: number;
};

export type FirecrawlMonitorCheckCompletedSignalData = JsonObject & {
  event: "monitor.check.completed";
  monitor: FirecrawlSignalReference<string>;
  check: FirecrawlSignalReference<string>;
  result: FirecrawlMonitorCheckResult;
  metadata: JsonValue;
};

export type FirecrawlSignalMessage<TType extends FirecrawlSignalType = FirecrawlSignalType> =
  ChatKitSignalMessage & {
    metadata: SignalMetadata & { signal_type: TType };
    data: TType extends FirecrawlMonitorPageSignalType
      ? FirecrawlMonitorPageSignalData
      : FirecrawlMonitorCheckCompletedSignalData;
  };

export type FirecrawlSignalByType = {
  [TType in FirecrawlSignalType]: FirecrawlSignalMessage<TType>;
};

export type GitHubIssueSignalAction = "opened" | "reopened" | "closed" | "edited" | "labeled";

export type GitHubPullRequestSignalAction =
  | "opened"
  | "reopened"
  | "closed"
  | "merged"
  | "synchronize"
  | "synchronized"
  | "ready_for_review"
  | "converted_to_draft";

export type GitHubCiCheckSignalOutcome = "passed" | "failed";

export type GitHubIssueSignalType = `github.issue.${GitHubIssueSignalAction}`;
export type GitHubPullRequestSignalType = `github.pull_request.${GitHubPullRequestSignalAction}`;
export type GitHubCiCheckSignalType = `github.ci_check.${GitHubCiCheckSignalOutcome}`;
export type GitHubSignalType =
  | GitHubIssueSignalType
  | GitHubPullRequestSignalType
  | GitHubCiCheckSignalType;

export type GitHubWebhookUser = JsonObject & {
  login: string;
  id?: number;
};

export type GitHubWebhookRepository = JsonObject & {
  full_name: string;
  html_url?: string | null;
  name?: string | null;
  owner?: GitHubWebhookUser | null;
};

export type GitHubWebhookIssue = JsonObject & {
  number: number;
  title: string;
  state?: string | null;
  body?: string | null;
  html_url?: string | null;
  user?: GitHubWebhookUser | null;
  labels?: (JsonObject & { name: string })[];
};

export type GitHubWebhookPullRequest = JsonObject & {
  number: number;
  title: string;
  body?: string | null;
  html_url?: string | null;
  draft?: boolean | null;
  merged?: boolean | null;
  head?: (JsonObject & { ref?: string }) | null;
  base?: (JsonObject & { ref?: string }) | null;
  user?: GitHubWebhookUser | null;
};

export type GitHubWebhookCheck = JsonObject & {
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  html_url?: string | null;
  head_sha?: string | null;
  app?: (JsonObject & { name?: string | null }) | null;
};

export type GitHubIssueWebhook<TAction extends GitHubIssueSignalAction> = JsonObject & {
  action: TAction;
  repository: GitHubWebhookRepository;
  sender?: GitHubWebhookUser | null;
  issue: GitHubWebhookIssue;
};

export type GitHubPullRequestWebhook<TAction extends GitHubPullRequestWebhookAction> =
  JsonObject & {
    action: TAction;
    repository: GitHubWebhookRepository;
    sender?: GitHubWebhookUser | null;
    pull_request: GitHubWebhookPullRequest;
  };

export type GitHubCiCheckWebhook = JsonObject & {
  action: "completed";
  repository: GitHubWebhookRepository;
  sender?: GitHubWebhookUser | null;
  check_run?: GitHubWebhookCheck | null;
  check_suite?: GitHubWebhookCheck | null;
};

export type GitHubSignalMessage<TType extends GitHubSignalType = GitHubSignalType> =
  ChatKitSignalMessage & {
    metadata: SignalMetadata & { signal_type: TType };
    data: GitHubWebhookForSignalType<TType>;
  };

export type GitHubSignalByType = {
  [TType in GitHubSignalType]: GitHubSignalMessage<TType>;
};

type GitHubPullRequestWebhookAction = Exclude<
  GitHubPullRequestSignalAction,
  "merged" | "synchronized"
>;

type GitHubWebhookForSignalType<TType extends GitHubSignalType> =
  TType extends `github.issue.${infer TAction extends GitHubIssueSignalAction}`
    ? GitHubIssueWebhook<TAction>
    : TType extends `github.pull_request.${infer TAction extends GitHubPullRequestSignalAction}`
      ? GitHubPullRequestWebhook<
          TAction extends "merged"
            ? "closed"
            : TAction extends "synchronized"
              ? "synchronize"
              : TAction
        >
      : TType extends GitHubCiCheckSignalType
        ? GitHubCiCheckWebhook
        : never;

export type SentryIssueSignalAction =
  | "created"
  | "assigned"
  | "resolved"
  | "unresolved"
  | "ignored";

export type SentryIssueSignalType = `sentry.issue.${SentryIssueSignalAction}`;

export type SentryWebhookProject = {
  id: unknown;
  slug: string;
  name?: string | null;
};

export type SentryWebhookOrganization = {
  id: unknown;
  slug: string;
  name?: string | null;
};

export type SentryWebhookIssue = JsonObject & {
  id: string;
  shortId?: string | null;
  title: string;
  culprit?: string | null;
  permalink?: string | null;
  status?: string | null;
  level?: string | null;
  platform?: string | null;
  project?: SentryWebhookProject | null;
};

export type SentryIssueWebhook<TAction extends SentryIssueSignalAction> = {
  action: TAction;
  installation?: { uuid: string } | null;
  actor?: { type: string; id: unknown; name: string } | null;
  data: {
    issue: SentryWebhookIssue;
    project?: SentryWebhookProject | null;
    organization?: SentryWebhookOrganization | null;
    event?: unknown;
  };
};

export type SentrySignalMessage<TType extends SentryIssueSignalType = SentryIssueSignalType> =
  ChatKitSignalMessage & {
    metadata: SignalMetadata & { signal_type: TType };
    data: SentryIssueWebhook<SentryActionForSignalType<TType>>;
  };

export type SentrySignalByType = {
  [TType in SentryIssueSignalType]: SentrySignalMessage<TType>;
};

type SentryActionForSignalType<TType extends SentryIssueSignalType> =
  TType extends `sentry.issue.${infer TAction extends SentryIssueSignalAction}` ? TAction : never;

export type SlackSignalType = "slack.app_mention" | "slack.message.posted";

export type SlackEventPayload = JsonObject & {
  type: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
};

export type SlackEventEnvelope = JsonObject & {
  event_id?: string;
  team_id?: string;
  api_app_id?: string;
  type?: string;
  event_time?: number;
  event: SlackEventPayload;
};

export type SlackSignalMessage<TType extends SlackSignalType = SlackSignalType> =
  ChatKitSignalMessage & {
    metadata: SignalMetadata & { signal_type: TType };
    data: SlackEventEnvelope;
  };

export type SlackSignalByType = {
  [TType in SlackSignalType]: SlackSignalMessage<TType>;
};

export const LINQ_WEBHOOK_EVENT_TYPES = [
  "message.sent",
  "message.received",
  "message.read",
  "message.delivered",
  "message.edited",
  "message.failed",
  "reaction.added",
  "reaction.removed",
  "poll.received",
  "poll.sent",
  "poll.delivered",
  "poll.read",
  "poll.updated",
  "poll.failed",
  "poll.vote.added",
  "poll.vote.removed",
  "poll.reaction.added",
  "participant.added",
  "participant.removed",
  "chat.created",
  "chat.group_name_updated",
  "chat.group_icon_updated",
  "chat.group_name_update_failed",
  "chat.group_icon_update_failed",
  "chat.background_updated",
  "chat.background_update_failed",
  "chat.typing_indicator.started",
  "chat.typing_indicator.stopped",
  "phone_number.status_updated",
  "contact_card.received",
  "payment.succeeded",
  "payment.canceled",
  "payment.expired",
  "payment.declined",
  "payment.authorized",
  "connection.created",
  "connection.revoked",
  "call.initiated",
  "call.ringing",
  "call.answered",
  "call.ended",
  "call.failed",
  "call.declined",
  "call.no_answer",
  "location.sharing.started",
  "location.sharing.stopped",
] as const;

export type LinqWebhookEventType = (typeof LINQ_WEBHOOK_EVENT_TYPES)[number];
export type LinqSignalType = `linq.${LinqWebhookEventType}`;

export type LinqMessageEventData = JsonObject & {
  id?: string | null;
  chat?: LinqChat | null;
  sender_handle?: LinqHandle | null;
  parts?: LinqMessagePart[];
  status?: string | null;
};

export type LinqReactionEventData = LinqMessageEventData & {
  reaction?: JsonObject | string | null;
};

export type LinqPollEventData = LinqMessageEventData & {
  poll?: JsonObject | null;
  vote?: JsonObject | null;
};

export type LinqChatEventData = JsonObject & {
  id?: string | null;
  chat?: LinqChat | null;
  participant?: LinqHandle | null;
  status?: string | null;
};

export type LinqPhoneNumberEventData = JsonObject & {
  phone_number?: string | null;
  status?: string | null;
};

export type LinqPaymentEventData = JsonObject & {
  id?: string | null;
  status?: string | null;
  amount?: number | null;
  currency?: string | null;
};

export type LinqEventData<TEvent extends LinqWebhookEventType> = TEvent extends `message.${string}`
  ? LinqMessageEventData
  : TEvent extends `reaction.${string}`
    ? LinqReactionEventData
    : TEvent extends `poll.${string}`
      ? LinqPollEventData
      : TEvent extends `payment.${string}`
        ? LinqPaymentEventData
        : TEvent extends "phone_number.status_updated"
          ? LinqPhoneNumberEventData
          : LinqChatEventData;

export type LinqWebhookEnvelope<TEvent extends LinqWebhookEventType = LinqWebhookEventType> =
  JsonObject & {
    api_version: string;
    webhook_version: string;
    event_type: TEvent;
    event_id: string;
    created_at: string;
    trace_id?: string | null;
    partner_id?: string | null;
    data: LinqEventData<TEvent>;
  };

export type LinqSignalMessage<TType extends LinqSignalType = LinqSignalType> =
  ChatKitSignalMessage & {
    metadata: SignalMetadata & { signal_type: TType };
    data: TType extends `linq.${infer TEvent extends LinqWebhookEventType}`
      ? LinqWebhookEnvelope<TEvent>
      : never;
  };

export type LinqSignalByType = {
  [TType in LinqSignalType]: LinqSignalMessage<TType>;
};

export type FakeSignalType = "fake.issue.opened" | "fake.ticket.created";

export type FakeSignalMessage<TType extends FakeSignalType = FakeSignalType> =
  ChatKitSignalMessage & {
    metadata: SignalMetadata & { signal_type: TType };
    data: JsonValue;
  };

export type FakeSignalByType = {
  [TType in FakeSignalType]: FakeSignalMessage<TType>;
};

export type ConvertToAiSdkFileUploadHandler = (input: {
  message: ConvertToAiSdkMessageInput;
  part: ChatKitUiFilePart;
}) => Awaitable<UIMessage["parts"][number] | null>;

export type ConvertToAiSdkCacheHandler = (input: {
  message: ChatKitHistoryMessage;
  convertedMessage: UIMessage;
}) => Awaitable<ChatKitConvertedMessage | null | undefined>;

export type ConvertToAiSdkHydrateHandler = (input: {
  message: ChatKitHistoryMessage;
  cachedAgentRepresentation: JsonObject;
}) => Awaitable<UIMessage | null>;

export type ConvertToAiSdkSentryHandlers = {
  [TType in SentryIssueSignalType]?: (
    signal: SentrySignalByType[TType],
  ) => Awaitable<UIMessage | null>;
};

export type ConvertToAiSdkAgentMailHandlers = {
  [TType in AgentMailSignalType]?: (
    signal: AgentMailSignalByType[TType],
  ) => Awaitable<UIMessage | null>;
};

export type ConvertToAiSdkGitHubHandlers = {
  [TType in GitHubSignalType]?: (signal: GitHubSignalByType[TType]) => Awaitable<UIMessage | null>;
};

export type ConvertToAiSdkFirecrawlHandlers = {
  [TType in FirecrawlSignalType]?: (
    signal: FirecrawlSignalByType[TType],
  ) => Awaitable<UIMessage | null>;
};

export type ConvertToAiSdkSlackHandlers = {
  [TType in SlackSignalType]?: (signal: SlackSignalByType[TType]) => Awaitable<UIMessage | null>;
};

export type ConvertToAiSdkLinqHandlers = {
  [TType in LinqSignalType]?: (signal: LinqSignalByType[TType]) => Awaitable<UIMessage | null>;
};

export type ConvertToAiSdkFakeHandlers = {
  [TType in FakeSignalType]?: (signal: FakeSignalByType[TType]) => Awaitable<UIMessage | null>;
};

/**
 * Generic fallback for signal messages no provider-specific handler
 * processed: an unknown provider, an unknown type within a known
 * provider, a shape-guard failure, or a missing per-type handler.
 */
export type ConvertToAiSdkSignalHandler = (
  signal: ChatKitSignalMessage,
) => Awaitable<UIMessage | null>;

export type ConvertToAiSdkUnprocessedHandlers = {
  agentmail?: ConvertToAiSdkAgentMailHandlers;
  fileUpload?: ConvertToAiSdkFileUploadHandler;
  fake?: ConvertToAiSdkFakeHandlers;
  firecrawl?: ConvertToAiSdkFirecrawlHandlers;
  github?: ConvertToAiSdkGitHubHandlers;
  linq?: ConvertToAiSdkLinqHandlers;
  sentry?: ConvertToAiSdkSentryHandlers;
  slack?: ConvertToAiSdkSlackHandlers;
  signal?: ConvertToAiSdkSignalHandler;
};

export type ConvertToAiSdkMessageInput = ChatKitHistoryMessage | ChatKitRequestMessage | UIMessage;

export type ConvertToAiSdkMessageOptions = {
  message: ConvertToAiSdkMessageInput;
  chatkit?: ChatKitContextClient;
  onUnprocessed?: ConvertToAiSdkUnprocessedHandlers;
  onCacheMessage?: ConvertToAiSdkCacheHandler;
  onHydrateMessage?: ConvertToAiSdkHydrateHandler;
};

export type ConvertToAiSdkMessagesOptions = Omit<ConvertToAiSdkMessageOptions, "message"> & {
  messages: Iterable<ConvertToAiSdkMessageInput>;
};

type InternalConvertToAiSdkMessageOptions = ConvertToAiSdkMessageOptions & {
  deferCache?: boolean;
  cacheEntries?: ChatKitConvertedMessage[];
};

export function isChatKitMessage(value: unknown): value is ChatKitMessage {
  if (!isJsonObject(value)) return false;
  if (typeof value.id !== "string") return false;
  if (!isAiSdkRole(value.role)) return false;
  if (
    value.cached_agent_representation !== undefined &&
    value.cached_agent_representation !== null &&
    !isJsonObject(value.cached_agent_representation)
  ) {
    return false;
  }
  if (value.type === "text") return typeof value.text === "string";
  if (value.type === "ui") {
    return Array.isArray(value.parts) && value.parts.every(isChatKitUiPart);
  }
  return false;
}

export function isChatKitSignalMessage(value: unknown): value is ChatKitSignalMessage {
  if (!isJsonObject(value)) return false;
  if (value.type !== "signal" || value.role !== "system") return false;
  if (typeof value.id !== "string") return false;
  if (
    value.cached_agent_representation !== undefined &&
    value.cached_agent_representation !== null &&
    !isJsonObject(value.cached_agent_representation)
  ) {
    return false;
  }
  if (value.summary !== undefined && value.summary !== null && typeof value.summary !== "string") {
    return false;
  }
  return value.metadata === undefined || value.metadata === null || isJsonObject(value.metadata);
}

export function isChatKitHistoryMessage(value: unknown): value is ChatKitHistoryMessage {
  return isChatKitMessage(value) || isChatKitSignalMessage(value);
}

/** Convert one ChatKit message into a Vercel AI SDK UIMessage. */
export async function convertToAiSdkMessage(
  options: ConvertToAiSdkMessageOptions,
): Promise<UIMessage | null> {
  return convertToAiSdkMessageInternal(options);
}

async function convertToAiSdkMessageInternal(
  options: InternalConvertToAiSdkMessageOptions,
): Promise<UIMessage | null> {
  const { message } = options;
  if (isChatKitSignalMessage(message)) {
    const signalOptions = {
      ...options,
      message,
    } satisfies InternalConvertToAiSdkMessageOptions & {
      message: ChatKitSignalMessage;
    };
    const hydrated = await hydrateCachedMessage(signalOptions);
    if (hydrated) return hydrated;
    const converted = await convertSignalToAiSdkMessage(message, options);
    if (converted) await cacheConvertedMessage(signalOptions, converted);
    return converted;
  }
  if (!isChatKitMessage(message)) {
    if (isChatKitRequestMessage(message)) {
      return convertRequestMessageToAiSdkMessage(message, options);
    }
    return convertUiMessageToAiSdkMessage(message, options);
  }
  const chatKitOptions = {
    ...options,
    message,
  } satisfies InternalConvertToAiSdkMessageOptions & {
    message: ChatKitMessage;
  };
  const hydrated = await hydrateCachedMessage(chatKitOptions);
  if (hydrated) return hydrated;

  const converted =
    message.type === "text"
      ? ({
          id: message.id,
          role: message.role,
          parts: [{ type: "text", text: message.text }],
          metadata: aiSdkMetadata(message),
        } as UIMessage)
      : ({
          id: message.id,
          role: message.role,
          parts: await convertPartsToAiSdkParts(message, chatKitOptions),
          metadata: aiSdkMetadata(message),
        } as UIMessage);

  await cacheConvertedMessage(chatKitOptions, converted);
  return converted;
}

async function convertRequestMessageToAiSdkMessage(
  message: ChatKitRequestMessage,
  options: ConvertToAiSdkMessageOptions,
): Promise<UIMessage> {
  const parts = (
    await Promise.all(
      message.parts.map((part) => convertRequestPartToAiSdkPart(message, part, options)),
    )
  ).filter((part): part is UIMessage["parts"][number] => part !== null);
  return {
    id: message.id,
    role: message.role,
    parts: applySpeakerPrefix(parts, message),
  } as UIMessage;
}

/**
 * Prefix the first text part with the sender's label.
 *
 * Multi-party sessions put several humans and several agents in one transcript,
 * so a model that only sees the text cannot tell who said what. Only the first
 * text part is prefixed — repeating the speaker on every part would read as
 * separate turns.
 *
 * The agent's own `assistant` messages are left alone: labelling them would
 * teach the model to write its own name into replies.
 */
function applySpeakerPrefix(
  parts: UIMessage["parts"],
  message: ChatKitRequestMessage,
): UIMessage["parts"] {
  if (!message.identity || message.role === "assistant") return parts;
  const index = parts.findIndex((part) => part.type === "text");
  if (index === -1) return parts;
  const target = parts[index] as { type: "text"; text?: string };
  const prefixed = withSpeakerPrefix(target.text ?? "", message.identity);
  const next = [...parts];
  next[index] = { ...target, text: prefixed } as UIMessage["parts"][number];
  return next;
}

async function convertRequestPartToAiSdkPart(
  message: ChatKitRequestMessage,
  part: ChatKitRequestMessagePart,
  options: ConvertToAiSdkMessageOptions,
): Promise<UIMessage["parts"][number] | null> {
  if (part.type === "text" || part.type === "reasoning") {
    return {
      type: part.type,
      text: part.text ?? "",
    } as UIMessage["parts"][number];
  }
  if (part.type === "file" && options.onUnprocessed?.fileUpload) {
    return options.onUnprocessed.fileUpload({
      message,
      part: requestFilePartToChatKitFilePart(part),
    });
  }
  if (part.type === "data") {
    return {
      type: `data-${part.dataType}`,
      data: part.data,
    } as UIMessage["parts"][number];
  }
  return part as UIMessage["parts"][number];
}

function requestFilePartToChatKitFilePart(part: ChatKitRequestFilePart): ChatKitUiFilePart {
  return {
    type: "file",
    mediaType: part.mediaType,
    url: part.url,
    ...(part.filename !== undefined ? { filename: part.filename } : {}),
    ...(isJsonObject(part.providerMetadata) ? { providerMetadata: part.providerMetadata } : {}),
  };
}

/** Convert ChatKit messages into Vercel AI SDK UIMessage objects. */
export async function convertToAiSdkMessages(
  options: ConvertToAiSdkMessagesOptions,
): Promise<UIMessage[]> {
  const converted: UIMessage[] = [];
  const cacheEntries: ChatKitConvertedMessage[] = [];
  for (const message of options.messages) {
    const convertedMessage = await convertToAiSdkMessageInternal({
      ...options,
      message,
      deferCache: true,
      cacheEntries,
    });
    if (convertedMessage) converted.push(convertedMessage);
  }
  if (cacheEntries.length > 0) {
    const chatkit = options.chatkit ?? currentChatKitContext();
    await chatkit?.cacheConvertedMessages({ messages: cacheEntries });
  }
  return converted;
}

async function hydrateCachedMessage(
  options: ConvertToAiSdkMessageOptions & { message: ChatKitHistoryMessage },
): Promise<UIMessage | null> {
  const cached = options.message.cached_agent_representation;
  if (!cached) return null;
  if (options.onHydrateMessage) {
    return options.onHydrateMessage({
      message: options.message,
      cachedAgentRepresentation: cached,
    });
  }
  return isUiMessage(cached) ? jsonObjectToUiMessage(cached) : null;
}

async function convertPartsToAiSdkParts(
  message: ChatKitUiMessage,
  options: ConvertToAiSdkMessageOptions & { message: ChatKitMessage },
): Promise<UIMessage["parts"]> {
  const parts: UIMessage["parts"] = [];
  for (const part of message.parts) {
    const converted = await convertPartToAiSdkPart(message, part, options);
    if (converted) parts.push(converted);
  }
  return parts;
}

async function convertPartToAiSdkPart(
  message: ChatKitMessage,
  part: ChatKitUiPart,
  options: ConvertToAiSdkMessageOptions & { message: ChatKitMessage },
): Promise<UIMessage["parts"][number] | null> {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text ?? "",
    } as UIMessage["parts"][number];
  }
  if (part.type === "reasoning") {
    return {
      type: "reasoning",
      text: part.text ?? "",
    } as UIMessage["parts"][number];
  }
  return options.onUnprocessed?.fileUpload
    ? options.onUnprocessed.fileUpload({ message, part })
    : null;
}

async function convertUiMessageToAiSdkMessage(
  message: UIMessage,
  options: ConvertToAiSdkMessageOptions,
): Promise<UIMessage> {
  return {
    ...message,
    parts: (
      await Promise.all(
        message.parts.map((part) => convertUiPartToAiSdkPart(message, part, options)),
      )
    ).filter((part): part is UIMessage["parts"][number] => part !== null),
  } as UIMessage;
}

async function convertUiPartToAiSdkPart(
  message: UIMessage,
  part: UIMessage["parts"][number],
  options: ConvertToAiSdkMessageOptions,
): Promise<UIMessage["parts"][number] | null> {
  if (isJsonObject(part) && part.type === "file" && options.onUnprocessed?.fileUpload) {
    return options.onUnprocessed.fileUpload({
      message,
      part: jsonObjectToChatKitUiFilePart(part),
    });
  }
  return part;
}

async function convertSignalToAiSdkMessage(
  message: ChatKitSignalMessage,
  options: ConvertToAiSdkMessageOptions,
): Promise<UIMessage | null> {
  const handlers = options.onUnprocessed;
  const providerHandler = resolveProviderSignalHandler(message, handlers);
  if (providerHandler) return providerHandler();
  return handlers?.signal ? handlers.signal(message) : null;
}

/**
 * Resolve the provider-specific handler for a signal message by the first
 * segment of its `signal_type`. Returns null when the provider is unknown,
 * the type is unknown within the provider, the shape guard fails, or no
 * handler is registered for the type — the caller then falls back to the
 * generic `signal` handler.
 */
function resolveProviderSignalHandler(
  message: ChatKitSignalMessage,
  handlers: ConvertToAiSdkUnprocessedHandlers | undefined,
): (() => Awaitable<UIMessage | null>) | null {
  const signalType = message.metadata?.signal_type;
  if (typeof signalType !== "string") return null;
  const provider = signalType.split(".", 1)[0];
  switch (provider) {
    case "agentmail": {
      if (!isAgentMailSignalType(signalType)) return null;
      if (!isAgentMailSignalMessage(message, signalType)) return null;
      const handler = handlers?.agentmail?.[signalType] as
        | ((signal: AgentMailSignalMessage) => Awaitable<UIMessage | null>)
        | undefined;
      return handler ? () => handler(message) : null;
    }
    case "firecrawl": {
      if (!isFirecrawlSignalType(signalType)) return null;
      if (!isFirecrawlSignalMessage(message, signalType)) return null;
      const handler = handlers?.firecrawl?.[signalType] as
        | ((signal: FirecrawlSignalMessage) => Awaitable<UIMessage | null>)
        | undefined;
      return handler ? () => handler(message) : null;
    }
    case "github": {
      if (!isGitHubSignalType(signalType)) return null;
      if (!isGitHubSignalMessage(message, signalType)) return null;
      const handler = handlers?.github?.[signalType] as
        | ((signal: GitHubSignalMessage) => Awaitable<UIMessage | null>)
        | undefined;
      return handler ? () => handler(message) : null;
    }
    case "sentry": {
      if (!isSentryIssueSignalType(signalType)) return null;
      if (!isSentrySignalMessage(message, signalType)) return null;
      const handler = handlers?.sentry?.[signalType] as
        | ((signal: SentrySignalMessage) => Awaitable<UIMessage | null>)
        | undefined;
      return handler ? () => handler(message) : null;
    }
    case "linq": {
      if (!isLinqSignalType(signalType)) return null;
      if (!isLinqSignalMessage(message, signalType)) return null;
      const handler = handlers?.linq?.[signalType] as
        | ((signal: LinqSignalMessage) => Awaitable<UIMessage | null>)
        | undefined;
      return handler ? () => handler(message) : null;
    }
    case "slack": {
      if (!isSlackSignalType(signalType)) return null;
      if (!isSlackSignalMessage(message, signalType)) return null;
      const handler = handlers?.slack?.[signalType] as
        | ((signal: SlackSignalMessage) => Awaitable<UIMessage | null>)
        | undefined;
      return handler ? () => handler(message) : null;
    }
    case "fake": {
      if (!isFakeSignalType(signalType)) return null;
      if (!isFakeSignalMessage(message, signalType)) return null;
      const handler = handlers?.fake?.[signalType] as
        | ((signal: FakeSignalMessage) => Awaitable<UIMessage | null>)
        | undefined;
      return handler ? () => handler(message) : null;
    }
    default:
      return null;
  }
}

async function cacheConvertedMessage(
  options: InternalConvertToAiSdkMessageOptions & {
    message: ChatKitHistoryMessage;
  },
  convertedMessage: UIMessage,
): Promise<void> {
  const cacheEntry = options.onCacheMessage
    ? await options.onCacheMessage({
        message: options.message,
        convertedMessage,
      })
    : defaultConvertedMessageCacheEntry(options.message, convertedMessage);
  if (!cacheEntry) return;
  if (options.deferCache) {
    options.cacheEntries?.push(cacheEntry);
    return;
  }
  const chatkit = options.chatkit ?? currentChatKitContext();
  if (!chatkit) return;
  await chatkit.cacheConvertedMessages({
    messages: [cacheEntry],
  });
}

function defaultConvertedMessageCacheEntry(
  message: ChatKitHistoryMessage,
  convertedMessage: UIMessage,
): ChatKitConvertedMessage {
  return {
    chatKitMessageId: message.id,
    message: uiMessageToJsonObject(convertedMessage),
  };
}

function aiSdkMetadata(message: ChatKitMessage): JsonObject {
  return {
    createdAt: message.created_at,
    updatedAt: message.updated_at,
    chatkit: {
      metadata: message.metadata ?? undefined,
      providerMetadata: message.provider_metadata ?? undefined,
    },
  };
}

function isChatKitUiPart(value: unknown): value is ChatKitUiPart {
  if (!isJsonObject(value) || typeof value.type !== "string") return false;
  if (value.type === "text" || value.type === "reasoning") {
    return value.text === undefined || value.text === null || typeof value.text === "string";
  }
  if (value.type === "file") return typeof value.url === "string";
  return false;
}

function isUiMessage(value: JsonObject): boolean {
  return typeof value.id === "string" && isAiSdkRole(value.role) && Array.isArray(value.parts);
}

function isAiSdkRole(value: unknown): value is UIMessage["role"] {
  return value === "system" || value === "user" || value === "assistant";
}

function isFirecrawlSignalType(value: unknown): value is FirecrawlSignalType {
  return (
    value === "firecrawl.monitor.page.same" ||
    value === "firecrawl.monitor.page.new" ||
    value === "firecrawl.monitor.page.changed" ||
    value === "firecrawl.monitor.page.removed" ||
    value === "firecrawl.monitor.page.error" ||
    value === "firecrawl.monitor.check.completed"
  );
}

function isAgentMailSignalType(value: unknown): value is AgentMailSignalType {
  return (
    value === "agentmail.domain.verified" ||
    value === "agentmail.message.bounced" ||
    value === "agentmail.message.complained" ||
    value === "agentmail.message.delivered" ||
    value === "agentmail.message.received" ||
    value === "agentmail.message.received.blocked" ||
    value === "agentmail.message.received.spam" ||
    value === "agentmail.message.received.unauthenticated" ||
    value === "agentmail.message.rejected" ||
    value === "agentmail.message.security.completed" ||
    value === "agentmail.message.security.override" ||
    value === "agentmail.message.security.review" ||
    value === "agentmail.message.sent"
  );
}

function isAgentMailSignalMessage<TType extends AgentMailSignalType>(
  message: ChatKitSignalMessage,
  signalType: TType,
): message is AgentMailSignalMessage<TType> {
  const data = message.data;
  if (
    !isJsonObject(data) ||
    typeof data.event_id !== "string" ||
    data.event_type !== signalType.slice("agentmail.".length)
  ) {
    return false;
  }
  if (signalType === "agentmail.domain.verified") {
    if (!isAgentMailDomain(data.domain)) return false;
  } else if (!isAgentMailMessage(data.message)) {
    return false;
  }
  if (data.thread !== undefined && data.thread !== null && !isAgentMailThread(data.thread)) {
    return false;
  }
  return data.domain === undefined || data.domain === null || isAgentMailDomain(data.domain);
}

function isAgentMailMessage(value: unknown): value is AgentMailMessage {
  return (
    isJsonObject(value) &&
    typeof value.inbox_id === "string" &&
    typeof value.thread_id === "string" &&
    typeof value.message_id === "string"
  );
}

function isAgentMailThread(value: unknown): value is AgentMailThread {
  return (
    isJsonObject(value) && typeof value.inbox_id === "string" && typeof value.thread_id === "string"
  );
}

function isAgentMailDomain(value: unknown): value is AgentMailDomain {
  return (
    isJsonObject(value) && typeof value.domain_id === "string" && typeof value.domain === "string"
  );
}

function isFirecrawlSignalMessage<TType extends FirecrawlSignalType>(
  message: ChatKitSignalMessage,
  signalType: TType,
): message is FirecrawlSignalMessage<TType> {
  const data = message.data;
  if (!isJsonObject(data) || !isJsonObject(data.monitor) || !isJsonObject(data.check)) {
    return false;
  }
  if (signalType.startsWith("firecrawl.monitor.page.")) {
    return (
      data.event === "monitor.page" &&
      isNullableString(data.monitor.id) &&
      isNullableString(data.check.id) &&
      isFirecrawlMonitorPage(data.page)
    );
  }
  return (
    data.event === "monitor.check.completed" &&
    typeof data.monitor.id === "string" &&
    typeof data.check.id === "string" &&
    isJsonObject(data.result)
  );
}

function isFirecrawlMonitorPage(value: unknown): value is FirecrawlMonitorPage {
  return isJsonObject(value) && typeof value.url === "string" && typeof value.status === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isGitHubSignalType(value: unknown): value is GitHubSignalType {
  return (
    value === "github.issue.opened" ||
    value === "github.issue.reopened" ||
    value === "github.issue.closed" ||
    value === "github.issue.edited" ||
    value === "github.issue.labeled" ||
    value === "github.pull_request.opened" ||
    value === "github.pull_request.reopened" ||
    value === "github.pull_request.closed" ||
    value === "github.pull_request.merged" ||
    value === "github.pull_request.synchronize" ||
    value === "github.pull_request.synchronized" ||
    value === "github.pull_request.ready_for_review" ||
    value === "github.pull_request.converted_to_draft" ||
    value === "github.ci_check.passed" ||
    value === "github.ci_check.failed"
  );
}

function isGitHubSignalMessage<TType extends GitHubSignalType>(
  message: ChatKitSignalMessage,
  signalType: TType,
): message is GitHubSignalMessage<TType> {
  const data = message.data;
  if (!isJsonObject(data) || !isGitHubRepository(data.repository)) return false;
  if (signalType.startsWith("github.issue.")) {
    return data.action === signalType.slice("github.issue.".length) && isGitHubIssue(data.issue);
  }
  if (signalType.startsWith("github.pull_request.")) {
    const signalAction = signalType.slice("github.pull_request.".length);
    const webhookAction =
      signalAction === "merged"
        ? "closed"
        : signalAction === "synchronized"
          ? "synchronize"
          : signalAction;
    return data.action === webhookAction && isGitHubPullRequest(data.pull_request);
  }
  return (
    data.action === "completed" &&
    (isGitHubCheck(data.check_run) || isGitHubCheck(data.check_suite))
  );
}

function isGitHubRepository(value: unknown): value is GitHubWebhookRepository {
  return isJsonObject(value) && typeof value.full_name === "string";
}

function isGitHubIssue(value: unknown): value is GitHubWebhookIssue {
  return isJsonObject(value) && typeof value.number === "number" && typeof value.title === "string";
}

function isGitHubPullRequest(value: unknown): value is GitHubWebhookPullRequest {
  return isGitHubIssue(value);
}

function isGitHubCheck(value: unknown): value is GitHubWebhookCheck {
  return isJsonObject(value);
}

function isSentryIssueSignalType(value: unknown): value is SentryIssueSignalType {
  return (
    value === "sentry.issue.created" ||
    value === "sentry.issue.assigned" ||
    value === "sentry.issue.resolved" ||
    value === "sentry.issue.unresolved" ||
    value === "sentry.issue.ignored"
  );
}

function isSentrySignalMessage<TType extends SentryIssueSignalType>(
  message: ChatKitSignalMessage,
  signalType: TType,
): message is SentrySignalMessage<TType> {
  const action = signalType.slice("sentry.issue.".length);
  const data = message.data;
  if (!isJsonObject(data) || data.action !== action || !isJsonObject(data.data)) {
    return false;
  }
  const issue = data.data.issue;
  return isJsonObject(issue) && typeof issue.id === "string" && typeof issue.title === "string";
}

function isSlackSignalType(value: unknown): value is SlackSignalType {
  return value === "slack.app_mention" || value === "slack.message.posted";
}

export function isLinqSignalType(value: unknown): value is LinqSignalType {
  if (typeof value !== "string" || !value.startsWith("linq.")) return false;
  return (LINQ_WEBHOOK_EVENT_TYPES as readonly string[]).includes(value.slice("linq.".length));
}

export function isLinqSignalMessage<TType extends LinqSignalType>(
  message: ChatKitSignalMessage,
  signalType: TType,
): message is LinqSignalMessage<TType> {
  const data = message.data;
  if (!isJsonObject(data) || !isJsonObject(data.data)) return false;
  return (
    data.event_type === signalType.slice("linq.".length) &&
    typeof data.api_version === "string" &&
    typeof data.webhook_version === "string" &&
    typeof data.event_id === "string" &&
    typeof data.created_at === "string"
  );
}

function isSlackSignalMessage<TType extends SlackSignalType>(
  message: ChatKitSignalMessage,
  _signalType: TType,
): message is SlackSignalMessage<TType> {
  const data = message.data;
  return isJsonObject(data) && isJsonObject(data.event) && typeof data.event.type === "string";
}

function isFakeSignalType(value: unknown): value is FakeSignalType {
  return value === "fake.issue.opened" || value === "fake.ticket.created";
}

function isFakeSignalMessage<TType extends FakeSignalType>(
  message: ChatKitSignalMessage,
  _signalType: TType,
): message is FakeSignalMessage<TType> {
  return message.data !== undefined;
}

function uiMessageToJsonObject(message: UIMessage): JsonObject {
  return message as unknown as JsonObject;
}

function jsonObjectToUiMessage(message: JsonObject): UIMessage {
  return message as unknown as UIMessage;
}

function jsonObjectToChatKitUiFilePart(part: JsonObject): ChatKitUiFilePart {
  return part as unknown as ChatKitUiFilePart;
}
