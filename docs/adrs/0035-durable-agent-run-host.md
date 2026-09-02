# ADR-0035: Durable AgentRun host

## In brief

- Tilde owns durable runs, leases, steps, wakeups, budgets, and effect receipts.
- OpenBot owns model calls and hidden continuation policy.
- Three continuations without a tool call or measurable progress pause the run.
- Repeated tool/response patterns stall visibly instead of looping forever.
- Effect intent is written before execution; uncertain non-idempotent effects
  are never automatically repeated.

## Decision

The default Factory endpoint creates or recovers an idempotent run for the
latest ChatKit objective, reactivates paused/stalled work on a new human
message, claims a lease, and records the AI SDK turn and accounting. The
provider-neutral `runAgentObjective` host helper continues hidden turns across
invocation boundaries and persists a wake when the current function approaches
its time or continuation limit.

`executeRunEffect` hashes canonical tool input, persists intent, and passes a
stable idempotency key to the tool implementation. A committed receipt returns
the stored result after restart. A pre-existing planned receipt can be replayed
only when the tool declares provider idempotency; otherwise it is marked
uncertain and the run waits for explicit reconciliation.

Compacted history remains the model-input source, so continuation preserves the
stable provider cache prefix established by ADR-0033.
