import type { CSSProperties, ReactNode, RefObject, UIEventHandler } from "react";
import { ArrowDownIcon } from "lucide-react";

export interface WorkspaceShellProps {
  sidebarCollapsed: boolean;
  computerOpen: boolean;
  computerFloating?: boolean;
  style: CSSProperties;
  children: ReactNode;
}

export function WorkspaceShell({
  sidebarCollapsed,
  computerOpen,
  computerFloating = false,
  style,
  children,
}: WorkspaceShellProps) {
  return (
    <main
      className={`workspace-shell rich-chat ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${computerOpen ? "workspace-open" : "workspace-closed"} ${computerFloating ? "computer-floating" : ""}`}
      style={style}
    >
      {children}
    </main>
  );
}

export function ChatPane({ children }: { children: ReactNode }) {
  return (
    <section className="chat-pane">
      <div aria-hidden="true" className="chat-window-drag-region" />
      {children}
    </section>
  );
}

export interface ConversationSurfaceProps {
  children: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
}

export function ConversationSurface({ children, scrollRef, onScroll }: ConversationSurfaceProps) {
  return (
    <div className="conversation" aria-live="polite" ref={scrollRef} onScroll={onScroll}>
      {children}
    </div>
  );
}

export function ScrollToLatestButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="scroll-latest" onClick={onClick} aria-label="Scroll to bottom" type="button">
      <span>Scroll to bottom</span>
      <ArrowDownIcon aria-hidden="true" />
    </button>
  );
}
