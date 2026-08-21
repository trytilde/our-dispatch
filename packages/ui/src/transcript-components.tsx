import { type ReactNode, useEffect, useRef } from "react";

export interface ChatFindBarProps {
  query: string;
  matchCount: number;
  currentOrdinal: number;
  focusNonce?: number;
  onQueryChange: (query: string) => void;
  onStepNext: () => void;
  onStepPrevious: () => void;
  onClose: () => void;
}

export function ChatFindBar({
  query,
  matchCount,
  currentOrdinal,
  focusNonce = 0,
  onQueryChange,
  onStepNext,
  onStepPrevious,
  onClose,
}: ChatFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusNonce]);

  return (
    <div className="chat-find-bar">
      <span aria-hidden="true" className="chat-find-icon">
        ⌕
      </span>
      <input
        aria-label="Find in chat"
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) onStepPrevious();
            else onStepNext();
          }
        }}
        placeholder="Find in chat"
        ref={inputRef}
        spellCheck={false}
        type="text"
        value={query}
      />
      {query.trim() ? (
        <span className={matchCount === 0 ? "empty" : ""} role="status">
          {currentOrdinal}/{matchCount}
        </span>
      ) : null}
      <i aria-hidden="true" />
      <button aria-label="Previous match" disabled={matchCount === 0} onClick={onStepPrevious}>
        ↑
      </button>
      <button aria-label="Next match" disabled={matchCount === 0} onClick={onStepNext}>
        ↓
      </button>
      <button aria-label="Close find" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

export function TranscriptLoading({ children }: { children?: ReactNode }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading conversation"
      className="chat-transcript-loading"
      role="status"
    >
      {children ?? <span aria-hidden="true" className="transcript-loading-spinner" />}
    </div>
  );
}

export function ConversationSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading conversation"
      className="conversation-loading conversation-skeleton"
      role="status"
    >
      <span className="sr-only">Loading conversation</span>
      <div className="conversation-skeleton-row assistant" aria-hidden="true">
        <span className="conversation-skeleton-avatar" />
        <span className="conversation-skeleton-bubble wide">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="conversation-skeleton-row user" aria-hidden="true">
        <span className="conversation-skeleton-bubble compact">
          <i />
          <i />
        </span>
      </div>
      <div className="conversation-skeleton-row assistant" aria-hidden="true">
        <span className="conversation-skeleton-avatar" />
        <span className="conversation-skeleton-bubble medium">
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

export function TranscriptError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      aria-describedby="openbot-transcript-error-detail"
      aria-labelledby="openbot-transcript-error-title"
      className="chat-transcript-loading"
      role="alert"
    >
      <div className="chat-transcript-error">
        <h2 id="openbot-transcript-error-title">Couldn&apos;t load conversation</h2>
        <p id="openbot-transcript-error-detail">
          Couldn&apos;t load this conversation. Check your connection and try again.
        </p>
        <button onClick={onRetry} type="button">
          Retry
        </button>
      </div>
    </div>
  );
}

export interface NewMessagesPillProps {
  count: number;
  direction: "up" | "down";
  onJump: () => void;
  onDismiss: () => void;
}

export function NewMessagesPill({ count, direction, onJump, onDismiss }: NewMessagesPillProps) {
  const label = count === 1 ? "1 new message" : `${count} new messages`;
  return (
    <div className="new-messages-pill" data-direction={direction}>
      <button className="new-messages-pill-jump" onClick={onJump} type="button">
        <span aria-hidden="true">{direction === "up" ? "↑" : "↓"}</span>
        {label}
      </button>
      <button
        aria-label="Dismiss new messages"
        className="new-messages-pill-dismiss"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        type="button"
      >
        ×
      </button>
    </div>
  );
}

export function UnreadDivider() {
  return (
    <div aria-label="New messages" className="unread-divider" role="separator">
      <span aria-hidden="true" />
      <strong>New</strong>
      <span aria-hidden="true" />
    </div>
  );
}

export interface QueuedSendNoticeProps {
  transportDown?: boolean;
  cancellable?: boolean;
  onCancel?: () => void;
}

export function QueuedSendNotice({
  transportDown = true,
  cancellable = false,
  onCancel,
}: QueuedSendNoticeProps) {
  return (
    <div className="message-send-notice queued-send-notice" role="status">
      <span>{transportDown ? "Will send when reconnected" : "Waiting to send…"}</span>
      {cancellable && onCancel ? (
        <button onClick={onCancel} type="button">
          Cancel
        </button>
      ) : null}
    </div>
  );
}

export function SentWhileOfflineNotice({ composedAt }: { composedAt: Date | number | string }) {
  const date = composedAt instanceof Date ? composedAt : new Date(composedAt);
  const formatted = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return (
    <div className="message-send-notice sent-while-offline-notice" role="status">
      <span>Sent while offline · {formatted}</span>
    </div>
  );
}

export interface FailedSendActionsProps {
  onResend: () => void;
  onDelete: () => void;
}

export function FailedSendActions({ onResend, onDelete }: FailedSendActionsProps) {
  return (
    <div aria-label="Failed message actions" className="message-send-notice" role="group">
      <span className="failed-send-label" role="status">
        Failed to send
      </span>
      <button onClick={onResend} type="button">
        Resend
      </button>
      <button onClick={onDelete} type="button">
        Delete
      </button>
    </div>
  );
}

export interface TranscriptNoticeProps {
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "warning" | "danger";
}

export function TranscriptNotice({
  children,
  actionLabel,
  onAction,
  tone = "neutral",
}: TranscriptNoticeProps) {
  return (
    <div className="transcript-notice" data-tone={tone} role="status">
      <span>{children}</span>
      {actionLabel && onAction ? (
        <button onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function TranscriptTimeSeparator({ label, dateTime }: { label: string; dateTime?: string }) {
  return (
    <div className="transcript-time-separator" role="separator">
      <span aria-hidden="true" />
      <time dateTime={dateTime}>{label}</time>
      <span aria-hidden="true" />
    </div>
  );
}

export function SystemEvent({ children }: { children: ReactNode }) {
  return <div className="system-event">{children}</div>;
}

export function SystemEventLabel({
  children,
  tone = "secondary",
}: {
  children: ReactNode;
  tone?: "secondary" | "tertiary";
}) {
  return (
    <span className="system-event-label" data-tone={tone}>
      {children}
    </span>
  );
}

export function SystemEventChip({
  children,
  leading,
  onClick,
}: {
  children: ReactNode;
  leading?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      {leading ? <span aria-hidden="true">{leading}</span> : null}
      <span>{children}</span>
    </>
  );
  return onClick ? (
    <button className="system-event-chip" onClick={onClick} type="button">
      {content}
    </button>
  ) : (
    <span className="system-event-chip">{content}</span>
  );
}

export interface UnknownMessageCardProps {
  messageType: string;
  content?: ReactNode;
  variant?: "unknown" | "retired";
  productName?: string;
}

export function UnknownMessageCard({
  messageType,
  content,
  variant = "unknown",
  productName = "OpenBot",
}: UnknownMessageCardProps) {
  const fullMessage =
    variant === "retired"
      ? `This message type is no longer supported in ${productName}.`
      : `This message can’t be shown in this version of ${productName}. Update ${productName} to see it.`;
  const shortMessage =
    variant === "retired" ? fullMessage : `Update ${productName} to see the full message.`;
  return (
    <div className="unknown-message-card" data-message-type={messageType}>
      {content ? (
        <>
          <div>{content}</div>
          <small>{shortMessage}</small>
        </>
      ) : (
        <p>{fullMessage}</p>
      )}
    </div>
  );
}
