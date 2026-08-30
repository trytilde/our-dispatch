# Routines & Signals — OpenBot wire contract

Companion to `2026-08-24-routines-signals-design.md`. This is the authoritative shape
for the owner routes served by `apps/control-service` and validated by
`packages/client-runtime` contracts. Wire casing is snake_case, matching existing
contracts. All routes require owner auth and return 503 when Tilde credentials are
missing (connectors pattern).

## Unified routine

A unified routine is reconstructed from Tilde resources stamped with
`metadata.openbot = { group: "<uuid>", trigger: "<uuid>" }`:

- schedule trigger ↔ ChatKit routine (`title` = name, `prompt` = instruction)
- event trigger ↔ signal rule (`display_name` = name)

Tilde resources without an `openbot.group` stamp are ignored by the unified list.

```jsonc
// Routine
{
  "id": "<group uuid>",
  "agent_id": "<agent inbox id>",
  "name": "Deploy watchdog",
  "instruction": "Check deploy health…",
  "enabled": true,                  // true when ANY member is enabled
  "triggers": [ /* Trigger */ ],
  "last_run_at": "…" | null,        // max over members (routine.last_run_at, delivery-derived for rules is omitted in v1)
  "last_session_id": "…" | null,
  "last_error": "…" | null,         // most recent member error
  "created_at": "…",                // earliest member
  "updated_at": "…"                 // latest member
}

// Trigger — discriminated on "kind"
{ "id": "<trigger uuid>", "kind": "schedule",
  "schedule": "0 7 * * *",
  "description": "Daily at 07:00 UTC",   // Tilde schedule_description, passthrough
  "next_run_at": "…" | null,
  "routine_id": "<tilde routine id>" }

{ "id": "<trigger uuid>", "kind": "event",
  "instance_id": "spi_…",
  "provider_type": "github",
  "signal_type": "github.pull_request.opened",
  "filters": [ { "path": "…", "value": <json> } ],   // filter.json_equals passthrough
  "rule_id": "<tilde rule id>" }
```

### Routes

- `GET /api/routines?agent_id=<id>` → `{ "items": Routine[] }`
  Lists all pages of Tilde routines + signal rules for the team, groups by
  `metadata.openbot.group`, filters to the agent (`agent_inbox_id` on routines,
  `action.agent_inbox_id` on rules). `agent_id` required.
- `POST /api/routines` body:
  ```jsonc
  { "agent_id": "…", "name": "…", "instruction": "…", "enabled": true?,
    "triggers": [ TriggerSpec, … ] }   // 1..8
  ```
  `TriggerSpec` = `{ "kind": "schedule", "schedule": "…" }` |
  `{ "kind": "event", "instance_id": "…", "signal_type": "…", "filters": []? }`.
  Creates members sequentially; on member failure, best-effort deletes members
  already created for the group, then returns the upstream error.
- `PATCH /api/routines/:groupId?agent_id=<id>` body (all optional):
  `{ "name"?, "instruction"?, "enabled"?, "triggers"?: (TriggerSpec & {"id"?})[] }`
  `triggers`, when present, is replace-all: entries with `id` update the existing
  member (kind may not change for an existing id), entries without `id` create,
  existing ids absent from the array delete. `name`/`instruction` propagate to every
  member. `enabled` fans out to every member (`enabled` on routines,
  `status` on rules).
- `DELETE /api/routines/:groupId?agent_id=<id>` — deletes all members →
  `{ "items": Routine[] }`.
- `POST /api/routines/:groupId/run?agent_id=<id>` — creates a chatkit-workspace
  session titled with the routine name and sends the instruction →
  `{ "session_id": "…" }`.

Mutations (`POST`, `PATCH`, `DELETE`) return the full refreshed
`{ "items": Routine[] }` for the agent (the reference's whole-array replacement model), so
clients never patch caches. `POST /run` is the exception (returns the session id;
client refreshes separately).

### Tilde mapping details

- Schedule member: `POST/PATCH /chatkit/routines` with
  `{ agent_inbox_id, title, prompt, schedule, enabled, metadata }`.
- Event member: `POST/PATCH /signals/rules` with `display_name` = name,
  `signal_type`, `filter: { json_equals: filters }`,
  `action: { type: "invoke_chatkit_agent", agent_inbox_id }`,
  `session_policy` resolved at create time from the provider catalog's signal type:
  `{ type: "session_key_template", namespace: "openbot",
     template: <default_session_key_template>,
     create_if_missing: true,
     title_template: <default_session_title_template ?? name> }`,
  falling back to `{ type: "new_session_per_delivery", title_template: name }` when
  the catalog has no default template. Rule updates are full-replace upstream — the
  control service read-modify-writes.
- Signal rule create forces status enabled upstream; when the unified routine is
  created disabled, the control service immediately PATCHes the rule to disabled.

## Signals (provider management)

```jsonc
// Provider (catalog projection)
{ "type_id": "github", "name": "GitHub", "documentation": "…",
  "instructions": "…markdown with {{webhook_url}}…",
  "auth_methods": ["webhook", …],
  "requires_signing_key": true, "signing_key_description": "…" | null,
  "route_path": "events",             // route_descriptors[0].path
  "signal_types": [ { "type_id": "github.pull_request.opened", "name": "…",
      "documentation": "…", "categories": [],
      "default_session_key_template": "…",
      "default_session_title_template": "…" | null } ],
  "credential_sources": [ { "type_id": "…", "name": "…",
      "requires_brokering": false, "display_name_description": "…" } ],
  "interpolation_variables": [ { "key": "…", "description": "…", "example": "…" } ] }

// Instance
{ "id": "spi_…", "display_name": "…", "provider_type": "github",
  "status": "enabled" | "disabled", "ingress_mode": "webhook" | "polling",
  "webhook_url": "https://…/api/v1/webhooks/github-signals-spi_…/events" | null,
  "poll_interval_seconds": 300 | null, "last_error": "…" | null,
  "created_at": "…", "updated_at": "…" }

// Delivery
{ "id": "…", "instance_id": "spi_…", "signal_type": "…", "summary": "…" | null,
  "status": "pending"|"processing"|"completed"|"failed_retryable"|"failed_terminal",
  "session_id": "…" | null, "error_message": "…" | null, "created_at": "…" }
```

### Routes

- `GET /api/signals/providers` → `{ "items": Provider[] }` (passthrough projection;
  the `fake` provider is included when upstream returns it).
- `GET /api/signals/instances` → `{ "items": Instance[] }` (all pages).
- `POST /api/signals/instances` body:
  `{ "provider_type", "display_name", "signing_secret"?, "credential_source_type_id"?,
     "configuration"?: object, "ingress_mode"?: "webhook" }`
  The control service pre-generates `id = "spi_" + uuid`, places `signing_secret`
  into `configuration.provider_webhook_signing_key` (the upstream extraction key),
  defaults `ingress_mode` to `"webhook"` and `credential_source_type_id` to the
  provider's first non-brokered credential source, and computes `webhook_url` from
  `TILDE_BASE_URL`, the provider type, the pre-generated id, and `route_path`.
- `PATCH /api/signals/instances/:id` body:
  `{ "display_name"?, "status"?, "signing_secret"?, "configuration"? }`
  Read-modify-write against the upstream full-replace body. A new `signing_secret`
  is written into `configuration.provider_webhook_signing_key` (rotation).
- `DELETE /api/signals/instances/:id` → `{ "deleted": true }`.
- `POST /api/signals/instances/:id/test` body
  `{ "signal_type"?, "summary"?, "data"? }` → `{ "accepted": n, "delivery_ids": [] }`.
- `GET /api/signals/deliveries?instance_id=<id>` → `{ "items": Delivery[] }`
  (first page, page_size 20, newest first — run-history display only).

Signing secrets are write-only; upstream redacts configuration values on read and the
control service never echoes `configuration` back to clients.

## Client-runtime surface

`contracts/routines.ts`: `RoutineSchema`, `RoutineTriggerSchema` (discriminated
union), `RoutineListSchema`, camelCase inputs `CreateRoutineInput`,
`UpdateRoutineInput`, `RoutineTriggerSpec`; helpers `describeEventTrigger(trigger,
providers)` and `scheduleTriggerSentence(trigger)` producing the reference lead/rest
sentence pairs, plus `SCHEDULE_PRESETS` (Every hour / Every day / Weekdays / Every
week / Every month) and `cronForPreset(...)` — all pure, shared web/Expo.

`contracts/signals.ts`: `SignalProviderSchema`, `SignalInstanceSchema`,
`SignalDeliverySchema`, inputs `CreateSignalInstanceInput`,
`UpdateSignalInstanceInput`, `TestSignalInstanceInput`.

`OpenBotClient` methods: `listRoutines(agentId)`, `createRoutine(input)`,
`updateRoutine(groupId, agentId, input)`, `deleteRoutine(groupId, agentId)`,
`runRoutine(groupId, agentId)`, `listSignalProviders()`, `listSignalInstances()`,
`createSignalInstance(input)`, `updateSignalInstance(id, input)`,
`deleteSignalInstance(id)`, `testSignalInstance(id, input?)`,
`listSignalDeliveries(instanceId)`.

Runtime state: `routines: { byAgentId, status, error, pollHandle }` and
`signals: { providers, instances, deliveriesByInstanceId, status, error }` slices;
actions `refreshRoutines(agentId)`, `createRoutine`, `updateRoutine`,
`deleteRoutine`, `runRoutine`, `startRoutinePolling(agentId)` /
`stopRoutinePolling()` (30 s via injected `schedule`), `refreshSignalProviders`,
`refreshSignalInstances`, `createSignalInstance`, `updateSignalInstance`,
`deleteSignalInstance`, `testSignalInstance`, `refreshSignalDeliveries(instanceId)`.
Stale-while-revalidate: refresh keeps previous items until the new page resolves.
