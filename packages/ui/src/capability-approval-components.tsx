import { useEffect, useRef, useState } from "react";
import type { CapabilityChangeApproval } from "@tryopenbot/client-runtime";

export interface CapabilityApprovalCardProps {
  approval: CapabilityChangeApproval;
  loadCurrent?: () => Promise<CapabilityChangeApproval>;
  onDecision?: (decision: "approve" | "reject") => Promise<CapabilityChangeApproval>;
}

/** Render a server-authored capability change with exact human Yes/No actions. */
export function CapabilityApprovalCard({
  approval,
  loadCurrent,
  onDecision,
}: CapabilityApprovalCardProps) {
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<"approve" | "reject">();
  const [error, setError] = useState("");
  const [currentStatus, setCurrentStatus] = useState(approval.status);
  const loadCurrentRef = useRef(loadCurrent);
  const pending = currentStatus === "pending" && !answered;

  useEffect(() => {
    loadCurrentRef.current = loadCurrent;
  }, [loadCurrent]);

  useEffect(() => {
    if (!loadCurrentRef.current || currentStatus !== "pending") return;
    let active = true;
    void loadCurrentRef
      .current()
      .then((current) => {
        if (active) setCurrentStatus(current.status);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [approval.id, currentStatus]);

  const decide = async (decision: "approve" | "reject"): Promise<void> => {
    if (!onDecision || busy) return;
    setBusy(true);
    setError("");
    try {
      const current = await onDecision(decision);
      setCurrentStatus(current.status);
      setAnswered(decision);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="capability-approval-card" aria-label="Capability change approval">
      <div className="capability-approval-copy">
        <small>{approval.category.replaceAll("_", " ")}</small>
        <strong>{approval.title}</strong>
        <p>{approval.rationale}</p>
        <dl>
          <div>
            <dt>Cost</dt>
            <dd>{approval.preview.cost_summary}</dd>
          </div>
          <div>
            <dt>Security</dt>
            <dd>{approval.preview.security_summary}</dd>
          </div>
          <div>
            <dt>Undo</dt>
            <dd>{approval.preview.rollback_plan}</dd>
          </div>
        </dl>
        {error ? (
          <p className="capability-approval-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="capability-approval-actions">
        {pending ? (
          <>
            <button
              disabled={busy || !onDecision}
              onClick={() => void decide("reject")}
              type="button"
            >
              No
            </button>
            <button
              className="primary"
              disabled={busy || !onDecision}
              onClick={() => void decide("approve")}
              type="button"
            >
              Yes
            </button>
          </>
        ) : (
          <span>
            {answered === "approve" || ["approved", "executing", "executed"].includes(currentStatus)
              ? "Approved"
              : "Declined"}
          </span>
        )}
      </div>
    </section>
  );
}
