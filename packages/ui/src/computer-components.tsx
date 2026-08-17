import { type ReactNode, useRef } from "react";
import { DialogSurface } from "./overlay-components.js";

export interface ComputerMonitor {
  id: string;
  title: string;
  previewUrl: string;
  needsAttention?: boolean;
}

export interface ComputerMonitorStripProps {
  monitors: readonly ComputerMonitor[];
  activeMonitorId?: string;
  onSelect: (monitorId: string) => void;
}

export type ComputerReconnectVariant = "checking" | "network" | "restarting";

export interface ComputerReconnectBannerProps {
  variant?: ComputerReconnectVariant | null;
  computerName?: string;
}

export function ComputerReconnectBanner({
  variant,
  computerName = "OpenBot's Computer",
}: ComputerReconnectBannerProps) {
  if (!variant) return null;
  const copy =
    variant === "checking"
      ? { title: "Checking connection", subtitle: "Reconnecting" }
      : variant === "network"
        ? { title: "Reconnecting" }
        : { title: `${computerName} restarting`, subtitle: `Starting ${computerName}` };
  return (
    <div className="computer-reconnect-banner-layer">
      <div
        aria-label={copy.title}
        aria-live="polite"
        className="computer-progress-banner"
        data-variant={variant}
        role="status"
      >
        <span aria-hidden="true" className="computer-progress-spinner" />
        <span>
          <strong>{copy.title}</strong>
          {copy.subtitle ? <small>{copy.subtitle}</small> : null}
        </span>
      </div>
    </div>
  );
}

export interface ComputerLifecycleDialogProps {
  open: boolean;
  title: string;
  description: string;
  actions: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function ComputerLifecycleDialog({
  open,
  title,
  description,
  actions,
  onDismiss,
  className = "",
}: ComputerLifecycleDialogProps) {
  return (
    <DialogSurface
      actions={actions}
      className={`computer-lifecycle-dialog ${className}`.trim()}
      description={description}
      onClose={onDismiss}
      open={open}
      title={title}
      width={440}
    />
  );
}

export interface ComputerUnreachableDialogProps {
  open: boolean;
  canRecover: boolean;
  computerName?: string;
  onRecover: () => void;
  onRetry: () => void;
}

export function ComputerUnreachableDialog({
  open,
  canRecover,
  computerName = "OpenBot's Computer",
  onRecover,
  onRetry,
}: ComputerUnreachableDialogProps) {
  return (
    <ComputerLifecycleDialog
      actions={
        <>
          <button disabled={!canRecover} onClick={onRecover} type="button">
            Recover {computerName}
          </button>
          <button className="primary" onClick={onRetry} type="button">
            Retry
          </button>
        </>
      }
      className="computer-unreachable-dialog"
      description={`Your agents, files, and logins are safe. If it doesn't reconnect on its own, recover ${computerName} to keep the data.`}
      open={open}
      title={`Couldn't Reach ${computerName}`}
    />
  );
}

export interface ComputerRecoveryConfirmDialogProps {
  open: boolean;
  canRecover: boolean;
  computerName?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ComputerRecoveryConfirmDialog({
  open,
  canRecover,
  computerName = "OpenBot's Computer",
  onCancel,
  onConfirm,
}: ComputerRecoveryConfirmDialogProps) {
  return (
    <ComputerLifecycleDialog
      actions={
        <>
          <button onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary" disabled={!canRecover} onClick={onConfirm} type="button">
            Recover {computerName}
          </button>
        </>
      }
      className="computer-recovery-confirm-dialog"
      description={`This recreates ${computerName} and reconnects. Your agents, files, and logins are kept.`}
      onDismiss={onCancel}
      open={open}
      title={`Recover ${computerName}?`}
    />
  );
}

export type ComputerOperationKind = "update" | "reset" | "recover";

export type ComputerOperationStage =
  | "preparing"
  | "tearingDown"
  | "downloading"
  | "starting"
  | "finishing";

export type ComputerMigrationStatus =
  | "backing-up"
  | "wiping"
  | "creating"
  | "moving"
  | "cleaning-up"
  | "done"
  | "failed";

export type ComputerLifecycleStepState = "done" | "active" | "pending";

export interface ComputerLifecycleStep {
  label: string;
  state: ComputerLifecycleStepState;
}

export interface ComputerRebuildProgress {
  steps: readonly ComputerLifecycleStep[];
  activeIndex: number;
  progress: number;
}

const operationTitles: Record<ComputerOperationKind, string> = {
  update: "Updating",
  reset: "Resetting",
  recover: "Recovering",
};

function sentenceCaseComputerName(computerName: string): string {
  return computerName.replace(/Computer$/, "computer");
}

function operationSteps(kind: ComputerOperationKind, computerName: string): readonly string[] {
  const sentenceName = sentenceCaseComputerName(computerName);
  if (kind === "reset") {
    return [
      "Getting ready",
      "Wiping your data",
      `Creating ${sentenceName}`,
      `Starting ${sentenceName}`,
      "Cleaning up",
      "Reconnecting",
    ];
  }
  if (kind === "recover") {
    return [
      "Getting ready",
      `Recreating ${sentenceName}`,
      `Starting ${sentenceName}`,
      "Reconnecting",
    ];
  }
  return [
    "Getting ready",
    "Backing up your data",
    `Recreating ${sentenceName}`,
    `Starting ${sentenceName}`,
    "Cleaning up",
    "Reconnecting",
  ];
}

function stageIndex(kind: ComputerOperationKind, stage: ComputerOperationStage): number {
  if (kind === "reset") {
    return { preparing: 0, tearingDown: 1, downloading: 3, starting: 3, finishing: 5 }[stage];
  }
  if (kind === "recover") {
    return { preparing: 0, tearingDown: 1, downloading: 2, starting: 2, finishing: 3 }[stage];
  }
  return { preparing: 0, tearingDown: 2, downloading: 2, starting: 3, finishing: 5 }[stage];
}

function migrationIndex(
  kind: ComputerOperationKind,
  status: ComputerMigrationStatus,
  cleaningAfterMigration: boolean,
): number | null {
  if (status === "done" || status === "failed") return null;
  if (kind === "reset") {
    return {
      "backing-up": 0,
      wiping: 1,
      creating: 2,
      moving: 3,
      "cleaning-up": cleaningAfterMigration ? 4 : 1,
    }[status];
  }
  if (kind === "recover") {
    return {
      "backing-up": 1,
      wiping: 1,
      creating: 1,
      moving: 2,
      "cleaning-up": cleaningAfterMigration ? 3 : 1,
    }[status];
  }
  return {
    "backing-up": 1,
    wiping: 2,
    creating: 2,
    moving: 3,
    "cleaning-up": cleaningAfterMigration ? 4 : 2,
  }[status];
}

function isActiveMigration(
  status?: ComputerMigrationStatus | null,
): status is Exclude<ComputerMigrationStatus, "done" | "failed"> {
  return status != null && status !== "done" && status !== "failed";
}

export function getComputerRebuildProgress({
  kind,
  stage,
  migrationStatus = null,
  migrationPhases = [],
  pullPercent,
  computerName = "OpenBot's Computer",
}: {
  kind: ComputerOperationKind;
  stage: ComputerOperationStage;
  migrationStatus?: ComputerMigrationStatus | null;
  migrationPhases?: readonly ComputerMigrationStatus[];
  pullPercent?: number | null;
  computerName?: string;
}): ComputerRebuildProgress {
  const phases =
    isActiveMigration(migrationStatus) && migrationPhases.at(-1) !== migrationStatus
      ? [...migrationPhases, migrationStatus]
      : migrationPhases;
  let priorMigration = false;
  let furthestMigrationIndex: number | null = null;
  for (const phase of phases) {
    const index = migrationIndex(kind, phase, phase === "cleaning-up" && priorMigration);
    if (index != null) {
      furthestMigrationIndex =
        furthestMigrationIndex == null ? index : Math.max(furthestMigrationIndex, index);
    }
    if (phase !== "cleaning-up") priorMigration = true;
  }

  const currentStageIndex = stageIndex(kind, stage);
  const activeIndex =
    furthestMigrationIndex == null
      ? currentStageIndex
      : isActiveMigration(migrationStatus)
        ? furthestMigrationIndex
        : Math.max(furthestMigrationIndex, currentStageIndex);
  const pullFraction =
    activeIndex === currentStageIndex &&
    kind === "update" &&
    stage === "downloading" &&
    pullPercent != null &&
    pullPercent > 0
      ? Math.min(pullPercent, 100) / 100
      : 0;
  const labels = operationSteps(kind, computerName);
  return {
    activeIndex,
    progress: (activeIndex + pullFraction) / labels.length,
    steps: labels.map((label, index) => ({
      label,
      state: index < activeIndex ? "done" : index === activeIndex ? "active" : "pending",
    })),
  };
}

export interface ComputerFailureDialogProps {
  open: boolean;
  kind: ComputerOperationKind;
  canRetry: boolean;
  computerName?: string;
  onDismiss: () => void;
  onRetry: () => void;
}

const failureTitles: Record<ComputerOperationKind, string> = {
  update: "Update failed",
  reset: "Reset failed",
  recover: "Recover failed",
};

const failureRetryLabels: Record<ComputerOperationKind, string> = {
  update: "Retry Update",
  reset: "Retry Reset",
  recover: "Retry Recovery",
};

export function ComputerFailureDialog({
  open,
  kind,
  canRetry,
  computerName = "OpenBot's Computer",
  onDismiss,
  onRetry,
}: ComputerFailureDialogProps) {
  const sentenceName = sentenceCaseComputerName(computerName);
  const description =
    kind === "update"
      ? `The update couldn't finish, so ${sentenceName} is still on its previous image. Your agents, files, and logins are safe.`
      : kind === "reset"
        ? `The reset couldn't finish. ${sentenceName} may be in a partial state — retry to run the reset again.`
        : `The recovery couldn't finish, so ${sentenceName} may still be unreachable. Your agents, files, and logins are safe.`;
  return (
    <ComputerLifecycleDialog
      actions={
        <>
          <button onClick={onDismiss} type="button">
            Dismiss
          </button>
          <button
            className={`primary ${kind === "reset" ? "destructive" : ""}`.trim()}
            disabled={!canRetry}
            onClick={onRetry}
            type="button"
          >
            {failureRetryLabels[kind]}
          </button>
        </>
      }
      className="computer-failure-dialog"
      description={description}
      onDismiss={onDismiss}
      open={open}
      title={failureTitles[kind]}
    />
  );
}

export interface ComputerRebuildDialogProps {
  open: boolean;
  kind: ComputerOperationKind;
  stage: ComputerOperationStage;
  migrationStatus?: ComputerMigrationStatus | null;
  migrationPhases?: readonly ComputerMigrationStatus[];
  pullPercent?: number | null;
  operationId?: string;
  computerName?: string;
  onContinueInBackground?: () => void;
}

const stepStateLabels: Record<ComputerLifecycleStepState, string> = {
  done: "completed",
  active: "in progress",
  pending: "not started",
};

export function ComputerRebuildDialog({
  open,
  kind,
  stage,
  migrationStatus,
  migrationPhases,
  pullPercent,
  operationId = "untracked",
  computerName = "OpenBot's Computer",
  onContinueInBackground,
}: ComputerRebuildDialogProps) {
  const result = getComputerRebuildProgress({
    kind,
    stage,
    migrationStatus,
    migrationPhases,
    pullPercent,
    computerName,
  });
  const progressRef = useRef({ key: `${kind}:${operationId}`, value: result.progress });
  const progressKey = `${kind}:${operationId}`;
  if (progressRef.current.key !== progressKey) {
    progressRef.current = { key: progressKey, value: result.progress };
  } else {
    progressRef.current.value = Math.max(progressRef.current.value, result.progress);
  }
  return (
    <DialogSurface
      actions={
        onContinueInBackground ? (
          <button className="primary" onClick={onContinueInBackground} type="button">
            Continue in Background
          </button>
        ) : undefined
      }
      className="computer-rebuild-dialog"
      open={open}
      title={`${operationTitles[kind]} ${computerName}`}
      width={520}
    >
      <div className="computer-rebuild-dialog-body" data-kind={kind} data-stage={stage}>
        <ComputerLifecycleStepList steps={result.steps} />
        <ComputerProgressBar value={progressRef.current.value} />
      </div>
    </DialogSurface>
  );
}

export interface ComputerRebuildBannerProps {
  kind: ComputerOperationKind;
  activeStep: string;
  progress: number;
  computerName?: string;
  onOpen: () => void;
}

export function ComputerRebuildBanner({
  kind,
  activeStep,
  progress,
  computerName = "OpenBot's Computer",
  onOpen,
}: ComputerRebuildBannerProps) {
  const value = Math.min(1, Math.max(0, progress));
  const circumference = 2 * Math.PI * 8.25;
  const completed = circumference * value;
  const title = `${operationTitles[kind]} ${computerName}`;
  return (
    <div className="computer-reconnect-banner-layer">
      <button
        aria-label={`View ${computerName} progress`}
        className="computer-progress-banner computer-rebuild-banner"
        onClick={onOpen}
        type="button"
      >
        <span
          aria-label="Progress"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(value * 100)}
          className="computer-progress-ring"
          role="progressbar"
        >
          <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 22 22" width="22">
            <circle cx="11" cy="11" r="8.25" strokeWidth="2.75" />
            <circle
              className="computer-progress-ring-fill"
              cx="11"
              cy="11"
              r="8.25"
              strokeDasharray={`${completed} ${circumference - completed}`}
              strokeLinecap="round"
              strokeWidth="2.75"
            />
          </svg>
        </span>
        <span>
          <strong>{title}</strong>
          <small>{activeStep}</small>
        </span>
      </button>
    </div>
  );
}

function ComputerLifecycleStepList({ steps }: { steps: readonly ComputerLifecycleStep[] }) {
  return (
    <ol aria-label="Computer rebuild progress" className="computer-lifecycle-step-list">
      {steps.map((step) => (
        <li
          aria-current={step.state === "active" ? "step" : undefined}
          data-state={step.state}
          key={step.label}
        >
          <span aria-hidden="true" className="computer-lifecycle-step-glyph">
            {step.state === "done" ? "✓" : ""}
          </span>
          <span>{step.label}</span>
          <span className="sr-only">, {stepStateLabels[step.state]}</span>
        </li>
      ))}
    </ol>
  );
}

function ComputerProgressBar({ value }: { value: number }) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div className="computer-lifecycle-progress">
      <span
        aria-label="Progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(clamped * 100)}
        className="computer-lifecycle-progress-track"
        role="progressbar"
      >
        <span style={{ width: `${clamped * 100}%` }} />
      </span>
      <span>{Math.round(clamped * 100)}%</span>
    </div>
  );
}

export interface ComputerTakingLongerDialogProps {
  open: boolean;
  kind: ComputerOperationKind;
  onContinueInBackground: () => void;
  onKeepWaiting: () => void;
}

const operationPhrases: Record<ComputerOperationKind, string> = {
  update: "The update is still running — a large image download can take a few minutes.",
  reset: "The reset is still running — rebuilding the Computer can take a few minutes.",
  recover: "The recovery is still running — recreating the Computer can take a few minutes.",
};

export function ComputerTakingLongerDialog({
  open,
  kind,
  onContinueInBackground,
  onKeepWaiting,
}: ComputerTakingLongerDialogProps) {
  return (
    <ComputerLifecycleDialog
      actions={
        <>
          <button onClick={onKeepWaiting} type="button">
            Keep waiting
          </button>
          <button className="primary" onClick={onContinueInBackground} type="button">
            Continue in Background
          </button>
        </>
      }
      className="computer-taking-longer-dialog"
      description={`${operationPhrases[kind]} You can keep waiting, or continue in the background.`}
      onDismiss={onKeepWaiting}
      open={open}
      title="Taking longer than expected"
    />
  );
}

const visibleMonitorLimit = 3;

export function ComputerMonitorStrip({
  monitors,
  activeMonitorId,
  onSelect,
}: ComputerMonitorStripProps) {
  if (monitors.length < 2) return null;
  const hasOverflow = monitors.length > visibleMonitorLimit + 1;
  const visible = hasOverflow ? monitors.slice(0, visibleMonitorLimit) : monitors;
  const overflow = hasOverflow ? monitors.slice(visibleMonitorLimit) : [];
  return (
    <div aria-label="Computer screens" className="computer-monitor-strip" role="group">
      {visible.map((monitor) => (
        <ComputerMonitorButton
          active={monitor.id === activeMonitorId}
          key={monitor.id}
          monitor={monitor}
          onSelect={onSelect}
        />
      ))}
      {overflow.length ? (
        <details className="computer-monitor-more">
          <summary aria-label={`Show ${overflow.length} more screens`}>
            <span className="computer-monitor-more-preview">⌑</span>
            <span>and {overflow.length} more</span>
          </summary>
          <div aria-label="More screens" role="menu">
            {overflow.map((monitor) => (
              <button key={monitor.id} onClick={() => onSelect(monitor.id)} role="menuitem">
                {monitor.title}
                {monitor.needsAttention ? <i aria-label="Needs attention" /> : null}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ComputerMonitorButton({
  monitor,
  active,
  onSelect,
}: {
  monitor: ComputerMonitor;
  active: boolean;
  onSelect: (monitorId: string) => void;
}) {
  const label = monitor.needsAttention
    ? `${monitor.title} — needs you`
    : `Switch to ${monitor.title}`;
  return (
    <button
      aria-current={active}
      aria-label={label}
      className="computer-monitor-thumb"
      onClick={() => onSelect(monitor.id)}
      title={label}
      type="button"
    >
      <span className="computer-monitor-preview">
        <iframe aria-hidden="true" src={monitor.previewUrl} tabIndex={-1} title="" />
        <span aria-hidden="true" />
      </span>
      <span className="computer-monitor-caption">
        {monitor.needsAttention ? <i aria-hidden="true" /> : null}
        <span>{monitor.title}</span>
      </span>
    </button>
  );
}
