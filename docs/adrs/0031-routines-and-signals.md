# ADR-0031: Routines and signals as one unified trigger surface

## In brief

- One user concept: Routine. Name, instruction, 1–8 triggers.
- Trigger is schedule (Tilde ChatKit routine, UTC cron) or provider event (Tilde
  signal rule on a signal provider instance).
- One card can map to many Tilde resources. Grouping lives in Tilde `metadata`
  stamps, not in OpenBot storage.
- Control service projects owner routes `/api/routines/*` and `/api/signals/*`;
  never rides `/api/chat/*` (ADR-0014).
- Web renders an agent details pane; mobile is deferred.
- Self-hosted deviation: webhook URL and signing secret are user-visible.

## Decision

Tilde models scheduled runs (routines) and third-party webhooks (signals: provider
instances, rules, deliveries) as unrelated resources. OpenBot presents both as one
Routine with OR'd triggers because owners think "run this instruction when any of
these happen", not "manage two resource types".

### Grouping via Tilde metadata

Every Tilde resource OpenBot creates for a routine is stamped
`metadata.openbot = { group, trigger }` (signal rules additionally carry
`instruction`, since rules have no prompt field). Unified cards are reconstructed
statelessly from list calls; unstamped resources are invisible to the unified list.
This required an upstream `trytilde/api` change adding optional `metadata` to
`Routine` and `SignalRule`, chosen over an OpenBot-local mapping database (drift,
migrations) and over title-encoded markers (leak into session titles).

```mermaid
flowchart LR
    UI[Routine card] --> CS[control-service /api/routines]
    CS -->|schedule trigger| R[Tilde chatkit routine]
    CS -->|event trigger| SR[Tilde signal rule]
    SR --> SPI[signal provider instance]
    SPI --> WH[/api/v1/webhooks/... ingress/]
    R -->|cron fire| S1[new mission-control session]
    SR -->|delivery| S2[session via session_policy]
```

### Contracts and state

Wire shapes live in `packages/client-runtime` (`contracts/routines.ts`,
`contracts/signals.ts`) with the client methods and `routines`/`signals` store
slices, per ADR-0017. No Tilde event stream exists for these resources, so the
runtime polls while the details pane is open, stale-while-revalidate. Mutations
return the full refreshed routine list for the agent; clients replace wholesale and
never patch caches.

### Semantics

- Unified `enabled` is true when any member is enabled; toggling fans out to all
  members. Rule creation is force-enabled upstream, so a disabled create immediately
  patches the rule disabled.
- Routine updates are PATCH upstream; rule updates are full-replace, handled by
  read-modify-write. A rule's instance or signal type cannot change upstream, so
  such edits recreate the rule under the same trigger stamp.
- Tilde has no run-now endpoint: Test run creates a mission-control session titled
  with the routine name and sends the instruction — identical to the upstream
  scheduler's behavior.
- Tilde keeps no cron run log: run history merges signal deliveries (matched by
  rule ids) with the routine's `last_run_at`/`last_session_id`/`last_error`
  snapshot.
- One event trigger maps to exactly one signal rule and one signal type; filters are
  `filter.json_equals` equality on the provider's normalized payload.

### Unpaginated upstream signal lists

Tilde's signals list endpoints return a `next_page_token` that is always null, so
paging is impossible and the requested page size is a hard cap. Loading a partial
set is unsafe here: a routine would compose with a missing member, the replace-all
update would neither see nor delete it, and the enabled fan-out would skip it,
leaving an invisible rule firing while its card reads Paused. The control service
therefore requests 1000 and fails loudly with a 502 when a page fills, rather than
truncating silently. A team that legitimately exceeds 1000 signal rules will see the
routines surface error until upstream paginates; that is preferred over silently
corrupting routines on the next edit.

### Provider connections

Signal provider instances are managed inline from the trigger card and inventoried
at `/settings/signals`. OpenBot is self-hosted, so provisioning is user-visible: the
control service pre-assigns `spi_` ids to render the deterministic webhook URL, and
the signing secret is supplied by the owner, write-only, placed in
`configuration.provider_webhook_signing_key`. Providers are catalog-driven, not
hardcoded; providers upstream cannot auto-provision (Slack today) surface the
upstream error verbatim.

### UX deviations from the reference experience

Recorded deliberately: UTC-only schedules (Tilde cron has no timezone), no interval
frequency, a delete confirmation dialog, single-event triggers, and surfaced webhook
provisioning. The details pane toggle uses `mod+alt+d` because `mod+alt+b` was
already bound to the Computer pane.

## Cross-client parity

- Web and Electron: shipped (Electron renders the same web tree).
- Expo mobile: deferred.

<FOLLOW UP>
Owner: apps/mobile
Trigger: this routines and signals capability merges for the web and Electron clients
Work: render the routines list, editor, and provider connect flow natively against the existing client-runtime contracts, slices, and helpers using BNA UI components and React Native sheets, then prove the workflows on both Android and iOS
</FOLLOW UP>

## Upstream dependencies

- `trytilde/api`: optional `metadata` on `Routine`/`SignalRule`; serialized
  `webhook_verification` descriptor in the signals provider catalog. Until deployed,
  the control service falls back to a webhook-auth heuristic for
  `requires_signing_key`, and metadata stamps require the upstream field to persist.
- `@trytilde/api-client`: generated routines, signals, metadata, and webhook
  verification contracts. Stable hand-authored behavior remains owned by
  `@trytilde/sdk`; OpenBot does not reintroduce the retired Harness package names.
