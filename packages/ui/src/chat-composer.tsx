import type { ChangeEvent, DragEvent, FocusEventHandler, FormEventHandler, RefObject } from "react";
import { PlusIcon, ReplyIcon, SendIcon } from "./workspace-icons.js";

export interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: "ready" | "uploading" | "uploaded" | "error";
  error?: string;
}

export interface ComposerReply {
  label: string;
  text: string;
}

export interface ChatComposerProps {
  agentAvailable: boolean;
  busy: boolean;
  submitting: boolean;
  dragging: boolean;
  expanded: boolean;
  draft: string;
  error?: string;
  reply?: ComposerReply;
  attachments: readonly ComposerAttachment[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onDraftChange: (value: string) => void;
  onFocus?: FocusEventHandler<HTMLTextAreaElement>;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
  onDragStateChange: (active: boolean) => void;
  onFilesAdded: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  onCancelReply: () => void;
  onStop: () => void;
}

export function ChatComposer({
  agentAvailable,
  busy,
  submitting,
  dragging,
  expanded,
  draft,
  error = "",
  reply,
  attachments,
  inputRef,
  fileInputRef,
  onSubmit,
  onDraftChange,
  onFocus,
  onBlur,
  onDragStateChange,
  onFilesAdded,
  onRemoveAttachment,
  onCancelReply,
  onStop,
}: ChatComposerProps) {
  const hasContent = Boolean(draft.trim() || attachments.length);

  function setDrag(event: DragEvent, active: boolean): void {
    event.preventDefault();
    onDragStateChange(active);
  }

  return (
    <form
      className={`composer ${dragging ? "dragging" : ""} ${expanded ? "expanded" : ""}`}
      onSubmit={onSubmit}
      onDragEnter={(event) => setDrag(event, true)}
      onDragOver={(event) => setDrag(event, true)}
      onDragLeave={(event) => setDrag(event, false)}
      onDrop={(event) => {
        event.preventDefault();
        onDragStateChange(false);
        onFilesAdded(event.dataTransfer.files);
      }}
    >
      {reply ? (
        <div className="reply-preview">
          <ReplyIcon />
          <span>
            <strong>{reply.label}</strong>
            <small>{reply.text}</small>
          </span>
          <button aria-label="Cancel reply" onClick={onCancelReply} type="button">
            ×
          </button>
        </div>
      ) : null}
      {attachments.length ? (
        <div className="attachment-tray">
          {attachments.map((attachment) => (
            <div className={`pending-file ${attachment.status}`} key={attachment.id}>
              <span className="file-icon">↗</span>
              <span>
                <strong>{attachment.name}</strong>
                <small>
                  {attachment.status === "uploading"
                    ? `${Math.round(attachment.progress * 100)}%`
                    : attachment.error || formatBytes(attachment.size)}
                </small>
              </span>
              <button
                type="button"
                onClick={() => onRemoveAttachment(attachment.id)}
                aria-label="Remove file"
              >
                ×
              </button>
              {attachment.status === "uploading" ? (
                <i style={{ width: `${attachment.progress * 100}%` }} />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {dragging ? <div className="drop-overlay">Drop files to attach</div> : null}
      <textarea
        aria-label="Message"
        disabled={!agentAvailable}
        ref={inputRef}
        placeholder={agentAvailable ? "Ask anything, or drop a file." : "No agent is available."}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onBlur={onBlur}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="composer-toolbar">
        <div>
          <input
            hidden
            multiple
            ref={fileInputRef}
            type="file"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              if (event.target.files) onFilesAdded(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            className="attach-button"
            type="button"
            disabled={!agentAvailable || submitting}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            title="Attach files"
          >
            <PlusIcon />
          </button>
          <span className={error ? "error" : ""}>{error || "Shift + Enter for a new line"}</span>
        </div>
        <div className="composer-actions">
          {busy ? (
            <button className="stop-button" type="button" onClick={onStop} aria-label="Stop">
              ■
            </button>
          ) : null}
          <button
            aria-label={busy ? "Queue message" : "Send message"}
            disabled={!agentAvailable || !hasContent || submitting}
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </form>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
