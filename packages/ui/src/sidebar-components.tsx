import { useEffect, useId, useRef, useState } from "react";
import { AgentAvatar } from "./agent-avatar.js";
import { SearchIcon } from "./workspace-icons.js";

export interface SidebarAgent {
  id: string;
  name: string;
  lastMessage?: string;
  updatedAt?: string;
  unread?: boolean;
}

export interface AgentListItemProps {
  agent: SidebarAgent;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function AgentListItem({ agent, selected, onSelect }: AgentListItemProps) {
  return (
    <button
      className={selected ? "agent-row active" : "agent-row"}
      aria-current={selected ? "page" : undefined}
      data-selected={selected || undefined}
      data-unread={agent.unread || undefined}
      onClick={() => onSelect(agent.id)}
      title={agent.name}
      type="button"
    >
      <AgentAvatar id={agent.id} />
      <span className={agent.unread ? "agent-row-body has-marker" : "agent-row-body"}>
        <span className="agent-row-title">
          <strong>{agent.name}</strong>
          {agent.updatedAt ? (
            <time dateTime={agent.updatedAt}>{relativeTime(agent.updatedAt)}</time>
          ) : null}
        </span>
        {agent.lastMessage ? <small>{agent.lastMessage}</small> : null}
      </span>
      {agent.unread ? (
        <span aria-label="Unread activity" className="agent-row-marker" role="status">
          <i />
        </span>
      ) : null}
    </button>
  );
}

export interface AgentSearchDialogProps {
  agents: readonly SidebarAgent[];
  loading: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
}

export function AgentSearchDialog({
  agents,
  loading,
  value,
  onChange,
  onClose,
  onSelect,
}: AgentSearchDialogProps) {
  return (
    <div className="sidebar-search-overlay" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Search agents"
        aria-modal="true"
        className="sidebar-search-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <label>
          <SearchIcon />
          <input
            aria-label="Search agents"
            autoFocus
            onChange={(event) => onChange(event.target.value)}
            placeholder="Search agents"
            value={value}
          />
        </label>
        <div className="sidebar-search-results">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => {
                onClose();
                onSelect(agent.id);
              }}
              type="button"
            >
              <AgentAvatar id={agent.id} />
              <span>
                <strong>{agent.name}</strong>
                {agent.lastMessage ? <small>{agent.lastMessage}</small> : null}
              </span>
            </button>
          ))}
          {!loading && agents.length === 0 ? <p>No agents found</p> : null}
        </div>
      </section>
    </div>
  );
}

export interface WorkspaceAccountProps {
  name?: string;
  defaultOpen?: boolean;
}

const accountMenuItems = [
  { icon: "gear", label: "Settings" },
  { icon: "info", label: "About" },
  { icon: "help", label: "Help Center" },
  { icon: "feedback", label: "Send Feedback" },
] as const;

export function WorkspaceAccount({
  name = "Daniel Adams",
  defaultOpen = false,
}: WorkspaceAccountProps) {
  const [open, setOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="rail-account" ref={containerRef}>
      {open ? (
        <div aria-label="Account" className="account-menu" id={menuId} role="menu">
          <div className="account-menu-section">
            {accountMenuItems.map((item) => (
              <button key={item.label} onClick={() => setOpen(false)} role="menuitem" type="button">
                <AccountMenuIcon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="account-menu-section">
            <button onClick={() => setOpen(false)} role="menuitem" type="button">
              <AccountMenuIcon name="logout" />
              <span>Log out</span>
            </button>
          </div>
        </div>
      ) : null}
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Open account menu for ${name}`}
        className="rail-footer"
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        <span aria-hidden="true" className="footer-avatar">
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="account-name">{name}</span>
      </button>
    </div>
  );
}

function AccountMenuIcon({ name }: { name: (typeof accountMenuItems)[number]["icon"] | "logout" }) {
  const path = {
    gear: "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0-3v1.25m0 8.5v1.25m5.5-5.5h-1.25M3.75 8H2.5m9.39-3.89-.88.88m-6.02 6.02-.88.88m7.78 0-.88-.88M4.99 4.99l-.88-.88",
    info: "M8 13.25A5.25 5.25 0 1 0 8 2.75a5.25 5.25 0 0 0 0 10.5ZM8 7v3.25M8 5.25h.01",
    help: "M8 13.25A5.25 5.25 0 1 0 8 2.75a5.25 5.25 0 0 0 0 10.5Zm-1.5-7a1.55 1.55 0 0 1 3 0c0 1.25-1.5 1.4-1.5 2.5M8 10.75h.01",
    feedback:
      "M3 11.25v2l2.25-2H11a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11 3.25H4.5A1.5 1.5 0 0 0 3 4.75v6.5Z",
    logout:
      "M6.25 3.25H4.5A1.5 1.5 0 0 0 3 4.75v6.5a1.5 1.5 0 0 0 1.5 1.5h1.75M9.5 5.25 12.25 8 9.5 10.75M12 8H6.5",
  }[name];

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d={path} />
    </svg>
  );
}

function relativeTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).valueOf();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).valueOf();
  const daysAgo = Math.floor((today - day) / 86_400_000);
  if (daysAgo <= 0) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "2-digit" }),
  }).format(date);
}
