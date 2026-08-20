import { useEffect, useState } from "react";
import type { ClientWorkspace } from "@tryopenbot/client-runtime";
import { ChevronRightIcon } from "lucide-react";
import { AgentAvatar } from "./agent-avatar.js";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog.js";
import { BackIcon, PlusIcon, TrashIcon } from "./workspace-icons.js";

export interface WorkspaceSelectorProps {
  workspaces: readonly ClientWorkspace[];
  activeWorkspaceId?: string | null;
  joining?: boolean;
  error?: string;
  presentation?: "dialog" | "screen";
  onJoin: (name: string, controlOrigin: string) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}

export interface WorkspaceSelectorDialogProps extends WorkspaceSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceSelectorDialog({
  open,
  onOpenChange,
  ...props
}: WorkspaceSelectorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="workspace-selector-dialog top-[82px] max-w-[520px] translate-y-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Switch workspace</DialogTitle>
        <WorkspaceSelector {...props} />
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceSelector({
  workspaces,
  activeWorkspaceId,
  joining = false,
  error = "",
  presentation = "dialog",
  onJoin,
  onRemove,
  onSelect,
}: WorkspaceSelectorProps) {
  const [adding, setAdding] = useState(workspaces.length === 0);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (workspaces.length === 0) setAdding(true);
  }, [workspaces.length]);

  if (adding)
    return (
      <form
        className={`workspace-selector workspace-selector-add workspace-selector-${presentation}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!joining && name.trim() && origin.trim()) onJoin(name.trim(), origin);
        }}
      >
        {presentation === "dialog" ? (
          <div className="workspace-selector-heading">
            <span>Add a workspace</span>
            <small>Name it and enter its OpenBot control server URL.</small>
          </div>
        ) : null}
        <div className="workspace-selector-fields">
          <label className="workspace-selector-field" htmlFor="workspace-name">
            <span>Workspace name</span>
            <input
              autoFocus
              disabled={joining}
              id="workspace-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Design team"
              type="text"
              value={name}
            />
          </label>
          <label className="workspace-selector-field" htmlFor="workspace-control-origin">
            <span>Control server URL</span>
            <input
              disabled={joining}
              id="workspace-control-origin"
              onChange={(event) => setOrigin(event.target.value)}
              placeholder="https://openbot.example.com"
              spellCheck={false}
              inputMode="url"
              type="text"
              value={origin}
            />
          </label>
        </div>
        {error ? <p className="workspace-selector-error">{error}</p> : null}
        <div
          className={`workspace-selector-actions ${workspaces.length === 0 ? "workspace-selector-actions-single" : ""}`}
        >
          {workspaces.length > 0 ? (
            <button
              className="workspace-selector-back"
              disabled={joining}
              onClick={() => setAdding(false)}
              type="button"
            >
              <BackIcon />
              Back
            </button>
          ) : null}
          <button
            className="workspace-selector-join"
            disabled={joining || !name.trim() || !origin.trim()}
            type="submit"
          >
            {joining ? <span className="workspace-selector-spinner" aria-hidden="true" /> : null}
            {joining ? "Connecting…" : "Join"}
            {!joining ? <ChevronRightIcon aria-hidden="true" /> : null}
          </button>
        </div>
      </form>
    );

  return (
    <div className={`workspace-selector workspace-selector-${presentation}`}>
      {presentation === "dialog" ? (
        <div className="workspace-selector-heading">
          <span>Switch workspace</span>
          <small>Choose the control server this app should use.</small>
        </div>
      ) : null}
      <div className="workspace-selector-list" role="listbox" aria-label="Workspaces">
        {workspaces.map((workspace) => (
          <div
            aria-selected={workspace.id === activeWorkspaceId}
            className="workspace-selector-row"
            key={workspace.id}
            onClick={() => onSelect(workspace.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(workspace.id);
              }
            }}
            role="option"
            tabIndex={0}
          >
            <span className="workspace-selector-avatar" style={{ background: workspace.color }}>
              {workspace.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="workspace-selector-meta">
              <strong>{workspace.name}</strong>
              <button
                className="workspace-selector-remove"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(workspace.id);
                }}
                type="button"
              >
                <TrashIcon />
                Remove
              </button>
            </span>
            {workspace.id === activeWorkspaceId ? (
              <span className="workspace-selector-current">Current</span>
            ) : null}
          </div>
        ))}
        <button
          className="workspace-selector-row workspace-selector-new"
          onClick={() => setAdding(true)}
          type="button"
        >
          <span className="workspace-selector-avatar">
            <PlusIcon />
          </span>
          <span className="workspace-selector-meta">
            <strong>Add a workspace</strong>
            <small>Connect another control server</small>
          </span>
        </button>
      </div>
      {error ? <p className="workspace-selector-error">{error}</p> : null}
    </div>
  );
}

export function SelectWorkspaceScreen(props: WorkspaceSelectorProps) {
  return (
    <main className="select-workspace-screen">
      <WorkspaceConstellation />
      <section className="select-workspace-content">
        <div className="select-workspace-title">
          <h1>Select a workspace</h1>
        </div>
        <WorkspaceSelector {...props} presentation="screen" />
      </section>
    </main>
  );
}

export function WorkspaceAccessScreen({
  name,
  error = "",
  signingIn = false,
  onSignIn,
  onSwitchWorkspace,
}: {
  name: string;
  error?: string;
  signingIn?: boolean;
  onSignIn: () => void;
  onSwitchWorkspace: () => void;
}) {
  return (
    <main className="workspace-access-screen">
      <WorkspaceConstellation />
      <section>
        <h1>Sign in to {name}</h1>
        {error ? <p className="workspace-selector-error">{error}</p> : null}
        <button disabled={signingIn} onClick={onSignIn} type="button">
          {signingIn ? <span className="workspace-selector-spinner" aria-hidden="true" /> : null}
          {signingIn ? "Opening sign in…" : "Sign in"}
        </button>
        <button className="workspace-access-switch" onClick={onSwitchWorkspace} type="button">
          Switch workspace
        </button>
      </section>
    </main>
  );
}

function WorkspaceConstellation() {
  return (
    <div className="workspace-constellation" aria-hidden="true">
      <AgentAvatar
        id="workspace-orbit-cobalt"
        paused
        className="workspace-float workspace-float-one"
      />
      <AgentAvatar
        id="workspace-orbit-coral"
        paused
        className="workspace-float workspace-float-two"
      />
      <AgentAvatar
        id="workspace-orbit-moss"
        paused
        className="workspace-float workspace-float-three"
      />
      <AgentAvatar
        id="workspace-orbit-violet"
        paused
        className="workspace-float workspace-float-four"
      />
      <AgentAvatar
        id="workspace-orbit-amber"
        paused
        className="workspace-float workspace-float-five"
      />
    </div>
  );
}
