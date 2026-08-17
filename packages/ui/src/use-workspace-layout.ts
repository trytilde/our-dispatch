import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

const SIDEBAR_DEFAULT = 280;
const SIDEBAR_COLLAPSED = 88;
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 400;
const WORKSPACE_DEFAULT = 320;
const WORKSPACE_MIN = 280;
const WORKSPACE_MAX = 480;
const CHAT_MIN = 424;

const sidebarWidthKey = "openbot.workspace.sidebar-width";
const sidebarCollapsedKey = "openbot.workspace.sidebar-collapsed";
const workspaceWidthKey = "openbot.workspace.computer-width";
const workspaceOpenKey = "openbot.workspace.computer-open";

export interface WorkspaceLayout {
  sidebarCollapsed: boolean;
  workspaceOpen: boolean;
  style: CSSProperties;
  toggleSidebar: () => void;
  toggleWorkspace: () => void;
  beginSidebarResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  beginWorkspaceResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function useWorkspaceLayout(): WorkspaceLayout {
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readNumber(sidebarWidthKey, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readBoolean(sidebarCollapsedKey, false),
  );
  const [workspaceWidth, setWorkspaceWidth] = useState(() =>
    readNumber(workspaceWidthKey, WORKSPACE_DEFAULT, WORKSPACE_MIN, WORKSPACE_MAX),
  );
  const [workspaceOpen, setWorkspaceOpen] = useState(() => readBoolean(workspaceOpenKey, false));
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );

  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const autoCollapsed =
    !sidebarCollapsed &&
    viewportWidth < sidebarWidth + CHAT_MIN + (workspaceOpen ? workspaceWidth : 0);
  const compact = sidebarCollapsed || autoCollapsed;

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      writeBoolean(sidebarCollapsedKey, next);
      return next;
    });
  }, []);

  const toggleWorkspace = useCallback(() => {
    setWorkspaceOpen((current) => {
      const next = !current;
      writeBoolean(workspaceOpenKey, next);
      return next;
    });
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") return;
      event.preventDefault();
      if (event.altKey) toggleWorkspace();
      else toggleSidebar();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [toggleSidebar, toggleWorkspace]);

  const beginSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const originX = event.clientX;
      const originWidth = compact ? SIDEBAR_COLLAPSED : sidebarWidth;
      beginResize((pointerX) => {
        const candidate = originWidth + pointerX - originX;
        if (candidate < (SIDEBAR_COLLAPSED + SIDEBAR_MIN) / 2) {
          setSidebarCollapsed(true);
          writeBoolean(sidebarCollapsedKey, true);
          return;
        }
        const next = clamp(candidate, SIDEBAR_MIN, SIDEBAR_MAX);
        setSidebarCollapsed(false);
        setSidebarWidth(next);
        writeBoolean(sidebarCollapsedKey, false);
        writeNumber(sidebarWidthKey, next);
      });
    },
    [compact, sidebarWidth],
  );

  const beginWorkspaceResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const originX = event.clientX;
      const originWidth = workspaceWidth;
      beginResize((pointerX) => {
        const next = clamp(originWidth + originX - pointerX, WORKSPACE_MIN, WORKSPACE_MAX);
        setWorkspaceWidth(next);
        writeNumber(workspaceWidthKey, next);
      });
    },
    [workspaceWidth],
  );

  const style = useMemo(
    () =>
      ({
        "--sidebar-width": `${compact ? SIDEBAR_COLLAPSED : sidebarWidth}px`,
        "--workspace-width": `${workspaceOpen ? workspaceWidth : 0}px`,
      }) as CSSProperties,
    [compact, sidebarWidth, workspaceOpen, workspaceWidth],
  );

  return {
    sidebarCollapsed: compact,
    workspaceOpen,
    style,
    toggleSidebar,
    toggleWorkspace,
    beginSidebarResize,
    beginWorkspaceResize,
  };
}

function beginResize(onMove: (clientX: number) => void): void {
  const handleMove = (event: PointerEvent) => onMove(event.clientX);
  const finish = () => {
    document.body.classList.remove("resizing-workspace");
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
  };
  document.body.classList.add("resizing-workspace");
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", finish, { once: true });
}

function readBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  return value === null ? fallback : value === "true";
}

function readNumber(key: string, fallback: number, minimum: number, maximum: number): number {
  if (typeof window === "undefined") return fallback;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? clamp(value, minimum, maximum) : fallback;
}

function writeBoolean(key: string, value: boolean): void {
  window.localStorage.setItem(key, String(value));
}

function writeNumber(key: string, value: number): void {
  window.localStorage.setItem(key, String(Math.round(value)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
