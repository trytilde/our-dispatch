import type { ReactNode } from "react";
import { PanelRightIcon } from "lucide-react";
import { AgentAvatar } from "./agent-avatar.js";
import { LoaderGrid, useElapsed } from "./beautiful-ui/blocks/loader-grid.js";
import { ComputerIcon, MoreIcon, ReplyIcon } from "./workspace-icons.js";

export interface ChatHeaderProps {
  agentId?: string;
  agentName: string;
  /** Agent is mid-turn — the avatar spins its orbit. */
  busy?: boolean;
  computerOpen: boolean;
  onToggleComputer: () => void;
  detailsOpen?: boolean;
  onToggleDetails?: (() => void) | undefined;
}

export function ChatHeader({
  agentId,
  agentName,
  busy = false,
  computerOpen,
  onToggleComputer,
  detailsOpen = false,
  onToggleDetails,
}: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div className="chat-identity">
        {agentId ? (
          <AgentAvatar id={agentId} state={busy ? "working" : "idle"} />
        ) : (
          <span className="agent-avatar">O</span>
        )}
        <div className="chat-title">
          <h2>{agentName}</h2>
        </div>
      </div>
      <div className="chat-actions">
        {onToggleDetails ? (
          <button
            aria-expanded={detailsOpen}
            aria-label="Toggle details"
            className={detailsOpen ? "active" : ""}
            onClick={onToggleDetails}
            title="Toggle details (Ctrl+Alt+D)"
          >
            <PanelRightIcon aria-hidden />
          </button>
        ) : null}
        <button
          aria-expanded={computerOpen}
          aria-label="Toggle Computer pane"
          className={computerOpen ? "active" : ""}
          onClick={onToggleComputer}
          title="Toggle Computer pane (Ctrl+Alt+B)"
        >
          <ComputerIcon />
        </button>
      </div>
    </header>
  );
}

export interface ConversationMessageProps {
  role: string;
  createdAt: string;
  continuedPrevious?: boolean;
  continuedNext?: boolean;
  /** Message is attachments only — the bubble renders bare. */
  mediaOnly?: boolean;
  children: ReactNode;
  menuOpen?: boolean;
  onReply?: () => void;
  onToggleMenu?: () => void;
  onStartThread?: () => void;
  onCopy?: () => void;
}

export function ConversationMessage({
  role,
  createdAt,
  continuedPrevious = false,
  continuedNext = false,
  mediaOnly = false,
  children,
  menuOpen = false,
  onReply,
  onToggleMenu,
  onStartThread,
  onCopy,
}: ConversationMessageProps) {
  return (
    <article
      aria-label={role === "user" ? "Your message" : "Agent message"}
      className={`message ${role} ${continuedPrevious ? "continued-previous" : "group-start"} ${continuedNext ? "continued-next" : ""} ${mediaOnly ? "media-only" : ""}`}
    >
      <div className="message-bubble">{children}</div>
      <div className="message-footer">
        <time dateTime={createdAt}>{formatTime(createdAt)}</time>
      </div>
      {onReply || onToggleMenu ? (
        <div className="message-actions">
          {onReply ? (
            <button aria-label="Reply" onClick={onReply}>
              <ReplyIcon />
            </button>
          ) : null}
          {onToggleMenu ? (
            <button aria-label="More message actions" onClick={onToggleMenu}>
              <MoreIcon />
            </button>
          ) : null}
          {menuOpen ? (
            <div className="message-menu" role="menu">
              {onStartThread ? (
                <button role="menuitem" onClick={onStartThread}>
                  Start a thread
                </button>
              ) : null}
              {onCopy ? (
                <button role="menuitem" onClick={onCopy}>
                  Copy
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ThinkingIndicator({ children }: { children: ReactNode }) {
  const elapsed = useElapsed();
  return (
    <div className="thinking-inline" role="status">
      <LoaderGrid variant="drive" />
      <span
        className="bg-clip-text text-[13px] font-medium text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {children}
      </span>
      <span className="font-mono text-[12px] text-ink-3 tabular-nums">{elapsed}</span>
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
