# Routines & Signals — Design

Date: 2026-08-24
Status: Approved (user), implementation in progress

## Summary

OpenBot gains one user-facing concept, **Routines**: per-agent cards with a name, an
instruction, and 1–8 OR'd **triggers**. A trigger is either a **schedule** (backed by a
Tilde ChatKit routine — a UTC cron job) or a **provider event** (backed by a Tilde signal
rule on a signal provider instance). The UX follows the recovered reference implementation
routines experience with deliberate, recorded deviations. Signal provider connections
(webhook URL + signing secret) get an OpenBot-owned setup flow, since a self-hosted
deployment cannot hide provisioning behind a managed dashboard.

## Decisions (user-approved)

1. **Unified triggers**: one Routines surface; schedule triggers map to Tilde routines,
   event triggers map to Tilde signal rules. Mixed-trigger routines span both APIs.
2. **Placement**: a new resizable agent-details right pane in the workspace shell,
   containing the Routines section with drill-in editor (reference structure).
3. **Provider setup**: inline connect state on the trigger card opening a setup dialog,
   plus a `/settings/signals` inventory of provider instances.
4. **Mobile**: deferred with `<FOLLOW UP>`; contracts and runtime state land in
   `client-runtime` so Expo only needs screens later.
5. **Grouping**: a new optional `metadata: Object` field on Tilde `Routine` and
   `SignalRule` (upstream `trytilde/api` change). OpenBot stamps
   `{"openbot": {"group": "<uuid>", "trigger": "<uuid>"}}` and reconstructs unified
   cards statelessly from list calls. No local DB, no title markers.
6. **Tilde SDK abstractions** (added requirement): the SDK's unprocessed-message
   handling must expose a correctly typed shape for every signal provider and signal
   event (e.g. `github.issue.opened`), so agents receive signal-originated messages as
   first-class typed inputs rather than opaque system messages.

## Phases

### Phase 0 — `trytilde/api`

- Migration + serde: optional `metadata` JSON column/field on `chatkit` routines and
  `signals` rules; accepted on create/update, returned on read, no semantics server-side.
- Regenerate `openapi.cloud.json`.

### Phase 1 — Tilde SDK packages in `trytilde/dispatch`

- Refresh the generated `packages/api-client` from the new spec so routines and
  metadata remain typed, and expose stable hand-authored behavior from `packages/sdk`.
- Add typed signal-message support to the unprocessed-message path: a discriminated
  union keyed by `signal_type` covering every published provider event
  (github.issue.*, github.pull_request.*, github.ci_check.*, slack.app_mention,
  slack.message.posted, sentry.issue.*, firecrawl.monitor.page.*), carrying the
  signals metadata (`signal_delivery_id`, `signal_provider_instance_id`,
  `signal_rule_id`, `signal_type`) and normalized payload. Exact shape follows the
  SDK's existing unprocessed-message conventions (explored before implementation).
- Keep generated source internal to `@trytilde/api-client`; do not restore retired
  Harness package names or a separately pinned SDK repository.

### Phase 2 — OpenBot backend (`apps/control-service`)

New `src/routines.ts` and `src/signals.ts`, modeled on `src/connectors.ts`
(env-driven options, `tildeJson` helper, `requireOwner`, registration in `app.ts`),
per ADR-0014 (non-chat Tilde resources are projected owner routes, never `/api/chat/*`).

Routes:

- `GET /api/routines?agent_id=` — list Tilde routines + signal rules, group by
  metadata, compose unified DTOs (name, instruction, enabled, triggers with
  server-rendered descriptions, last-run info).
- `POST /api/routines` — create; sequential fan-out with best-effort rollback of
  already-created members on failure.
- `PATCH /api/routines/:groupId` — diff triggers (create/update/delete members),
  propagate name/instruction to every member, fan out enabled/status.
- `DELETE /api/routines/:groupId` — delete all members.
- `POST /api/routines/:groupId/run` — "Test run": create a chatkit-workspace session
  titled with the routine name, send the instruction (Tilde has no run-now endpoint;
  this is exactly what its scheduler does).
- `GET /api/signals/providers` — provider catalog projection.
- `GET|POST|PATCH|DELETE /api/signals/instances[/:id]`,
  `POST /api/signals/instances/:id/test`, `GET /api/signals/deliveries?instance_id=`.
- The control service computes each instance's webhook URL
  (`{base}/api/v1/webhooks/{provider}-signals-{spi_id}/{route}`) and pre-assigns
  `spi_` ids so the URL renders before creation. Signing secrets are write-only.

### Phase 3 — `packages/client-runtime`

- Contract groups `contracts/routines.ts`, `contracts/signals.ts` (Zod, passthrough,
  paged, colocated tests) following `contracts/connectors.ts`.
- `OpenBotClient` methods; `routines` and `signalProviders` slices + actions in
  `state/runtime.ts`; polling refresh while the pane is open via the injectable
  `schedule`/`cancelScheduled`; stale-while-revalidate so lists never flash empty.

### Phase 4 — `packages/ui` + `apps/web`

Agent details pane (toggle in agent header, `mod+alt+b`) with the Routines section:

- **List**: roomy flush list, two-line rows (name / trigger description or "Paused"),
  icon-only status (clock / spinner / muted pause-circle), empty state copy
  "Routines are recurring tasks this agent runs on a schedule." + "Create Routine".
- **Editor** (drill-in, "Back to Routines"): sticky header with **Active** switch,
  **Delete**, **Test run**; autosave-on-blur sections **Name** ("Name this routine"),
  **Instruction** ("What should this routine do each time it runs?"), **When to run**,
  **Run history**. Error banner: "Couldn't save this routine.".
- **Trigger card**: sentence-shaped rows (lead + muted rest), hover-remove,
  "Add trigger"/"Add another" popover: "On a schedule" (Every hour / Every day /
  Weekdays with 15-minute time grid / Every week / Every month / Advanced… / Custom
  cron) and provider events for GitHub, Slack, Sentry, Firecrawl. Listener editors are
  sentence-shaped popovers driven by each provider's published `signal_types`;
  field filters map to `filter.json_equals`.
- **Provider connect**: unconnected provider shows a connect state; setup dialog
  shows instructions markdown, webhook URL with copy, signing-secret field, test-fire
  (ADR-0027 interaction pattern). `/settings/signals` lists instances (status, rotate
  secret, disable, delete, recent deliveries).
- New `switch.tsx` primitive in `packages/ui`.

### Testing / validation

- Contract tests (client-runtime), route tests with mocked fetch (control-service —
  grouping/diff/rollback is the risk center), runtime slice tests, `pnpm check`,
  `pnpm build`. Playwright e2e happy-path if feasible.

## Deliberate deviations from the reference (record in ADR)

1. **UTC schedules** — Tilde cron is UTC-only; time pickers labeled UTC; description
   strings server-rendered. Custom cron accepts only Tilde-valid expressions (5-field,
   or 6/7-field with `0` seconds; no `@every`, no `CRON_TZ`).
2. **Interval frequency dropped** — Tilde cannot express arbitrary intervals; hourly
   and `*/N` minute patterns cover real cases.
3. **Delete confirmation added** — the reference deleted routines without confirmation.
4. **Run history** — signal deliveries (real, per rule) merged with the routine's
   `last_run_at`/`last_session_id`/`last_error` snapshot; Tilde keeps no cron run log.
5. **Provider setup surfaced** — webhook URL + secret shown; the reference hid linking
   behind a managed dashboard.
6. **Provider set** — GitHub, Slack, Sentry, Firecrawl (Tilde's supported providers),
   not the reference's Teams/Linear/PagerDuty set.

## Error handling

Missing Tilde env → 503 (existing connectors pattern). Upstream failures mapped like
`ConnectorUpstreamError` (5xx collapsed to 502). Partial create failure → best-effort
rollback + editor error banner; next blur retries implicitly.
