# ADR-0004: Narrow domain provider packages

## In brief

- Providers serve control APIs, initialization/provisioning, and build/deploy lifecycles.
- Tilde conversation data is consumed through its native REST/SSE API.
- One agent provider reconciles the complete external footprint of each authored agent.
- Authored agents import SDKs directly, never provider packages.
- Remove unused provider methods. No universal provider SDK.

## Context

OpenBot originally grouped chat data, external resource provisioning, model selection, prompt injection, tools, skills, and Computer operations behind broad provider contracts. That made providers look like a generic agent plugin system and forced authored agents through abstractions designed for OpenBot's control plane.

The web and desktop need access to Tilde-owned conversation state without duplicating Tilde's contract. Startup and deployment need typed external-resource lifecycles. Authored agents need freedom to use whichever SDKs and services fit their job.

## Decision

A provider operation is valid only when it is consumed by one of these boundaries:

- control service data or mutation handling for the web or desktop;
- initialization questions or startup provisioning;
- external resource reconciliation required before services start;
- `check`, `build`, `plan`, `configure`, or `deploy` lifecycles.

Provider contracts live in `src/core.ts` or `src/core/` in the owning domain package. Adapters live beside them. Contracts contain only operations used by those boundaries; speculative and convenience methods are removed.

Tilde owns conversation-facing agent, session, message, attachment, queue, and streaming contracts. OpenBot does not project those operations through a Chat Provider or control RPC. The browser uses an allowlisted same-origin REST/SSE bridge that preserves Tilde's request and response shapes while the server supplies team credentials.

`agent-provider` exposes one idempotent deployment lifecycle for the complete external footprint of an authored agent. Its Tilde adapter owns endpoint lookup, creation, repair, status reconciliation, authored-skill synchronization, exact skill-registry membership, dynamic MCP reconciliation, Tilde control-plane tools, and deployment-platform MCP integrations. These are cohesive internal reconcilers, not separately configurable Skills or Tools Providers. The CLI schedules the aggregate lifecycle once per agent and never contains vendor CRUD.

The old model-facing inference-model provider is removed. A narrow `inference-provider` may own initialization and external credential provisioning, but it exposes no model factory and authored agents still import AI SDK providers directly.

Code under `configuration/agent/`, including its `subagents/`, must not import provider packages or `configuration/index.ts`. Agents instantiate model clients, MCP clients, skill clients, Composio, and other SDKs directly. Defaults for future agents live in `configuration/templates/agent/`; existing agents change only through explicit edits.

The standard typed Computer AI tools are a reusable runtime utility in `@tryopenbot/computer-tools`, separate from `computer-provider`. They call the capability-protected Computer service. `computer-provider` retains only provisioning and lifecycle methods in its public contract, while concrete adapters may use internal Computer operations to implement those lifecycles.

Shared vendor plumbing used across domains belongs in `platform-integrations`. Multiple adapters share one concrete platform instance so initialization runs once. Domain mapping and error translation remain in each adapter.

```mermaid
flowchart LR
  UI["Web and desktop"] --> CS["Control REST and SSE bridge"]
  CS --> CHAT["Tilde ChatKit API"]
  START["Init, dev, and deploy"] --> AP["Agent provider"]
  AP --> RES["Agent, skills, tools, and MCP resources"]
  START --> LP["Build and deploy providers"]
  AG["Authored agent"] --> SDK["Direct vendor SDKs"]
  AG --> CT["Computer tools"]
  CT --> SVC["Computer service"]
```

## Consequences

- Control-plane abstractions stay small and testable.
- Agent developers are not blocked by generic provider contracts.
- Adding an agent integration usually changes agent code and its template, not provider interfaces.
- Shared vendor initialization remains deduplicated without coupling domain providers.
- Removing a provider operation is expected when no allowed consumer remains.
- Skills and tools cannot be selected independently from the Tilde agent lifecycle.

## Updates

- 2026-08-14T15:36:00+02:00: Added a provisioning-only inference-provider boundary for Vercel AI Gateway credentials while preserving direct AI SDK imports in authored agents.
- 2026-08-13T11:12:53+02:00: Removed universal provider packages plus default descriptor, health, verification, and selector-factory requirements in favor of explicit domain interfaces and composition.
- 2026-08-13T12:09:51+02:00: Removed the unused legacy `contracts` package after control and computer callers moved to their domain service protos.
- 2026-08-13T12:53:05+02:00: Folded every `*-provider-core` package into its owning provider package while preserving a visible core contract boundary.
- 2026-08-13T13:17:11+02:00: Renamed `computer-providers` to singular `computer-provider`.
- 2026-08-14T10:28:18+02:00: Split chat operations from agent provisioning, removed inference and model-facing provider hooks, moved Computer AI tools to a non-provider package, and prohibited provider imports from authored agents.
- 2026-08-14T10:55:00+02:00: Replaced public agent-resource CRUD with an idempotent `Deployable`; the Tilde adapter now discovers desired agents, reconciles Vercel AI SDK endpoints for development and production, and clears an endpoint before removing a stale managed agent.
- 2026-08-14T18:40:00+02:00: Removed the Tilde state file from OpenBot's normal lifecycle. Tilde providers now reconcile agents, authored skills, exact registries, dynamic MCP servers, the Tilde control-plane toolkit, and deployment-platform MCP integrations directly through typed APIs. Operators may still use the Tilde CLI manually for one-time team-to-team state migration.
- 2026-08-16T15:08:39+02:00: Removed Chat, Skills, and Tools Provider packages. Tilde conversation traffic now retains its native REST/SSE contract, while one Agent Provider lifecycle reconciles each authored agent and all of its external skills, tools, and MCP resources.
