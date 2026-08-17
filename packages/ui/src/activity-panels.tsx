import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export type AsyncTaskKind = "subagent" | "shell" | "cloud-agent";

export interface AsyncTask {
  id: string;
  kind: AsyncTaskKind;
  label: string;
  detail?: string;
  startedAtMs: number;
}

export interface AsyncTasksPanelProps {
  agentName?: string;
  tasks: readonly AsyncTask[];
  onClose: () => void;
  nowMs?: number;
}

export function AsyncTasksPanel({
  agentName = "Agent",
  tasks,
  onClose,
  nowMs,
}: AsyncTasksPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const onHeaderPointerDown = useFloatingPanelDrag(panelRef);
  const now = usePanelNow(nowMs);
  const label = `Async tasks: ${agentName}`;

  return (
    <aside aria-label={label} className="async-tasks-panel" ref={panelRef} role="dialog">
      <FloatingPanelHeader
        icon="clock"
        onClose={onClose}
        onPointerDown={onHeaderPointerDown}
        subtitle={agentName}
        title="Async tasks"
      />
      <div className="floating-panel-scroll async-tasks-panel-list">
        <div aria-label={label} className="floating-panel-list" role="list">
          {tasks.length === 0 ? (
            <div className="async-tasks-empty">No async tasks in progress.</div>
          ) : (
            tasks.map((task) => (
              <AsyncTaskRow key={`${task.kind}:${task.id}`} nowMs={now} task={task} />
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function AsyncTaskRow({ task, nowMs }: { task: AsyncTask; nowMs: number }) {
  const kindLabel = asyncTaskKindLabel(task.kind);
  const detail = task.detail?.trim();
  return (
    <div
      className="async-task"
      data-kind={task.kind}
      role="listitem"
      title={`${task.id} — started ${new Date(task.startedAtMs).toLocaleString()}`}
    >
      <span aria-label="Running" className="async-task-status" role="status" />
      <PanelIcon className="async-task-icon" name={task.kind} />
      <span className="async-task-body">
        <span className="async-task-label">{task.label}</span>
        <span className="async-task-meta">
          {kindLabel}
          {detail ? ` · ${detail}` : ""}
        </span>
      </span>
      <span className="async-task-time">{formatRelativeTime(task.startedAtMs, nowMs)}</span>
    </div>
  );
}

export type ConversationOutlineTabStatus = "running" | "done" | "error" | "aborted";
export type ConversationOutlineToolStatus = "pending" | "completed" | "failed";

interface ConversationOutlineItemBase {
  id: string;
}

export type ConversationOutlineItem =
  | (ConversationOutlineItemBase & {
      kind: "user" | "thinking" | "assistant-text";
      text: string;
    })
  | (ConversationOutlineItemBase & {
      kind: "tool-call";
      name: string;
      status: ConversationOutlineToolStatus;
      summary?: string;
    })
  | (ConversationOutlineItemBase & {
      kind: "send-message";
      message: string;
    });

export interface ConversationOutlineTab {
  id: string;
  label: string;
  status?: ConversationOutlineTabStatus;
  items: readonly ConversationOutlineItem[];
}

export interface ConversationOutlinePanelProps {
  agentName?: string;
  tabs: readonly ConversationOutlineTab[];
  selectedTabId?: string;
  onSelectedTabChange?: (tabId: string) => void;
  onClose: () => void;
}

export function ConversationOutlinePanel({
  agentName = "Conversation",
  tabs,
  selectedTabId,
  onSelectedTabChange,
  onClose,
}: ConversationOutlinePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const onHeaderPointerDown = useFloatingPanelDrag(panelRef);
  const [internalSelectedId, setInternalSelectedId] = useState(tabs[0]?.id ?? "");
  const titleId = useId();
  const tabListId = useId();
  const panelId = useId();
  const requestedId = selectedTabId ?? internalSelectedId;
  const selectedTab = tabs.find((tab) => tab.id === requestedId) ?? tabs[0];
  const selectedId = selectedTab?.id ?? "";
  const labelledBy = tabs.length > 1 ? `${tabListId}-${encodeURIComponent(selectedId)}` : titleId;

  function select(tabId: string): void {
    setInternalSelectedId(tabId);
    onSelectedTabChange?.(tabId);
  }

  return (
    <aside
      aria-label={`Full conversation: ${agentName}`}
      className="outline-panel"
      ref={panelRef}
      role="dialog"
    >
      <FloatingPanelHeader
        icon="outline"
        onClose={onClose}
        onPointerDown={onHeaderPointerDown}
        subtitle={agentName}
        subtitleId={titleId}
        title="Full conversation"
      />
      {tabs.length > 1 ? (
        <OutlineTabs
          idPrefix={tabListId}
          onSelect={select}
          panelId={panelId}
          selectedId={selectedId}
          tabs={tabs}
        />
      ) : null}
      <div
        aria-labelledby={labelledBy}
        className="floating-panel-scroll outline-panel-list"
        id={tabs.length > 1 ? panelId : undefined}
        role={tabs.length > 1 ? "tabpanel" : undefined}
      >
        <div aria-labelledby={labelledBy} className="floating-panel-list" role="list">
          {!selectedTab || selectedTab.items.length === 0 ? (
            <div className="outline-empty">No conversation activity yet.</div>
          ) : (
            selectedTab.items.map((item) => <OutlineItem item={item} key={item.id} />)
          )}
        </div>
      </div>
    </aside>
  );
}

function OutlineTabs({
  tabs,
  selectedId,
  idPrefix,
  panelId,
  onSelect,
}: {
  tabs: readonly ConversationOutlineTab[];
  selectedId: string;
  idPrefix: string;
  panelId: string;
  onSelect: (tabId: string) => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case "ArrowRight":
        nextIndex = (index + 1) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    const tab = tabs[nextIndex];
    if (!tab) return;
    event.preventDefault();
    onSelect(tab.id);
    refs.current.get(tab.id)?.focus();
  }

  return (
    <div aria-orientation="horizontal" className="outline-panel-tabs" id={idPrefix} role="tablist">
      {tabs.map((tab, index) => (
        <button
          aria-controls={panelId}
          aria-selected={tab.id === selectedId}
          className="outline-tab"
          id={`${idPrefix}-${encodeURIComponent(tab.id)}`}
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          ref={(element) => {
            if (element) refs.current.set(tab.id, element);
            else refs.current.delete(tab.id);
          }}
          role="tab"
          tabIndex={tab.id === selectedId ? 0 : -1}
          type="button"
        >
          {tab.status ? (
            <span aria-hidden="true" className="outline-tab-status" data-status={tab.status} />
          ) : null}
          <span className="outline-tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function OutlineItem({ item }: { item: ConversationOutlineItem }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const preview = outlinePreview(item);
  const detail = outlineDetail(item);
  return (
    <div
      className="outline-item"
      data-kind={item.kind}
      data-status={item.kind === "tool-call" ? item.status : undefined}
      role="listitem"
    >
      <button
        aria-controls={expanded ? detailId : undefined}
        aria-expanded={expanded}
        className="outline-item-row"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <PanelIcon
          className="outline-item-icon"
          name={item.kind === "tool-call" && item.status === "pending" ? "loading" : item.kind}
        />
        <span className="outline-item-label">{outlineLabel(item)}</span>
        {preview ? <span className="outline-item-preview">{preview}</span> : null}
        <PanelIcon
          className="outline-item-chevron"
          name={expanded ? "chevron-down" : "chevron-right"}
        />
      </button>
      {expanded ? (
        <div className="outline-item-detail" id={detailId}>
          {detail ? (
            <div className="outline-item-detail-section">
              <pre className="outline-item-detail-text">{detail}</pre>
            </div>
          ) : (
            <span className="outline-item-no-detail">No additional details.</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FloatingPanelHeader({
  icon,
  title,
  subtitle,
  subtitleId,
  onClose,
  onPointerDown,
}: {
  icon: "clock" | "outline";
  title: string;
  subtitle: string;
  subtitleId?: string;
  onClose: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <header className="floating-panel-header" onPointerDown={onPointerDown}>
      <div className="floating-panel-title">
        <PanelIcon name={icon} />
        <span className="floating-panel-title-text">
          <strong>{title}</strong>
          <small id={subtitleId}>{subtitle}</small>
        </span>
      </div>
      <button
        aria-label={`Close ${title.toLowerCase()}`}
        className="floating-panel-close"
        onClick={onClose}
        type="button"
      >
        <PanelIcon name="close" />
      </button>
    </header>
  );
}

type PanelIconName =
  | AsyncTaskKind
  | ConversationOutlineItem["kind"]
  | "clock"
  | "outline"
  | "loading"
  | "chevron-down"
  | "chevron-right"
  | "close";

function PanelIcon({ name, className = "" }: { name: PanelIconName; className?: string }) {
  const path = panelIconPath(name);
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 16 16">
      {path}
    </svg>
  );
}

function panelIconPath(name: PanelIconName) {
  switch (name) {
    case "clock":
      return (
        <>
          <circle cx="8" cy="8" r="5.25" />
          <path d="M8 4.75V8l2.25 1.5" />
        </>
      );
    case "outline":
      return (
        <>
          <path d="M5.25 4h7M5.25 8h7M5.25 12h7" />
          <circle cx="2.75" cy="4" r=".6" />
          <circle cx="2.75" cy="8" r=".6" />
          <circle cx="2.75" cy="12" r=".6" />
        </>
      );
    case "subagent":
    case "user":
      return (
        <>
          <circle cx="8" cy="5.25" r="2.25" />
          <path d="M3.75 13c.35-2.25 1.85-3.5 4.25-3.5s3.9 1.25 4.25 3.5" />
        </>
      );
    case "shell":
      return (
        <>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="m4.5 6 2 2-2 2M8.5 10h3" />
        </>
      );
    case "cloud-agent":
      return (
        <>
          <path d="M4.5 12.25h7a2.5 2.5 0 0 0 .35-4.98A4 4 0 0 0 4.3 6.05 3.1 3.1 0 0 0 4.5 12.25Z" />
          <path d="M8 10V5.75M6.5 7.25 8 5.75l1.5 1.5" />
        </>
      );
    case "thinking":
      return (
        <>
          <circle cx="3" cy="8" r="1" />
          <circle cx="8" cy="8" r="1" />
          <circle cx="13" cy="8" r="1" />
        </>
      );
    case "assistant-text":
      return (
        <path d="m8 2 .9 3.1L12 6l-3.1.9L8 10l-.9-3.1L4 6l3.1-.9L8 2Zm4 7 .45 1.55L14 11l-1.55.45L12 13l-.45-1.55L10 11l1.55-.45L12 9Z" />
      );
    case "tool-call":
      return (
        <path d="M9.75 2.4a3.2 3.2 0 0 0-3.4 4.25l-4.1 4.1a1.4 1.4 0 0 0 2 2l4.1-4.1a3.2 3.2 0 0 0 4.25-3.4L10.5 7.3 8.7 5.5l2.05-2.1Z" />
      );
    case "send-message":
      return (
        <>
          <path d="m2.5 3 11 5-11 5 1.25-4.15L9.5 8 3.75 7.15 2.5 3Z" />
        </>
      );
    case "loading":
      return <path d="M13 8a5 5 0 1 1-1.45-3.53" />;
    case "chevron-down":
      return <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />;
    case "chevron-right":
      return <path d="m6.25 4.5 3.5 3.5-3.5 3.5" />;
    case "close":
      return <path d="m4 4 8 8M12 4l-8 8" />;
  }
}

function asyncTaskKindLabel(kind: AsyncTaskKind): string {
  if (kind === "subagent") return "Subagent";
  if (kind === "shell") return "Shell";
  return "Cloud agent";
}

function outlineLabel(item: ConversationOutlineItem): string {
  switch (item.kind) {
    case "user":
      return "You";
    case "thinking":
      return "Thinking";
    case "assistant-text":
      return "Agent";
    case "send-message":
      return "Message";
    case "tool-call":
      return humanizeToolName(item.name);
  }
}

function outlinePreview(item: ConversationOutlineItem): string {
  if (item.kind === "tool-call") return firstLine(item.summary ?? "");
  if (item.kind === "send-message") return firstLine(item.message);
  return firstLine(item.text);
}

function outlineDetail(item: ConversationOutlineItem): string {
  if (item.kind === "tool-call") return item.summary?.trim() ?? "";
  if (item.kind === "send-message") return item.message.trim();
  return item.text.trim();
}

function firstLine(value: string): string {
  return value.trim().split("\n", 1)[0] ?? "";
}

function humanizeToolName(value: string): string {
  const withoutSuffix = value.endsWith("ToolCall") ? value.slice(0, -8) : value;
  if (!withoutSuffix) return value;
  const spaced = withoutSuffix.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatRelativeTime(timestampMs: number, nowMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "";
  const seconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1_000));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  const days = Math.floor(seconds / 86_400);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function usePanelNow(value?: number): number {
  const [now, setNow] = useState(value ?? Date.now());
  useEffect(() => {
    if (value !== undefined) {
      setNow(value);
      return;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [value]);
  return now;
}

function useFloatingPanelDrag(panelRef: RefObject<HTMLElement | null>) {
  const dragRef = useRef<{
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  return (event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button")))
      return;
    const panel = panelRef.current;
    if (!panel) return;
    cleanupRef.current?.();
    event.preventDefault();
    const header = event.currentTarget;
    const rect = panel.getBoundingClientRect();
    panel.style.animation = "none";
    panel.style.transform = "none";
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = "auto";
    dragRef.current = {
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    header.setPointerCapture(event.pointerId);
    document.body.classList.add("dragging-floating-panel");

    const move = (pointerEvent: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || pointerEvent.pointerId !== drag.pointerId || !panelRef.current) return;
      const current = panelRef.current;
      const bounds = current.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(
          window.innerWidth - bounds.width - 8,
          drag.startLeft + pointerEvent.clientX - drag.startPointerX,
        ),
      );
      const top = Math.max(
        8,
        Math.min(
          window.innerHeight - bounds.height - 8,
          drag.startTop + pointerEvent.clientY - drag.startPointerY,
        ),
      );
      current.style.left = `${left}px`;
      current.style.top = `${top}px`;
    };
    const cancelWithEscape = (keyboardEvent: globalThis.KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") end();
    };
    const end = () => {
      if (cleanupRef.current !== end) return;
      cleanupRef.current = null;
      dragRef.current = null;
      document.body.classList.remove("dragging-floating-panel");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
      window.removeEventListener("keydown", cancelWithEscape);
      header.removeEventListener("lostpointercapture", end);
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
    };
    cleanupRef.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    window.addEventListener("keydown", cancelWithEscape);
    header.addEventListener("lostpointercapture", end);
  };
}
