---
name: grill-with-docs
description: Stress-test an OpenBot plan against its documented architecture, provider ownership, contracts, deployment model, and domain language. Ask one decision at a time and update durable documentation only as decisions become clear.
---

<what-to-do>

Interview the user about unresolved parts of the plan until dependencies, ownership, compatibility, security, and validation are clear. Ask one question at a time and provide a recommended answer.

If code or documentation can answer a question, inspect them instead of asking.

</what-to-do>

<supporting-info>

## Domain awareness

Read the smallest relevant set:

- `README.md`: product, setup, runtime, deployment, and ownership boundaries.
- `AGENTS.md`: coding and validation rules.
- `packages/control-service-proto/proto/openbot/control/v1/control.proto`: owner-facing control contract.
- `packages/computer-service-proto/proto/openbot/computer/v1/computer.proto`: internal computer contract.
- `packages/<domain>-provider/src/core.ts` or `packages/<domain>-provider/src/core/index.ts`: domain provider seams; the package root only re-exports them.
- Tilde-backed provider lifecycles: API-reconciled remote resources and persisted IDs.
- `PROVENANCE.md`: copied-source and clean-room constraints.

Read `CONTEXT.md` and relevant records under `docs/adrs/` when they exist. Create or update them only when a resolved, durable concept or decision needs a home.

## During the session

### Challenge ownership

Keep these distinctions explicit:

- OpenBot control state vs Tilde-owned agents, chats, tools, skills, and memory.
- Local/Vercel environment secrets vs future persisted control state vs sandbox files.
- Provider interface vs concrete adapter vs UI/client.
- Web app vs Electron shell vs computer-service sandbox API.
- Portable Tilde configuration vs runtime or one-time credentials.

Call out any plan that crosses one of these boundaries without a reason.

### Sharpen fuzzy language

Replace overloaded terms with the repository's concrete concepts. For example, distinguish OpenBot installation, Tilde organization/team, Tilde agent, ChatKit session, sandbox instance, provider adapter, and environment provider.

### Discuss concrete scenarios

Probe local development, Vercel production, fresh installation, upgrade, provider failure, cancellation, missing credentials, sandbox loss, and rollback where relevant.

### Cross-reference with code

Verify claims at the public entrypoint and owning implementation. Surface contradictions between the plan, protobuf, routes, provider contracts, state ownership, and deployment scripts. The reset application currently has no control database package; treat persistence as a new architecture decision if a UX/API requires it.

### Update documentation inline

Update existing authoritative files when the decision changes their contract. Keep `CONTEXT.md`, if created, as a glossary rather than an implementation plan. Use [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

When changing a decision already governed by an ADR, update the ADR's current
prose and append a timestamped bullet under `## Updates` as specified by
[ADR-FORMAT.md](./ADR-FORMAT.md). Preserve every earlier update entry.

### Guide major decisions into ADRs

Recommend an ADR for a major architecture, strongly opinionated code, or durable code/product design decision whose reasoning should survive the current change. Ask one decision question at a time, give a recommended answer, and write the record only after the user confirms the choice. Use [ADR-FORMAT.md](./ADR-FORMAT.md).

</supporting-info>
