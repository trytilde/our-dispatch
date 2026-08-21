import type { ReactNode } from "react";
import {
  ConnectorAccountGrid,
  connectorSelectionViewFromPart,
  type ConnectorAccountView,
  type ConnectorSelectionView,
} from "./connector-components.js";
import { ThinkingBlock, ToolsBlock } from "./message-blocks.js";
import {
  ConnectionCard,
  FileCard,
  formatState,
  JsonBlock,
  MarkdownText,
  type MessagePart,
  safeUrl,
  stringify,
  type ConnectionView,
} from "./rich-message-components.js";

export type { MessagePart } from "./rich-message-components.js";

export interface MessageContentMessage {
  type: string;
  session_id: string;
  text?: string;
  summary?: string | null;
  data?: Record<string, unknown> | null;
  parts?: MessagePart[];
  metadata?: unknown;
}

/** Owner interactions for in-chat connector selection cards. */
export interface ConnectorPartActions {
  onSelectAccount: (selection: ConnectorSelectionView, account: ConnectorAccountView) => void;
  onAddAccount: (selection: ConnectorSelectionView) => void;
  busy?: boolean;
}

export interface MessageContentProps {
  message: MessageContentMessage;
  resolveAttachmentUrl: (sessionId: string, attachmentId: string) => Promise<string>;
  rewriteUrl?: (url: string) => string;
  connectorActions?: ConnectorPartActions;
}

export function MessageContent({
  message,
  resolveAttachmentUrl,
  rewriteUrl = (url) => url,
  connectorActions,
}: MessageContentProps) {
  if (message.type === "ui" && message.parts) {
    const mediaParts = message.parts.filter(
      (part) => part.type === "file" || part.type === "image",
    );
    const imageGallery =
      mediaParts.length > 1 &&
      mediaParts.length === message.parts.length &&
      mediaParts.every((part) => (part.media_type ?? part.mediaType ?? "").startsWith("image/"));
    return (
      <div className={`message-parts ${imageGallery ? "media-gallery" : ""}`}>
        {message.parts.map((part, index) =>
          renderPart(
            part,
            index,
            message.session_id,
            resolveAttachmentUrl,
            rewriteUrl,
            connectorActions,
          ),
        )}
      </div>
    );
  }
  // Regular messages can carry attachments alongside (or instead of) text.
  const attachmentParts = (message.parts ?? []).filter(
    (part) => part.type === "file" || part.type === "image",
  );
  const text = message.text ?? signalText(message);
  if (attachmentParts.length > 0) {
    return (
      <div className="message-parts">
        {text.trim() ? <MarkdownText text={text} /> : null}
        {attachmentParts.map((part, index) =>
          renderPart(
            { ...part, type: "file" },
            index,
            message.session_id,
            resolveAttachmentUrl,
            rewriteUrl,
          ),
        )}
      </div>
    );
  }
  return <MarkdownText text={text} />;
}

function renderPart(
  part: MessagePart,
  index: number,
  sessionId: string,
  resolveAttachmentUrl: MessageContentProps["resolveAttachmentUrl"],
  rewriteUrl: NonNullable<MessageContentProps["rewriteUrl"]>,
  connectorActions?: ConnectorPartActions,
): ReactNode {
  const key = `${part.type}-${part.tool_invocation_id ?? part.toolCallId ?? part.attachment_id ?? part.attachmentId ?? index}`;
  const connectorSelection = connectorSelectionViewFromPart(part);
  if (connectorSelection) {
    return (
      <ConnectorAccountGrid
        busy={connectorActions?.busy ?? false}
        key={key}
        selection={connectorSelection}
        {...(connectorActions
          ? {
              onSelectAccount: (account: ConnectorAccountView) =>
                connectorActions.onSelectAccount(connectorSelection, account),
              onAddAccount: () => connectorActions.onAddAccount(connectorSelection),
            }
          : {})}
      />
    );
  }
  if (isToolPart(part)) return <ToolsBlock key={key} parts={[part]} />;
  switch (part.type) {
    case "text":
      return <MarkdownText key={key} text={part.text ?? ""} />;
    case "reasoning":
      return part.text ? <ThinkingBlock key={key} part={part} /> : null;
    case "image":
    case "file": {
      return (
        <FileCard
          key={key}
          part={part}
          sessionId={sessionId}
          resolveAttachmentUrl={resolveAttachmentUrl}
          rewriteUrl={rewriteUrl}
        />
      );
    }
    case "source-url": {
      const href = part.url ? safeUrl(part.url) : undefined;
      return href ? (
        <a className="source-part" href={href} key={key} rel="noreferrer" target="_blank">
          {part.title || href} <span>↗</span>
        </a>
      ) : null;
    }
    case "source-document":
      return (
        <span className="source-part" key={key}>
          {part.title || part.filename || "Source document"}
        </span>
      );
    case "step-start":
      return <hr className="step-start" key={key} />;
    case "data":
      return <JsonBlock key={key} label="Data" value={part.data ?? part} />;
    case "connector":
    case "send-message/connector":
      return <ConnectionCard key={key} connection={connectionFrom(part)} />;
    case "connectors":
    case "send-message/connectors":
      return (
        <div className="connection-list" key={key}>
          <strong>Connect tools</strong>
          {connectionsFrom(part).map((connection) => (
            <ConnectionCard connection={connection} key={connection.id} />
          ))}
        </div>
      );
    default:
      return <JsonBlock key={key} label={formatState(part.type)} value={part} />;
  }
}

function connectionFrom(part: MessagePart): ConnectionView {
  const data = asRecord(part.data);
  const nested = asRecord(data.message);
  const name = firstText(
    part,
    data,
    nested,
    "connector",
    "name",
    "display_name",
    "displayName",
    "title",
    "provider",
  );
  const variant = firstText(part, data, nested, "variant", "status", "state");
  const authorizationUrl = safeUrl(
    firstText(
      part,
      data,
      nested,
      "authorization_url",
      "authorizationUrl",
      "authorize_url",
      "authorizeUrl",
      "auth_url",
      "authUrl",
      "url",
    ),
  );
  return {
    id:
      firstText(part, data, nested, "id", "server_id", "serverId", "connector_id", "connectorId") ||
      name ||
      "connection",
    name: name || "Connection",
    description: firstText(part, data, nested, "reason", "description", "subtitle"),
    status: variant === "connected" ? "Connected" : variant || "Needs authorization",
    ...(authorizationUrl ? { authorizationUrl } : {}),
  };
}

function connectionsFrom(part: MessagePart): ConnectionView[] {
  const data = asRecord(part.data);
  const source = part as unknown as Record<string, unknown>;
  const candidates = Array.isArray(part.data)
    ? part.data
    : Array.isArray(source.connectors)
      ? source.connectors
      : Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.connectors)
          ? data.connectors
          : [];
  return candidates.map((candidate) => connectionFrom({ type: "connector", data: candidate }));
}

function firstText(
  part: MessagePart,
  data: Record<string, unknown>,
  nested: Record<string, unknown>,
  ...keys: string[]
): string {
  const source = part as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (typeof source[key] === "string") return source[key];
    if (typeof data[key] === "string") return data[key];
    if (typeof nested[key] === "string") return nested[key];
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isToolPart(part: MessagePart): boolean {
  return part.type === "tool" || part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function signalText(message: MessageContentMessage): string {
  if (message.summary) return message.summary;
  const metadata = message.metadata;
  if (typeof metadata === "object" && metadata !== null && "summary" in metadata) {
    return String((metadata as { summary: unknown }).summary);
  }
  if (message.type === "signal" && message.data) return stringify(message.data);
  return message.type === "signal" ? "Signal received" : "";
}
