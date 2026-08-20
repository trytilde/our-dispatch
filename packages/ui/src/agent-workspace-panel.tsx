import { type PointerEvent as ReactPointerEvent, useEffect, useState } from "react";
import { ComputerStagePlaceholder } from "./computer-stage.js";
import {
  type ComputerMonitor,
  ComputerMonitorStrip,
  ComputerReconnectBanner,
} from "./computer-components.js";

export interface AgentWorkspacePanelProps {
  agentId: string;
  agentName: string;
  open: boolean;
  onClose: () => void;
  onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  monitors?: readonly ComputerMonitor[];
  onSelectMonitor?: (monitorId: string) => void;
}

export function AgentWorkspacePanel({
  agentId,
  agentName,
  open,
  onClose,
  onResize,
  monitors = [],
  onSelectMonitor,
}: AgentWorkspacePanelProps) {
  const [controlling, setControlling] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewTraceId, setPreviewTraceId] = useState(() => crypto.randomUUID());
  const [previewReady, setPreviewReady] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeMonitorId, setActiveMonitorId] = useState(agentId);
  const activeMonitor = monitors.find((monitor) => monitor.id === activeMonitorId);
  const previewAgentId = activeMonitor?.id ?? agentId;
  const previewAgentName = activeMonitor?.title ?? agentName;
  const previewUrl =
    activeMonitor?.previewUrl ??
    `/api/computer/${encodeURIComponent(agentId)}/preview?trace_id=${encodeURIComponent(previewTraceId)}`;

  useEffect(() => {
    setActiveMonitorId(agentId);
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
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", exitFullscreen);
    return () => window.removeEventListener("keydown", exitFullscreen);
  }, [fullscreen]);

  return (
    <section
      aria-hidden={!open && !fullscreen}
      className={`work-pane agent-workspace-pane ${open ? "open" : "closed"} ${fullscreen ? "fullscreen" : ""}`}
      inert={!open && !fullscreen}
    >
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
        <span aria-hidden>»</span>
      </button>

      {agentId && (open || fullscreen) ? (
        <div className={controlling ? "computer-surface controlling" : "computer-surface"}>
          <ComputerReconnectBanner variant={previewFailed ? "network" : null} />
          <iframe
            key={`${previewAgentId}-${previewKey}`}
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
              setPreviewReady(!failed);
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
            <button className="computer-shield" onClick={() => setControlling(true)}>
              <span>Computer preview</span>
              <strong>Click to take over</strong>
            </button>
          ) : null}
          {controlling ? (
            <button
              aria-label="Release"
              className="computer-release"
              onClick={() => setControlling(false)}
              title="Release control back to the agent"
              type="button"
            >
              Release
            </button>
          ) : null}
          <button
            aria-label={fullscreen ? "Exit full screen" : "Enter full screen"}
            className="computer-maximize"
            onClick={() => setFullscreen((value) => !value)}
            title={fullscreen ? "Exit full screen" : "Enter full screen"}
            type="button"
          >
            <span aria-hidden>{fullscreen ? "⤡" : "⤢"}</span>
          </button>
          {previewReady && monitors.length > 1 ? (
            <ComputerMonitorStrip
              activeMonitorId={previewAgentId}
              monitors={monitors}
              onSelect={(monitorId) => {
                setActiveMonitorId(monitorId);
                setControlling(false);
                setPreviewReady(false);
                setPreviewFailed(false);
                setPreviewTraceId(crypto.randomUUID());
                setPreviewKey((value) => value + 1);
                onSelectMonitor?.(monitorId);
              }}
            />
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
