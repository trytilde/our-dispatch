import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import { ArrowLeftIcon, XIcon } from "lucide-react";

/**
 * The right-hand agent details pane beside the conversation. Width is
 * presentation-only state kept here (localStorage), and dragging below the
 * collapse threshold closes the pane.
 */

const WIDTH_KEY = "openbot.workspace.details-width";
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 260;
const MAX_WIDTH = 480;
const COLLAPSE_WIDTH = 244;

function readWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const value = Number(window.localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(value) && value > 0
    ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value))
    : DEFAULT_WIDTH;
}

export interface AgentDetailsPaneProps {
  open: boolean;
  /** "Details" on the overview, "Routine" when a routine is open. */
  title: string;
  onClose: () => void;
  backLabel?: string;
  onBack?: () => void;
  children: ReactNode;
}

export function AgentDetailsPane({
  open,
  title,
  onClose,
  backLabel,
  onBack,
  children,
}: AgentDetailsPaneProps) {
  const [width, setWidth] = useState(readWidth);

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const originX = event.clientX;
      const originWidth = width;
      let nextWidth = originWidth;
      let collapsed = false;
      const handleMove = (move: PointerEvent) => {
        const candidate = originWidth + originX - move.clientX;
        if (candidate < COLLAPSE_WIDTH) {
          collapsed = true;
          return;
        }
        collapsed = false;
        nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, candidate));
        setWidth(nextWidth);
      };
      const finish = () => {
        document.body.classList.remove("resizing-workspace");
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        window.localStorage.setItem(WIDTH_KEY, String(Math.round(nextWidth)));
        if (collapsed) onClose();
      };
      document.body.classList.add("resizing-workspace");
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", finish, { once: true });
    },
    [onClose, width],
  );

  return (
    <section
      aria-hidden={!open}
      aria-label="Details"
      className={`ob-details-pane ${open ? "open" : "closed"}`}
      inert={!open}
      role="complementary"
      style={{ width: open ? width : 0 }}
    >
      <div
        aria-label="Resize details"
        className="workspace-resize-handle"
        onPointerDown={beginResize}
        role="separator"
      />
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3">
        {onBack ? (
          <button
            aria-label={backLabel ?? "Back"}
            className="flex h-7 items-center gap-1.5 rounded-control px-1.5 text-[12px]
              font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            onClick={onBack}
            type="button"
          >
            <ArrowLeftIcon aria-hidden className="size-3.5" />
            {backLabel}
          </button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{title}</h2>
        <button
          aria-label="Close details"
          className="flex size-6 items-center justify-center rounded-control text-ink-3
            transition-colors hover:bg-hover hover:text-ink"
          onClick={onClose}
          type="button"
        >
          <XIcon aria-hidden className="size-3.5" />
        </button>
      </header>
      {children}
    </section>
  );
}
