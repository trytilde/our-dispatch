# ADR 0038: Metadata is extension data

Status: Accepted

## In brief

- Metadata is limited to provider-specific facts that cannot be normalized and
  opaque client extensions that OpenBot/Tilde never interpret.
- OpenBot does not parse metadata for identity, authorization, audience,
  routing, lifecycle, retries, relationships, runs, jobs, compaction, models,
  budgets, or memory.
- Missing Tilde fields are fixed in the upstream DTO/OpenAPI and consumed after
  generated-client refresh; agent templates do not invent metadata protocols.
- Provider metadata is interpreted only by its concrete provider adapter. A
  value needed by core code, a renderer, or a second provider is promoted to a
  typed shared contract.

## Context

OpenBot historically accepted arbitrary ChatKit message metadata and provider
metadata. Recent runtime work parsed server-authored `tildeAgentRun` and
`tildeAgentJob` objects directly in the generated agent template, read queue
timestamps from metadata, and discriminated Signals through metadata. These
parsers were locally validated but made internal execution depend on magic
keys outside the generated Tilde contract.

## Decision

OpenBot follows Tilde API ADR 0022. Provider adapters may preserve upstream
facts such as GitHub pull-request identifiers and provider-native payload
fragments when those facts have no provider-neutral representation. Clients
may attach opaque extensions when OpenBot and Tilde only store and return them.

All OpenBot/Tilde-owned semantics use generated DTOs, shared client-runtime
contracts, provider core contracts, or another explicit typed interface.
Runtime validation around `unknown` or `Record<string, unknown>` is not an
acceptable substitute. Backwards compatibility or avoiding an upstream schema
change does not justify an internal metadata protocol.

## Consequences

- Existing internal metadata consumers are migration debt and should be
  replaced in security-first order.
- API and OpenBot changes that span repositories must pay the explicit contract
  and generated-client cost.
- PR and pre-commit skills require metadata classification and block internal
  semantics.
- Provider-specific and client-opaque extensibility remains supported.
