# ADR-0033: Agent-owned context compaction

## In brief

- Every authored agent owns its context-compaction loop through AI SDK `prepareStep`.
- Tilde records lifecycle and memory evidence; it does not summarize for OpenBot.
- The default agent compacts near 80% of a configurable context window.
- A structured handoff precedes a complete recent user-turn tail.
- Provider preparation runs first and compaction preserves its non-context overrides.

## Context

OpenBot conversations are durable in Tilde, but model context is request-local.
Long sessions need a compact representation without deleting or rewriting the
canonical transcript. Provider-native compaction would couple authored agents to
one inference adapter, while moving the loop into Tilde would make ChatKit own
model behavior that belongs to the agent.

## Decision

The default OpenBot agent creates a request-scoped compaction controller and
composes it with any inference-provider `prepareStep`. Before a step, the
controller estimates the complete persisted context and triggers at 80% of
`OPENBOT_AGENT_CONTEXT_WINDOW_TOKENS` (128,000 by default).

Compaction uses the active model with tools disabled by omission, a structured
handoff prompt, up to three attempts, progressive input reduction, and a
4,096-token output ceiling. The replacement context is:

1. the generated checkpoint summary;
2. a chronological recent tail beginning at a user-message boundary.

The complete Tilde transcript remains unchanged. The agent reports start, end,
and failure through its ChatKit session client. A successful report includes the
exact summary and aligned message IDs when conversion preserved a one-to-one
mapping. Failure is reported and rethrown, leaving the original context and
transcript authoritative.

This follows the Vercel AI SDK context-management model documented in
[`prepareStep`](https://ai-sdk.dev/docs/agents/loop-control) and the
[context compaction guide](https://ai-sdk.dev/cookbook/guides/agent-context-compaction).

## Consequences

Agents may replace the default thresholds or controller entirely. Inference
providers may still prepare models, tools, cache keys, containers, and context;
the composed callback applies compaction to their prepared model/messages and
preserves the other returned fields.
