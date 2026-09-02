# ADR-0034: Durable background agent jobs

## Status

Accepted

## Decision

Tilde owns provider-neutral, durable child-job state, parent/child correlation,
idempotent dispatch and effect receipts, leases, terminal wakes, transcript and
artifact references, and owner authorization. OpenBot owns authored delegation
tools, inference policy, optional caller-selected child models, parallel fan-out,
and parent-side aggregation.

Every job is bound to one explicit parent agent and ChatKit session and names one
explicit child agent. Model selection is absent by default and is persisted only
when the caller or user supplies it. Delegate and steer operations carry stable
idempotency keys so deployment recovery cannot repeat a child launch or steering
effect. Completion, failure, and needs-input transitions create durable parent
wakes that can be collected after either service restarts.

Stopping and resuming mutate durable state; they do not depend on an in-memory
abort controller. A child transcript remains the canonical ChatKit transcript,
while the job stores its child session and message references plus durable
artifact references.

An explicit job model overrides the authored agent default only for that job.
Job budgets feed AgentRun accounting; cost-capped jobs fail closed when the
runtime has no configured model rates. Persisted artifacts contain opaque
attachment IDs, while `collectResult` resolves fresh authorized download URLs.

## Consequences

- OpenBot can launch independent children concurrently and continue its parent
  inference without blocking on each child.
- Horizontally scaled workers use database leases and one-winner claims.
- Recovery retries are safe only through recorded idempotency/effect receipts;
  providers must not be called outside that boundary.
- OpenBot may apply provider-specific time, token, and cost enforcement while
  Tilde persists and exposes the caller-selected hard budgets.
- The owner-facing Work surface lists active and recent children, opens durable
  results/artifacts, and supports steer, stop, and resume on web, Electron, and
  mobile through the shared client runtime.

## Updates

- 2026-09-01: Added the shared Work presentation and direct owner controls for
  durable background jobs.
