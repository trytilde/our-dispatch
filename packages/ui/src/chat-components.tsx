import type { ReactNode } from "react";
import { AgentAvatar } from "./agent-avatar.js";
import { ClockIcon, ComputerIcon, ListIcon, MoreIcon, ReplyIcon } from "./workspace-icons.js";

export interface ChatHeaderProps {
  agentId?: string;
  agentName: string;
  status?: string;
  computerOpen: boolean;
  onToggleComputer: () => void;
  conversationOutlineOpen?: boolean;
  asyncTasksOpen?: boolean;
  onToggleConversationOutline?: () => void;
  onToggleAsyncTasks?: () => void;
}

export function ChatHeader({
  agentId,
  agentName,
  status,
  computerOpen,
  onToggleComputer,
  conversationOutlineOpen = false,
  asyncTasksOpen = false,
  onToggleConversationOutline,
  onToggleAsyncTasks,
}: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div className="chat-identity">
        {agentId ? <AgentAvatar id={agentId} /> : <span className="agent-avatar">O</span>}
        <div className="chat-title">
          <h2>{agentName}</h2>
          <span>{status}</span>
        </div>
      </div>
      <div className="chat-actions">
        {onToggleConversationOutline ? (
          <button
            aria-expanded={conversationOutlineOpen}
            aria-label="Toggle full conversation"
            className={conversationOutlineOpen ? "active" : ""}
            onClick={onToggleConversationOutline}
            title="Full conversation"
          >
            <ListIcon />
          </button>
        ) : null}
        {onToggleAsyncTasks ? (
          <button
            aria-expanded={asyncTasksOpen}
            aria-label="Toggle async tasks"
            className={asyncTasksOpen ? "active" : ""}
            onClick={onToggleAsyncTasks}
            title="Async tasks"
          >
            <ClockIcon />
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

export interface EmptyConversationProps {
  title?: string;
  description?: string;
  suggestions: readonly string[];
  onSelectSuggestion: (suggestion: string) => void;
}

export function EmptyConversation({
  title = "What should OpenBot do?",
  description = "Message an agent. It can use tools, skills, files, and its Computer.",
  suggestions,
  onSelectSuggestion,
}: EmptyConversationProps) {
  return (
    <div className="empty-chat">
      <div className="openbot-glyph">✣</div>
      <h1>{title}</h1>
      <p>{description}</p>
      <div className="suggestions">
        {suggestions.map((suggestion) => (
          <button key={suggestion} onClick={() => onSelectSuggestion(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ConversationMessageProps {
  role: string;
  createdAt: string;
  continuedPrevious?: boolean;
  continuedNext?: boolean;
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
      className={`message ${role} ${continuedPrevious ? "continued-previous" : "group-start"} ${continuedNext ? "continued-next" : ""}`}
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
  return (
    <div className="thinking-inline">
      <span /> {children}
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
