import type { PointerEvent as ReactPointerEvent } from "react";
import {
  AgentListItem,
  AgentSearchDialog,
  type SidebarAgent,
  WorkspaceAccount,
} from "./sidebar-components.js";
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
  return (
    <>
      <aside className="rail">
        <div className="sidebar-titlebar" />
        <button
          aria-label="Search"
          className="chat-search"
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
          <span>
            <SearchIcon />
            Search
          </span>
        </button>
        <nav className="agent-navigation">
          {loading ? <p className="agent-status">Loading agents…</p> : null}
          {!loading && agents.length === 0 ? (
            <p className="agent-status">No agents are available.</p>
          ) : null}
          {agents.map((agent) => (
            <AgentListItem
              agent={agent}
              key={agent.id}
              onSelect={onSelectAgent}
              selected={agent.id === selectedAgentId}
            />
          ))}
          {hasMore && !searchValue && onLoadMore ? (
            <button className="load-more-agents" onClick={onLoadMore}>
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

      {searchOpen ? (
        <AgentSearchDialog
          agents={agents}
          loading={loading}
          onChange={onSearchChange}
          onClose={onSearchClose}
          onSelect={onSelectAgent}
          value={searchValue}
        />
      ) : null}
    </>
  );
}
