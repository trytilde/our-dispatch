import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export interface DialogSurfaceProps {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  width?: number;
  className?: string;
}

export function DialogSurface({
  open,
  title,
  description,
  children,
  actions,
  onClose,
  width = 440,
  className = "",
}: DialogSurfaceProps) {
  const titleId = useId();
  const descriptionId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [present, setPresent] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setPresent(true);
      setClosing(false);
      return;
    }
    if (!present) return;
    setClosing(true);
    const timeout = window.setTimeout(() => {
      setPresent(false);
      setClosing(false);
    }, 160);
    return () => window.clearTimeout(timeout);
  }, [open, present]);

  useDialogKeyboard(open, onClose);
  useEffect(() => {
    if (!open) return;
    surfaceRef.current?.focus();
  }, [open]);

  if (!present) return null;
  return (
    <div
      className="dialog-layer ui-dialog-backdrop"
      data-state={closing ? "closing" : "open"}
      onMouseDown={(event) => {
        if (open && event.target === event.currentTarget) onClose?.();
      }}
      role="presentation"
    >
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`dialog-surface ui-dialog ${className}`.trim()}
        data-state={closing ? "closing" : "open"}
        ref={surfaceRef}
        role="dialog"
        style={{ width }}
        tabIndex={-1}
      >
        <header className="dialog-header ui-dialog-header">
          <h2 className="ui-dialog-title" id={titleId}>
            {title}
          </h2>
          {description ? (
            <p className="ui-dialog-description" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </header>
        {children ? <div className="dialog-body">{children}</div> : null}
        {actions ? <footer className="dialog-actions ui-dialog-footer">{actions}</footer> : null}
      </div>
    </div>
  );
}

export interface PermissionAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  tooltip?: string;
}

export interface PermissionStatus {
  kind: "success" | "danger" | "muted";
  label: string;
}

export interface PermissionDisclosure {
  kind: string;
  text: string;
  copyText?: string;
}

export interface PermissionRequestCardProps {
  title: string;
  description?: string;
  actions?: readonly PermissionAction[];
  ariaLabel?: string;
  badge?: ReactNode;
  hideBadge?: boolean;
  leading?: ReactNode;
  location?: string;
  summary?: ReactNode;
  failureNote?: string;
  settledNote?: string;
  status?: PermissionStatus;
  disclosure?: PermissionDisclosure;
  onDismiss?: () => void;
  dismissLabel?: string;
  dismissTooltip?: string;
}

export function PermissionRequestCard({
  title,
  description,
  actions = [],
  ariaLabel = title,
  badge,
  hideBadge = false,
  leading,
  location,
  summary,
  failureNote,
  settledNote,
  status,
  disclosure,
  onDismiss,
  dismissLabel = "Dismiss permission request",
  dismissTooltip,
}: PermissionRequestCardProps) {
  const pending = status == null;
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  return (
    <section
      aria-label={ariaLabel}
      className="permission-card"
      data-state={pending ? "pending" : "settled"}
    >
      <div className="permission-card-copy">
        <div className="permission-card-heading">
          {leading ? (
            <span aria-hidden="true" className="permission-card-leading">
              {leading}
            </span>
          ) : null}
          <strong>{title}</strong>
          {!hideBadge ? (
            <span className="permission-card-status" data-kind={status?.kind ?? "pending"}>
              {pending ? (
                <span aria-hidden="true" className="permission-card-status-spinner" />
              ) : (
                <span aria-hidden="true" className="permission-card-status-dot" />
              )}
              {badge ?? (pending ? "Approval needed" : status.label)}
            </span>
          ) : null}
          {onDismiss && pending ? (
            <button
              aria-label={dismissLabel}
              className="permission-card-dismiss"
              onClick={onDismiss}
              title={dismissTooltip}
              type="button"
            >
              ×
            </button>
          ) : null}
        </div>
        {location ? <small className="permission-card-location">{location}</small> : null}
        {summary ? <div className="permission-card-summary">{summary}</div> : null}
        {pending && description ? <small>{description}</small> : null}
        {pending && failureNote ? <em role="alert">{failureNote}</em> : null}
        {!pending && settledNote ? <small>{settledNote}</small> : null}
        {disclosure ? (
          <div className="permission-card-disclosure">
            <button
              aria-expanded={disclosureOpen}
              onClick={() => setDisclosureOpen((current) => !current)}
              type="button"
            >
              <span aria-hidden="true">{disclosureOpen ? "⌄" : "›"}</span>
              {disclosureOpen ? `Hide the ${disclosure.kind}` : `Show the ${disclosure.kind}`}
            </button>
            {disclosureOpen ? <pre>{disclosure.text}</pre> : null}
          </div>
        ) : null}
      </div>
      {pending && actions.length > 0 ? (
        <div className="permission-card-actions">
          {actions.map((action) => (
            <button
              className={action.primary ? "primary" : ""}
              disabled={action.disabled}
              key={action.label}
              onClick={action.onClick}
              title={action.tooltip}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export type LocalToolPermissionResolution = "always" | "allow-once" | "never" | "deny";
export type LocalToolPermissionStatus =
  | "pending"
  | "submitting"
  | "always"
  | "allow-once"
  | "never"
  | "denied"
  | "expired";

export interface LocalToolPermissionCardProps {
  status: LocalToolPermissionStatus;
  canSubmit?: boolean;
  canAlwaysAllow?: boolean;
  alwaysAllowDisabledReason?: string;
  failureNote?: string;
  productName?: string;
  escapeTarget?: boolean;
  onResolve: (resolution: LocalToolPermissionResolution) => void;
}

export function LocalToolPermissionCard({
  status,
  canSubmit = true,
  canAlwaysAllow = true,
  alwaysAllowDisabledReason,
  failureNote,
  productName = "OpenBot",
  escapeTarget = false,
  onResolve,
}: LocalToolPermissionCardProps) {
  const pending = status === "pending" || status === "submitting";
  const enabled = status === "pending" && canSubmit;

  useEffect(() => {
    if (!escapeTarget || !enabled) return;
    const denyOnEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.repeat ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onResolve("deny");
    };
    window.addEventListener("keydown", denyOnEscape, { capture: true });
    return () => window.removeEventListener("keydown", denyOnEscape, { capture: true });
  }, [enabled, escapeTarget, onResolve]);

  if (!pending) {
    const outcome =
      status === "always"
        ? `${productName} can run commands on your computer.`
        : status === "never"
          ? `${productName} cannot run commands on your computer.`
          : status === "denied" || status === "expired"
            ? `${productName} was not allowed to run commands on your computer.`
            : `${productName} can run commands on your computer this time.`;
    return (
      <div className="local-tool-permission-outcome" title={outcome}>
        {outcome}
      </div>
    );
  }

  return (
    <PermissionRequestCard
      actions={[
        {
          label: "Always allow",
          onClick: () => onResolve("always"),
          disabled: !enabled || !canAlwaysAllow,
          tooltip: !canAlwaysAllow ? alwaysAllowDisabledReason : undefined,
          primary: true,
        },
        {
          label: "Allow once",
          onClick: () => onResolve("allow-once"),
          disabled: !enabled,
        },
        { label: "Never", onClick: () => onResolve("never"), disabled: !enabled },
      ]}
      ariaLabel="Local tool permission"
      description={`This applies to ${productName} and every agent. It can always be changed in Settings.`}
      dismissLabel="Deny once"
      dismissTooltip="Deny once (Esc)"
      failureNote={failureNote}
      hideBadge
      leading={<span className="local-tool-permission-warning">!</span>}
      onDismiss={() => onResolve("deny")}
      title={`Allow ${productName} and all agents to run commands on your local computer?`}
    />
  );
}

export function LocalToolPermissionDock({ children }: { children: ReactNode }) {
  return (
    <div aria-label="Local tool permissions" className="local-tool-permission-dock" role="region">
      {children}
    </div>
  );
}

export interface ThreadOverlayProps {
  open: boolean;
  children: ReactNode;
  footer?: ReactNode;
  label?: string;
  loadFailed?: boolean;
  onClose: () => void;
  onRetry?: () => void;
}

export function ThreadOverlay({
  open,
  children,
  footer,
  label = "Agent exchange",
  loadFailed = false,
  onClose,
  onRetry,
}: ThreadOverlayProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useDialogKeyboard(open, onClose);

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <section aria-label={label} className="thread-overlay" role="dialog">
      <button
        aria-label="Close agent exchange"
        className="thread-overlay-scrim"
        onClick={onClose}
        type="button"
      />
      <div className="thread-overlay-sheet" ref={sheetRef} tabIndex={-1}>
        <div aria-live="off" className="thread-overlay-messages" role="log">
          {loadFailed ? (
            <div className="thread-overlay-load-failed" role="alert">
              <p>Couldn&apos;t load this conversation. Check your connection and try again.</p>
              {onRetry ? (
                <button onClick={onRetry} type="button">
                  Retry
                </button>
              ) : null}
            </div>
          ) : (
            children
          )}
        </div>
        <div aria-hidden="true" className="thread-overlay-fade thread-overlay-fade-top" />
        <div aria-hidden="true" className="thread-overlay-fade thread-overlay-fade-bottom" />
        {footer ? <footer className="thread-overlay-footer">{footer}</footer> : null}
      </div>
    </section>
  );
}

function useDialogKeyboard(open: boolean, onClose?: () => void): void {
  useEffect(() => {
    if (!open || !onClose) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.repeat || event.isComposing)
        return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose, open]);
}
