import type { PointerEvent as ReactPointerEvent } from "react";
import {
  AgentListItem,
  AgentSearchDialog,
  type SidebarAgent,
  useSearchShortcut,
  WorkspaceAccount,
} from "./sidebar-components.js";
import GlideMenu from "./beautiful-ui/atoms/glide-menu.js";
import { SearchIcon } from "./workspace-icons.js";

export type WorkspaceSidebarAgent = SidebarAgent;

export interface WorkspaceSidebarProps {
  agents: readonly WorkspaceSidebarAgent[];
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
  onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function WorkspaceSidebar({
  agents,
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
  onResize,
}: WorkspaceSidebarProps) {
  useSearchShortcut(onSearchOpen);

  return (
    <>
      <aside className="rail">
        <div className="sidebar-titlebar" />
        <div className="px-3 pb-1">
          <button
            aria-label="Search"
            className="flex h-8 w-full items-center gap-2 rounded-control bg-inset px-2.5 text-left
              shadow-hairline transition-[background-color] duration-150 hover:bg-hover"
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
              <SearchIcon />
              Search
            </span>
            <kbd
              className="flex h-4.5 shrink-0 items-center justify-center rounded-[5px] bg-surface
                px-1 font-sans text-[10px] text-ink-3 shadow-hairline"
            >
              ⌘K
            </kbd>
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-1" aria-label="Agents">
          {loading ? <p className="px-2 py-2 text-[12.5px] text-ink-3">Loading agents…</p> : null}
          {!loading && agents.length === 0 ? (
            <p className="px-2 py-2 text-[12.5px] text-ink-3">No agents are available.</p>
          ) : null}
          <GlideMenu
            className="flex flex-col gap-px"
            highlightClassName="inset-x-0 rounded-[8px] bg-hover"
          >
            {agents.map((agent) => (
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
              Show more agents
            </button>
          ) : null}
        </nav>
        <WorkspaceAccount />
        <div
          aria-label="Resize sidebar"
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
