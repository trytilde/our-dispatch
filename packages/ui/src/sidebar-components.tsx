import { type FormEvent, useEffect, useMemo, useState } from "react";
import { DicesIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AgentAvatar, type AgentAvatarState } from "./agent-avatar.js";
import GlideMenu from "./beautiful-ui/atoms/glide-menu.js";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./components/ui/command.js";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog.js";
import { BackIcon, PlusIcon } from "./workspace-icons.js";
import { getThemePreference, setThemePreference, type ThemePreference } from "./theme.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";

export interface SidebarAgent {
  id: string;
  name: string;
  lastMessage?: string;
  updatedAt?: string;
  unread?: boolean;
  busy?: boolean;
  status?: string;
}

export function sidebarAvatarState(agent: SidebarAgent, selected: boolean): AgentAvatarState {
  if (agent.busy || (agent.status && /running|working|busy|active/i.test(agent.status)))
    return "loading";
  if (selected) return "listening";
  return "idle";
}

export interface AgentListItemProps {
  agent: SidebarAgent;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function AgentListItem({ agent, selected, onSelect }: AgentListItemProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      data-menu-row
      className={`sidebar-agent-row group relative z-10 flex h-[54px] w-full items-center gap-2 rounded-[8px] px-2 text-left
        transition-[background-color,color,transform] duration-150 active:scale-[0.98]
        ${selected ? "bg-hover-2" : ""}`}
      aria-current={selected ? "page" : undefined}
      data-selected={selected || undefined}
      data-unread={agent.unread || undefined}
      onClick={() => onSelect(agent.id)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      title={agent.name}
      type="button"
    >
      <span
        className="relative flex shrink-0"
        style={{ animation: "pop-in 250ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <AgentAvatar emphasis={hovered} id={agent.id} state={sidebarAvatarState(agent, selected)} />
      </span>
      <span className="sidebar-agent-meta min-w-0 flex-1">
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
        {agent.lastMessage || agent.unread ? (
          <span className="flex min-w-0 items-center justify-between gap-2">
            {agent.lastMessage ? (
              <small
                className={`min-w-0 flex-1 truncate text-[12px] leading-snug ${
                  agent.unread ? "text-ink-2" : "text-ink-3"
                }`}
              >
                {agent.lastMessage}
              </small>
            ) : null}
            {agent.unread ? (
              <span
                aria-label="Has unread messages"
                className="sidebar-agent-unread ml-auto size-2 shrink-0 rounded-full bg-accent"
                role="status"
                style={{ animation: "pop-in 250ms cubic-bezier(0.23,1,0.32,1) both" }}
              />
            ) : null}
          </span>
        ) : null}
      </span>
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

const themeActions: readonly {
  preference: ThemePreference;
  label: string;
  keywords: string;
}[] = [
  { preference: "system", label: "Use system theme", keywords: "appearance os auto follow" },
  { preference: "light", label: "Switch to light theme", keywords: "appearance day bright" },
  { preference: "dark", label: "Switch to dark theme", keywords: "appearance night mode" },
];

export function AgentSearchDialog({
  agents,
  loading,
  open,
  value,
  onChange,
  onClose,
  onSelect,
}: AgentSearchDialogProps) {
  const [modHeld, setModHeld] = useState(false);
  const [themePreference, setLocalTheme] = useState<ThemePreference>(() => getThemePreference());

  const query = value.trim().toLowerCase();
  const matchingActions = useMemo(
    () =>
      query
        ? themeActions.filter((action) =>
            `${action.label} ${action.keywords}`.toLowerCase().includes(query),
          )
        : themeActions,
    [query],
  );

  // Row order for Cmd/Ctrl+1..9 quick activation: agents first, then actions.
  const quickRows = useMemo(
    () => [
      ...agents.map((agent) => ({ kind: "agent" as const, id: agent.id })),
      ...matchingActions.map((action) => ({ kind: "theme" as const, id: action.preference })),
    ],
    [agents, matchingActions],
  );

  const pickTheme = (preference: ThemePreference) => {
    setThemePreference(preference);
    setLocalTheme(preference);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") setModHeld(true);
      if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
        const row = quickRows[Number(event.key) - 1];
        if (!row) return;
        event.preventDefault();
        onClose();
        if (row.kind === "agent") onSelect(row.id);
        else pickTheme(row.id);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") setModHeld(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      setModHeld(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quickRows, onClose, onSelect]);

  const shortcutHint = (index: number) =>
    modHeld && index < 9 ? (
      <kbd
        className="flex h-4.5 shrink-0 items-center justify-center rounded-[5px] bg-surface px-1
          font-sans text-[10px] text-ink-3 shadow-hairline"
      >
        {index + 1}
      </kbd>
    ) : null;

  return (
    <CommandDialog
      title="Search"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput autoFocus placeholder="Search" value={value} onValueChange={onChange} />
      <CommandList>
        {!loading ? <CommandEmpty>{query ? "No results" : "No bots yet"}</CommandEmpty> : null}
        {agents.map((agent, index) => (
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
            {shortcutHint(index)}
          </CommandItem>
        ))}
        {matchingActions.length > 0 ? (
          <CommandGroup heading="Actions">
            {matchingActions.map((action, index) => (
              <CommandItem
                key={action.preference}
                value={action.label}
                onSelect={() => pickTheme(action.preference)}
              >
                <ThemeActionIcon preference={action.preference} />
                <span className="min-w-0 flex-1 text-[13px] text-ink">{action.label}</span>
                {themePreference === action.preference ? (
                  <span aria-label="Active" className="text-[12px] text-accent-ink">
                    ✓
                  </span>
                ) : null}
                {shortcutHint(agents.length + index)}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

export interface AddAgentDialogProps {
  agents: readonly SidebarAgent[];
  loading: boolean;
  open: boolean;
  creating?: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
  onSelect: (id: string) => void;
}

export function AddAgentDialog({
  agents,
  loading,
  open,
  creating = false,
  onClose,
  onCreate,
  onSelect,
}: AddAgentDialogProps) {
  const [creatingNew, setCreatingNew] = useState(true);
  const [query, setQuery] = useState("");
  const [avatarGeneration, setAvatarGeneration] = useState(0);
  const [hoveredAvatarId, setHoveredAvatarId] = useState("");
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const reduceMotion = useReducedMotion();
  const matchingAgents = agents.filter((agent) =>
    `${agent.name} ${agent.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const avatarOptions = useMemo(
    () => Array.from({ length: 5 }, (_, index) => `new-bot-${avatarGeneration}-${index}`),
    [avatarGeneration],
  );

  useEffect(() => {
    if (open) return;
    setCreatingNew(true);
    setQuery("");
    setAvatarGeneration(0);
    setHoveredAvatarId("");
    setSelectedAvatarId("");
  }, [open]);

  const close = () => {
    if (creating) return;
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = query.trim();
    if (name && !creating) onCreate(name);
  };

  if (creatingNew)
    return (
      <Dialog
        onOpenChange={(next) => {
          if (!next) close();
        }}
        open={open}
      >
        <DialogContent
          aria-describedby={undefined}
          className="workspace-selector-dialog top-[82px] max-w-[520px] translate-y-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">Create bot</DialogTitle>
          <form
            className="workspace-selector workspace-selector-add create-bot-selector"
            onSubmit={submit}
          >
            <div className="workspace-selector-heading">
              <span>Create a new bot</span>
              <small>Name your bot and preview its generated avatars.</small>
            </div>
            <div className="workspace-selector-fields">
              <label className="workspace-selector-field" htmlFor="create-bot-name">
                <span>Bot name</span>
                <input
                  autoFocus
                  disabled={creating}
                  id="create-bot-name"
                  maxLength={72}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name your bot"
                  type="text"
                  value={query}
                />
              </label>
              <div className="create-bot-avatar-field">
                <span>Avatar</span>
                <div className="create-bot-avatar-options">
                  <AnimatePresence initial={false} mode="wait">
                    <motion.div
                      animate={{ opacity: 1 }}
                      className="create-bot-avatar-list"
                      exit={{ opacity: 0 }}
                      initial={{ opacity: 0 }}
                      key={avatarGeneration}
                      transition={{ duration: reduceMotion ? 0 : 0.16, ease: "easeInOut" }}
                    >
                      {avatarOptions.map((avatarId, index) => {
                        const active =
                          selectedAvatarId === avatarId || hoveredAvatarId === avatarId;
                        return (
                          <button
                            aria-label={`Select avatar ${index + 1}`}
                            aria-pressed={selectedAvatarId === avatarId}
                            className="create-bot-avatar-option"
                            disabled={creating}
                            key={avatarId}
                            onBlur={() => setHoveredAvatarId("")}
                            onClick={() => setSelectedAvatarId(avatarId)}
                            onFocus={() => setHoveredAvatarId(avatarId)}
                            onPointerEnter={() => setHoveredAvatarId(avatarId)}
                            onPointerLeave={() => setHoveredAvatarId("")}
                            type="button"
                          >
                            <AgentAvatar
                              className="create-bot-avatar"
                              id={avatarId}
                              state={active ? "loading" : "idle"}
                            />
                          </button>
                        );
                      })}
                    </motion.div>
                  </AnimatePresence>
                  <button
                    aria-label="Roll again"
                    className="create-bot-avatar-regenerate"
                    disabled={creating}
                    onClick={() => {
                      setHoveredAvatarId("");
                      setSelectedAvatarId("");
                      setAvatarGeneration((current) => current + 1);
                    }}
                    type="button"
                  >
                    <span className="create-bot-avatar-dice" aria-hidden="true">
                      <DicesIcon />
                    </span>
                    <small>Roll again</small>
                  </button>
                </div>
              </div>
            </div>
            <div className="workspace-selector-actions">
              <button
                className="workspace-selector-back"
                disabled={creating}
                onClick={() => {
                  setCreatingNew(false);
                  setQuery("");
                  setAvatarGeneration(0);
                  setHoveredAvatarId("");
                  setSelectedAvatarId("");
                }}
                type="button"
              >
                <BackIcon />
                Back
              </button>
              <button
                className="workspace-selector-join"
                disabled={creating || !query.trim()}
                type="submit"
              >
                {creating ? (
                  <span className="workspace-selector-spinner" aria-hidden="true" />
                ) : null}
                {creating ? "Adding…" : "Add"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );

  return (
    <CommandDialog
      className="max-w-[520px]"
      commandProps={{ shouldFilter: false }}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      open={open}
      title="Add bot"
    >
      <>
        <CommandInput autoFocus onValueChange={setQuery} placeholder="Search bots" value={query} />
        <CommandList>
          <CommandItem
            onSelect={() => {
              setCreatingNew(true);
              setQuery("");
            }}
            value="Create a new bot"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-inset text-ink-2">
              <PlusIcon className="size-4 fill-none stroke-current stroke-[1.4]" />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-[13px] font-medium leading-tight text-ink">
                Create a new bot
              </strong>
              <small className="block text-[12px] leading-snug text-ink-3">Set up a new bot</small>
            </span>
          </CommandItem>
          {!loading && matchingAgents.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-ink-3">
              {agents.length === 0 ? "No bots yet" : "No bots found"}
            </div>
          ) : null}
          {matchingAgents.map((agent) => (
            <CommandItem
              key={agent.id}
              onSelect={() => {
                onClose();
                onSelect(agent.id);
              }}
              value={`${agent.name} ${agent.id}`}
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
      </>
    </CommandDialog>
  );
}

function ThemeActionIcon({ preference }: { preference: ThemePreference }) {
  const paths: Record<ThemePreference, string> = {
    system: "M2.75 3.75h10.5v7H2.75Zm2.5 9.5h5.5M8 10.75v2.5",
    light:
      "M8 5.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Zm0-3.5v1.5m0 9.5v1.5m6.25-6.25h-1.5M3.25 8h-1.5m10.72-4.47-1.06 1.06M4.59 11.41l-1.06 1.06m9.94 0-1.06-1.06M4.59 4.59 3.53 3.53",
    dark: "M13.25 9.5A5.75 5.75 0 0 1 6.5 2.75a5.75 5.75 0 1 0 6.75 6.75Z",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 fill-none stroke-ink-2 stroke-[1.3]"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[preference]} />
    </svg>
  );
}

export interface WorkspaceAccountProps {
  collapsed?: boolean;
  name?: string;
}

export function WorkspaceAccount({
  collapsed = false,
  name = "Your account",
}: WorkspaceAccountProps) {
  return (
    <div className={`mt-auto p-2 ${collapsed ? "sidebar-account-collapsed" : ""}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Open account menu for ${name}`}
            className={`flex w-full items-center rounded-control p-1.5 text-left
              transition-[background-color,transform] duration-100 hover:bg-hover active:scale-[0.98]
              data-[state=open]:bg-hover ${collapsed ? "justify-center gap-0" : "gap-2.5"}`}
            type="button"
          >
            <motion.span
              aria-hidden="true"
              animate={{ height: collapsed ? 36 : 28, width: collapsed ? 36 : 28 }}
              className="flex shrink-0 items-center justify-center rounded-full bg-[#8D6E62]
                text-[13px] font-semibold text-white shadow-hairline"
              initial={false}
              transition={avatarTransition}
            >
              {name.charAt(0).toUpperCase()}
            </motion.span>
            <AnimatePresence initial={false}>
              {collapsed ? null : (
                <motion.span
                  animate={{ opacity: 1, width: "auto" }}
                  className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink"
                  exit={{ opacity: 0, width: 0 }}
                  initial={{ opacity: 0, width: 0 }}
                  key="account-name"
                  transition={avatarTransition}
                >
                  {name}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-[220px]">
          <DropdownMenuItem>
            <AccountMenuIcon name="logout" />
            <span>Log out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const avatarTransition = { duration: 0.18, ease: [0.23, 1, 0.32, 1] } as const;

function AccountMenuIcon({ name }: { name: "logout" }) {
  const path = {
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
