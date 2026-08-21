import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AgentListItem,
  AgentSearchDialog,
  type SidebarAgent,
  useSearchShortcut,
  WorkspaceAccount,
} from "./sidebar-components.js";
import GlideMenu from "./beautiful-ui/atoms/glide-menu.js";
import {
  FeedbackIcon,
  PlusIcon,
  PluginsIcon,
  SearchIcon,
  SettingsIcon,
  WorkspaceIcon,
} from "./workspace-icons.js";

export type WorkspaceSidebarAgent = SidebarAgent;

const railTransition = { duration: 0.18, ease: [0.23, 1, 0.32, 1] } as const;
const expandedIcon = "size-4 shrink-0 fill-none stroke-current stroke-[1.3]";
// Icons carry the collapsed rail on their own, so they sit larger there.
const collapsedIcon = "size-6 shrink-0 fill-none stroke-current stroke-[1.4]";

export interface WorkspaceSidebarProps {
  agents: readonly WorkspaceSidebarAgent[];
  collapsed?: boolean;
  selectedAgentId: string;
  loading?: boolean;
  hasMore?: boolean;
  searchOpen: boolean;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  onSelectAgent: (id: string) => void;
  onLoadMore?: () => void;
  onCreateAgent?: () => void;
  onOpenPlugins?: () => void;
  onOpenSettings?: () => void;
  onSwitchWorkspace?: () => void;
  /** Address the "Send Feedback" row opens in the owner's mail client. */
  feedbackEmail?: string;
  onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function WorkspaceSidebar({
  agents,
  collapsed = false,
  selectedAgentId,
  loading = false,
  hasMore = false,
  searchOpen,
  searchValue,
  onSearchChange,
  onSearchOpen,
  onSearchClose,
  onSelectAgent,
  onLoadMore,
  onCreateAgent,
  onOpenPlugins,
  onOpenSettings,
  onSwitchWorkspace,
  feedbackEmail = "opensource@trytilde.ai",
  onResize,
}: WorkspaceSidebarProps) {
  useSearchShortcut(onSearchOpen);
  const showAgentSkeletons = loading && agents.length === 0;

  return (
    <>
      <aside className="rail">
        <div className="sidebar-titlebar">
          {onCreateAgent && !collapsed ? (
            <button
              aria-label="Add bot"
              className="flex size-7 items-center justify-center rounded-control text-ink
                transition-[background-color] duration-150 hover:bg-hover"
              onClick={onCreateAgent}
              title="Add bot"
              type="button"
            >
              <PlusIcon className="size-4 fill-none stroke-current stroke-[1.3]" />
            </button>
          ) : null}
        </div>
        <AnimatePresence initial={false}>
          {collapsed ? null : (
            <motion.div
              animate={{ height: "auto", opacity: 1 }}
              className="sidebar-search overflow-hidden px-3 pb-1"
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              key="sidebar-search"
              transition={railTransition}
            >
              <button
                aria-label="Search"
                className="flex h-8 w-full items-center gap-2 rounded-control border border-line bg-inset px-2.5 text-left text-[13px] leading-[18px]
              transition-[background-color] duration-150 hover:bg-hover"
                onClick={onSearchOpen}
                onKeyDown={(event) => {
                  if (
                    !event.defaultPrevented &&
                    event.key.length === 1 &&
                    event.key !== " " &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    onSearchOpen();
                  }
                }}
                type="button"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-ink-3">
                  <SearchIcon className="size-4 shrink-0 fill-none stroke-current stroke-[1.3] [stroke-linecap:round]" />
                  Search
                </span>
                <kbd
                  className="flex h-4.5 shrink-0 items-center justify-center rounded-[5px] bg-surface
                px-1 font-sans text-[10px] text-ink-3 shadow-hairline"
                >
                  ⌘K
                </kbd>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <nav
          aria-label="Bots"
          className="sidebar-agent-list min-h-0 flex-1 overflow-y-auto px-2 py-1"
        >
          {showAgentSkeletons ? <SidebarAgentSkeletons /> : null}
          {!loading && agents.length === 0 ? (
            <p className="px-2 py-2 text-[12.5px] text-ink-3">No bots are available.</p>
          ) : null}
          <GlideMenu
            className="flex flex-col gap-1"
            highlightClassName={
              collapsed
                ? "left-1/2 w-13 -translate-x-1/2 rounded-[12px] bg-hover"
                : "inset-x-0 rounded-[8px] bg-hover"
            }
          >
            {!showAgentSkeletons &&
              agents.map((agent) => (
                <AgentListItem
                  agent={agent}
                  key={agent.id}
                  onSelect={onSelectAgent}
                  selected={agent.id === selectedAgentId}
                />
              ))}
          </GlideMenu>
          {hasMore && !searchValue && onLoadMore ? (
            <button
              className="mt-1 flex w-full items-center rounded-[8px] px-2 py-[7px] text-left
                text-[12.5px] font-medium text-ink-2 transition-[background-color,color]
                duration-150 hover:bg-hover hover:text-ink"
              onClick={onLoadMore}
              type="button"
            >
              Show more bots
            </button>
          ) : null}
        </nav>
        <div className="sidebar-utility flex flex-col gap-1 px-2 pb-1">
          {onCreateAgent && collapsed ? (
            <SidebarUtilityRow
              collapsed={collapsed}
              icon={<PlusIcon className={collapsedIcon} />}
              label="Add bot"
              onClick={onCreateAgent}
            />
          ) : null}
          <SidebarUtilityRow
            collapsed={collapsed}
            icon={<PluginsIcon className={collapsed ? collapsedIcon : expandedIcon} />}
            label="Plugins"
            onClick={onOpenPlugins}
          />
          <SidebarUtilityRow
            collapsed={collapsed}
            icon={<SettingsIcon className={collapsed ? collapsedIcon : expandedIcon} />}
            label="Settings"
            onClick={onOpenSettings}
          />
          <SidebarUtilityRow
            collapsed={collapsed}
            href={`mailto:${feedbackEmail}`}
            icon={<FeedbackIcon className={collapsed ? collapsedIcon : expandedIcon} />}
            label="Send Feedback"
          />
          <SidebarUtilityRow
            collapsed={collapsed}
            icon={<WorkspaceIcon className={collapsed ? collapsedIcon : expandedIcon} />}
            label="Switch workspace"
            onClick={onSwitchWorkspace}
          />
        </div>
        <WorkspaceAccount collapsed={collapsed} />
        <div
          aria-label="Drag to resize the sidebar"
          className="sidebar-resize-handle"
          onPointerDown={onResize}
          role="separator"
        />
      </aside>

      <AgentSearchDialog
        agents={agents}
        loading={loading}
        open={searchOpen}
        onChange={onSearchChange}
        onClose={onSearchClose}
        onSelect={onSelectAgent}
        value={searchValue}
      />
    </>
  );
}

function SidebarAgentSkeletons() {
  return (
    <div aria-label="Loading bots" className="flex flex-col gap-1" role="status">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          aria-hidden="true"
          className="sidebar-agent-row sidebar-agent-skeleton flex h-[54px] w-full items-center gap-2 rounded-[8px] px-2"
          key={index}
        >
          <span className="size-9 shrink-0 rounded-[11px] bg-hover-2" />
          <span className="sidebar-agent-meta min-w-0 flex-1 space-y-2">
            <span className="block h-2.5 w-[42%] rounded-full bg-hover-2" />
            <span className="block h-2 w-[68%] rounded-full bg-hover" />
          </span>
        </div>
      ))}
    </div>
  );
}

interface SidebarUtilityRowProps {
  collapsed: boolean;
  href?: string;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}

/** Sidebar footer action shaped like a shadcn sidebar menu button: icon, label, one row. */
function SidebarUtilityRow({ collapsed, href, icon, label, onClick }: SidebarUtilityRowProps) {
  const className = `sidebar-utility-row flex w-full items-center rounded-control text-left
    ${collapsed ? "h-11 justify-center" : "h-8"}
    text-[12.5px] font-medium text-ink transition-[background-color] duration-150
    hover:bg-hover ${collapsed ? "gap-0 px-0" : "gap-2 px-2.5"}`;
  const body = (
    <>
      {icon}
      <AnimatePresence initial={false}>
        {collapsed ? null : (
          <motion.span
            animate={{ opacity: 1, width: "auto" }}
            className="truncate"
            exit={{ opacity: 0, width: 0 }}
            initial={{ opacity: 0, width: 0 }}
            key={`${label}-label`}
            transition={railTransition}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );

  return href ? (
    <a aria-label={label} className={className} href={href} title={label}>
      {body}
    </a>
  ) : (
    <button aria-label={label} className={className} onClick={onClick} title={label} type="button">
      {body}
    </button>
  );
}
