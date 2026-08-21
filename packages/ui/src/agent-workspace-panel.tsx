import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { Maximize2Icon, Minimize2Icon, MousePointer2Icon, XIcon } from "lucide-react";
import { ComputerStagePlaceholder } from "./computer-stage.js";
import { ComputerReconnectBanner } from "./computer-components.js";

export interface AgentWorkspacePanelProps {
  agentId: string;
  agentName: string;
  open: boolean;
  onClose: () => void;
  onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function AgentWorkspacePanel({
  agentId,
  agentName,
  open,
  onClose,
  onResize,
}: AgentWorkspacePanelProps) {
  const [controlling, setControlling] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewTraceId, setPreviewTraceId] = useState(() => crypto.randomUUID());
  const [previewReady, setPreviewReady] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const previewAgentId = agentId;
  const previewAgentName = agentName;
  const previewUrl = `/api/computer/${encodeURIComponent(agentId)}/preview?trace_id=${encodeURIComponent(previewTraceId)}`;

  useEffect(() => {
    setControlling(false);
    setPreviewReady(false);
    setPreviewFailed(false);
    setPreviewTraceId(crypto.randomUUID());
  }, [agentId]);

  useEffect(() => {
    if (!open && !fullscreen) return;
    console.info("[openbot-vnc] iframe preview started", {
      agentId: previewAgentId,
      path: previewPath(previewUrl),
      requestId: previewTraceId,
    });
  }, [fullscreen, open, previewAgentId, previewTraceId, previewUrl]);

  useEffect(() => {
    if (!fullscreen) return;
    const exitFullscreen = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setControlling(false);
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", exitFullscreen);
    return () => window.removeEventListener("keydown", exitFullscreen);
  }, [fullscreen]);

  useEffect(() => {
    if (!open && !fullscreen) return;
    const receivePreviewState = (event: MessageEvent) => {
      if (event.source !== previewFrameRef.current?.contentWindow) return;
      const payload = event.data as { type?: unknown; phase?: unknown; detail?: unknown };
      if (payload?.type !== "openbot:vnc" || typeof payload.phase !== "string") return;
      console.info("[openbot-vnc] viewer state changed", {
        agentId: previewAgentId,
        phase: payload.phase,
        requestId: previewTraceId,
      });
      if (payload.phase === "connected") {
        setPreviewFailed(false);
        setPreviewReady(true);
      } else if (payload.phase === "disconnected" || payload.phase === "failed") {
        setControlling(false);
        setPreviewReady(false);
        setPreviewFailed(true);
      }
    };
    window.addEventListener("message", receivePreviewState);
    return () => window.removeEventListener("message", receivePreviewState);
  }, [fullscreen, open, previewAgentId, previewTraceId]);

  return (
    <section
      aria-hidden={!open && !fullscreen}
      className={`work-pane agent-workspace-pane ${open ? "open" : "closed"} ${fullscreen ? "fullscreen" : ""}`}
      inert={!open && !fullscreen}
      role={fullscreen ? "dialog" : "complementary"}
      aria-label={fullscreen ? `${previewAgentName} Computer` : "Computer preview"}
      aria-modal={fullscreen || undefined}
    >
      <div aria-hidden="true" className="computer-window-drag-region" />
      <div
        aria-label="Resize Computer pane"
        className="workspace-resize-handle"
        onPointerDown={onResize}
        role="separator"
      />
      <button
        aria-label="Close Computer pane"
        className="computer-collapse"
        onClick={() => {
          setFullscreen(false);
          onClose();
        }}
        title="Close Computer pane"
        type="button"
      >
        <XIcon aria-hidden />
      </button>

      {fullscreen ? (
        <header className="computer-fullscreen-bar">
          <button
            className="computer-fullscreen-release"
            onClick={() => {
              setControlling(false);
              setFullscreen(false);
            }}
            type="button"
          >
            <Minimize2Icon aria-hidden />
            Exit full screen
          </button>
        </header>
      ) : null}

      {agentId && (open || fullscreen) ? (
        <div className={controlling ? "computer-surface controlling" : "computer-surface"}>
          <ComputerReconnectBanner variant={previewFailed ? "network" : null} />
          <iframe
            key={`${previewAgentId}-${previewKey}`}
            ref={previewFrameRef}
            src={previewUrl}
            title={`${previewAgentName} Computer`}
            allow="clipboard-read; clipboard-write"
            referrerPolicy="no-referrer"
            onError={() => {
              console.error("[openbot-vnc] iframe preview failed", {
                agentId: previewAgentId,
                path: previewPath(previewUrl),
                requestId: previewTraceId,
              });
              setPreviewReady(false);
              setPreviewFailed(true);
            }}
            onLoad={(event) => {
              let failed = false;
              let documentAccess: "cross-origin" | "same-origin" = "same-origin";
              try {
                const document = event.currentTarget.contentDocument;
                const location = event.currentTarget.contentWindow?.location.href ?? "";
                const responseText = document?.body?.textContent?.trim() ?? "";
                failed =
                  !document?.body ||
                  document.contentType !== "text/html" ||
                  Boolean(document.querySelector("[data-openbot-preview-error]")) ||
                  /^\{\s*"error"\s*:/.test(responseText) ||
                  location.startsWith("chrome-error:");
              } catch {
                // The preview redirects to the computer's own noVNC origin, so reading the
                // document throws for the ordinary success case. Only same-origin error
                // payloads are detectable here; a cross-origin document means it loaded.
                failed = false;
                documentAccess = "cross-origin";
              }
              console.info("[openbot-vnc] iframe preview loaded", {
                agentId: previewAgentId,
                documentAccess,
                failed,
                path: previewPath(previewUrl),
                requestId: previewTraceId,
              });
              setPreviewFailed(failed);
              if (failed) setPreviewReady(false);
            }}
          />
          {!previewReady || previewFailed ? (
            <ComputerStagePlaceholder
              busy={!previewFailed}
              message={
                previewFailed ? `Can't reach ${previewAgentName}'s screen` : "Starting the computer"
              }
              onRetry={
                previewFailed
                  ? () => {
                      setPreviewFailed(false);
                      setPreviewReady(false);
                      setPreviewTraceId(crypto.randomUUID());
                      setPreviewKey((value) => value + 1);
                    }
                  : undefined
              }
            />
          ) : null}
          {!controlling && previewReady ? (
            <button
              aria-label={`Take control of ${previewAgentName}'s Computer`}
              className="computer-shield"
              onClick={() => {
                setControlling(true);
                setFullscreen(true);
              }}
              type="button"
            >
              <strong>
                <Maximize2Icon aria-hidden />
                Open
              </strong>
            </button>
          ) : null}
          {!fullscreen && previewReady ? (
            <span aria-hidden="true" className="computer-preview-hint">
              <MousePointer2Icon />
              Take control
            </span>
          ) : null}
        </div>
      ) : !agentId ? (
        <div className="computer-empty">
          <span>⌁</span>
          <h3>No agent selected</h3>
          <p>Select an agent to open its Computer.</p>
        </div>
      ) : null}
    </section>
  );
}

/** Keep capability-bearing VNC query strings out of browser diagnostics. */
function previewPath(value: string): string {
  try {
    return new URL(value, window.location.href).pathname;
  } catch {
    return "computer-preview";
  }
}
