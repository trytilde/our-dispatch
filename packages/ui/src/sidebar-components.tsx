import { useEffect } from "react";
import { AgentAvatar } from "./agent-avatar.js";
import GlideMenu from "./beautiful-ui/atoms/glide-menu.js";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./components/ui/command.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";

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
      data-menu-row
      className={`group relative z-10 flex w-full items-center gap-2.5 rounded-[8px] px-2 py-[7px] text-left
        transition-[background-color,color,transform] duration-150 active:scale-[0.98]
        ${selected ? "bg-hover-2/60" : ""}`}
      aria-current={selected ? "page" : undefined}
      data-selected={selected || undefined}
      data-unread={agent.unread || undefined}
      onClick={() => onSelect(agent.id)}
      title={agent.name}
      type="button"
    >
      <span
        className="flex shrink-0 transition-transform duration-200 ease-out-strong
          group-hover:scale-105 group-active:scale-95"
        style={{ animation: "pop-in 250ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <AgentAvatar id={agent.id} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <strong
            className={`truncate text-[13px] leading-tight ${
              agent.unread ? "font-semibold text-ink" : "font-medium text-ink"
            }`}
          >
            {agent.name}
          </strong>
          {agent.updatedAt ? (
            <time
              dateTime={agent.updatedAt}
              className="shrink-0 text-[11px] leading-tight text-ink-3 tabular-nums"
            >
              {relativeTime(agent.updatedAt)}
            </time>
          ) : null}
        </span>
        {agent.lastMessage ? (
          <small
            className={`block truncate text-[12px] leading-snug ${
              agent.unread ? "text-ink-2" : "text-ink-3"
            }`}
          >
            {agent.lastMessage}
          </small>
        ) : null}
      </span>
      {agent.unread ? (
        <span
          aria-label="Unread activity"
          role="status"
          className="size-2 shrink-0 rounded-full bg-accent"
          style={{ animation: "pop-in 250ms cubic-bezier(0.23,1,0.32,1) both" }}
        />
      ) : null}
    </button>
  );
}

export interface AgentSearchDialogProps {
  agents: readonly SidebarAgent[];
  loading: boolean;
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
}

export function AgentSearchDialog({
  agents,
  loading,
  open,
  value,
  onChange,
  onClose,
  onSelect,
}: AgentSearchDialogProps) {
  return (
    <CommandDialog
      title="Search agents"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput autoFocus placeholder="Search agents" value={value} onValueChange={onChange} />
      <CommandList>
        {!loading ? <CommandEmpty>No agents found</CommandEmpty> : null}
        {agents.map((agent) => (
          <CommandItem
            key={agent.id}
            value={`${agent.name} ${agent.id}`}
            onSelect={() => {
              onClose();
              onSelect(agent.id);
            }}
          >
            <AgentAvatar id={agent.id} />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-[13px] font-medium leading-tight text-ink">
                {agent.name}
              </strong>
              {agent.lastMessage ? (
                <small className="block truncate text-[12px] leading-snug text-ink-3">
                  {agent.lastMessage}
                </small>
              ) : null}
            </span>
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

export interface WorkspaceAccountProps {
  name?: string;
}

const accountMenuItems = [
  { icon: "gear", label: "Settings" },
  { icon: "info", label: "About" },
  { icon: "help", label: "Help Center" },
  { icon: "feedback", label: "Send Feedback" },
] as const;

export function WorkspaceAccount({ name = "Daniel Adams" }: WorkspaceAccountProps) {
  return (
    <div className="mt-auto border-t border-line p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Open account menu for ${name}`}
            className="flex w-full items-center gap-2.5 rounded-control p-1.5 text-left
              transition-[background-color,transform] duration-100 hover:bg-hover active:scale-[0.98]
              data-[state=open]:bg-hover"
            type="button"
          >
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full
                bg-field text-[12px] font-semibold text-ink shadow-hairline"
            >
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{name}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-[220px]">
          {accountMenuItems.map((item) => (
            <DropdownMenuItem key={item.label}>
              <AccountMenuIcon name={item.icon} />
              <span>{item.label}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <AccountMenuIcon name="logout" />
            <span>Log out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 fill-none stroke-ink-2 stroke-[1.3]"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

export { GlideMenu as SidebarGlideMenu };

/**
 * Registers the global Cmd/Ctrl+K shortcut for the agent search palette.
 */
export function useSearchShortcut(onOpen: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}

export function relativeTime(value: string): string {
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
