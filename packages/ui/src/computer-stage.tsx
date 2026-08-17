export interface ComputerStagePlaceholderProps {
  message: string;
  busy?: boolean;
  progressPercent?: number;
  onRetry?: () => void;
}

export function ComputerStagePlaceholder({
  message,
  busy = false,
  progressPercent,
  onRetry,
}: ComputerStagePlaceholderProps) {
  const progress =
    progressPercent === undefined ? undefined : Math.max(0, Math.min(100, progressPercent));
  return (
    <div className="computer-stage-placeholder">
      <span>{message}</span>
      {busy ? (
        <span className="computer-stage-progress">
          <span
            className={progress === undefined ? "indeterminate" : ""}
            style={progress === undefined ? undefined : { width: `${progress}%` }}
          />
        </span>
      ) : null}
      {progress === undefined ? null : <small>{Math.round(progress)}%</small>}
      {onRetry ? (
        <button className="computer-stage-retry" onClick={onRetry} type="button">
          Retry
        </button>
      ) : null}
    </div>
  );
}
