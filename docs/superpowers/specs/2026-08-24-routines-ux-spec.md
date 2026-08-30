# Routines & Signals — UI/UX specification (web + Electron)

Companion to the design and wire-contract specs of the same date. This describes the
surfaces to build in `packages/ui` and wire in `apps/web`. Copy strings are normative.

## 1. Agent details pane

A right-hand side pane inside the workspace shell, beside the conversation. Not a
dialog, not a route change.

- Toggled from an icon button in the conversation header (`aria-label` "Toggle
  details") and keyboard shortcut `mod+alt+b`.
- Resizable via a drag handle (`aria-label` "Resize details"); collapses below
  ~244 px; remembers width locally (presentation-only state, stays in the component).
- Header: title "Details"; icon button "Close details".
- Content for v1: a single section headed **Routines** with a `+` icon button beside
  the heading (`aria-label` "Create Routine").
- The pane has levels: the overview (routines list) and a drill-in routine level.
  When a routine is open the header title becomes **Routine** and a back affordance
  reads **Back to Routines**.

## 2. Routines list

- A flush list (no table, no column headers): full-width button rows, two lines each,
  roomy density.
- Row line 1: routine name (primary color, truncated). Row line 2 (secondary color,
  truncated): the trigger sentences joined with " or " when enabled, or **Paused**
  when disabled.
- Leading 16 px icon: clock when enabled, muted pause-circle when disabled.
- Sort: enabled routines first, then disabled; otherwise server order.
- Empty state (only when settled-empty; never flashes mid-load):
  - "Routines are recurring tasks this agent runs on a schedule or when something
    happens in a connected tool."
  - Secondary button **Create Routine**.

## 3. Routine editor (create and edit are the same screen)

Pressing `+` opens a draft in the same drill-in level; nothing persists until a
commit fires with a non-empty trimmed name AND instruction. Every field autosaves on
blur; there is no Save or Cancel button. Failed saves show a banner at the top of the
body: **Couldn't save this routine.** (next blur retries; no retry button).

Sticky header row:

- Left: a toggle switch labeled **Active** (default on; disabled while the
  enable/disable request is in flight; optimistic flip, snaps back on failure).
- Right: **Delete** (secondary) then **Test run** (primary).
- **Test run** becomes **Running…** while a run is in flight and stays sticky until
  the refreshed list reflects it; clicking scrolls Run history into view. Disabled
  on drafts.
- **Delete** opens a confirmation dialog (deviation from the reference, matching the app's
  destructive-action voice): title `Delete "<name>"`, body "This permanently deletes
  the routine and stops all of its triggers. This can't be undone.", buttons Cancel /
  Delete. Failure copy: "Deleting failed. Check your connection and try again."

Body sections (small label-style headings, no cards):

1. **Name** — text input, placeholder "Name this routine", autofocused on drafts.
   Empty or unchanged on blur → silently revert.
2. **Instruction** — textarea, placeholder "What should this routine do each time it
   runs?". Same revert behavior.
3. **When to run** — the trigger card (§4).
4. **Run history** (§6).

## 4. Trigger card

- List of trigger rows (`aria-label` "Triggers"), each a button showing a leading
  glyph (clock for schedules; provider glyph for events) and a two-part sentence:
  a normal-weight lead and a muted rest. Examples:
  - lead "Every" / rest "day at 7:00 AM UTC"
  - lead "GitHub" / rest "PR opened in acme/web"
- Hover-revealed remove icon per row (`aria-label` "Remove trigger: <lead> <rest>").
  Removing the last trigger keeps the routine and reopens the add menu.
- Below rows: tertiary button with plus icon, labeled **Add trigger** when empty,
  **Add another** otherwise; hidden at 8 triggers.
- Add menu (popover, `aria-label` "Trigger source", min-width 240):
  1. **On a schedule** (clock icon) → submenu "Cadence":
     - **Every hour** → commits `0 * * * *` immediately.
     - **Every day** → time submenu (96 items, 15-minute grid, `12:00 AM`…`11:45 PM`,
       labeled UTC in the submenu header "Time (UTC)") → `m h * * *`.
     - **Weekdays** → same time submenu → `m h * * 1-5`.
     - **Every week**, **Every month**, **Advanced…** → add the trigger and open the
       trigger-fields editor preset to that mode.
  2. One item per connected-or-connectable signal provider from the catalog, with
     provider glyph: **GitHub event**, **Slack message**, **Sentry alert**,
     **Firecrawl monitor** (plus any other provider the catalog returns, generic
     glyph, label "<Name> event"). Selecting a provider whose instance is not yet
     connected opens the provider connect dialog (§5) first; on success the trigger
     draft opens.
- Clicking a trigger row opens the **trigger-fields editor**: an anchored popover
  over the row (`role="dialog"`, `aria-label` "Trigger fields", click-scrim,
  Escape commits-or-reverts and restores focus).

### 4.1 Schedule editor (inside the popover)

A **Frequency** select: Every hour / Every day / Weekdays / Every week / Every month /
Advanced / Custom. Inline connector words in secondary text make the row read as a
sentence. All times are UTC and every time control is suffixed "UTC".

- hourly → `at` + Minute select (5-minute grid, `:00`…`:55`).
- daily / weekdays → `at` + Time select (15-minute grid).
- weekly → `on` + Day-of-week select (Monday…Sunday) + `at` + Time.
- monthly → `on the` + Day-of-month select (`1st`…`31st`) + `at` + Time.
- Advanced → stacked labeled rows for Months (multi-select, "Any month" default),
  Days (Every day / Days of the week / Days of the month + multi-select), Time
  (single time in v1).
- Custom → bare text input (`aria-label` "Schedule"). Validated on blur with the
  shared `isValidTildeSchedule` helper (5-field cron, or 6/7-field with literal `0`
  seconds; no `@` macros, no timezone prefixes — Tilde evaluates in UTC). Invalid →
  `aria-invalid`, not committed, draft kept.
- Off-grid values coming back from the server are injected into the option lists so
  externally authored crons stay editable; anything unrepresentable lands in Custom.
- Deviations from the reference (record in ADR): no Interval mode; UTC only.

### 4.2 Event trigger editors (inside the popover)

One event trigger = one signal rule = exactly ONE signal type (deviation from
The reference's multi-event Git trigger becomes one event per trigger; "Add another" covers
multiple). Sentence-shaped rows: an event select plus provider-specific filter
inputs. Filters map to `filters: [{path, value}]` (exact-equality matching on the
provider's normalized payload).

- **GitHub** — event select (`aria-label` "GitHub event"), grouped:
  - Issue: Opened, Reopened, Closed, Edited, Labeled →
    `github.issue.{opened,reopened,closed,edited,labeled}`
  - Pull request: Opened, Reopened, Merged, Closed, Updated, Ready for review,
    Converted to draft → `github.pull_request.{opened,reopened,merged,closed,synchronized,ready_for_review,converted_to_draft}`
  - Checks: CI passed, CI failed → `github.ci_check.{passed,failed}`
  Then `in` + input `aria-label` "Repository", placeholder "owner/repo", validated
  `^[^\s/]+/[^\s/]+$` → filter path `repository.full_name`. For non-check events,
  optional `from` + input `aria-label` "User", placeholder "Anyone" → filter path
  `sender.login` (single username; leading `@` stripped).
- **Slack** — event select "Slack event": "Bot is mentioned" → `slack.app_mention`,
  "New messages" → `slack.message.posted`. Then `in` + input "Slack channel",
  placeholder "Channel ID", helper "The channel ID, like C0123456789" → filter path
  `event.channel`. Empty = any channel.
- **Sentry** — event select "Sentry event": Created / Assigned / Resolved /
  Unresolved / Archived → `sentry.issue.{created,assigned,resolved,unresolved,ignored}`.
  Optional `in project` + input "Project slug", placeholder "All projects" → filter
  path `data.project.slug`.
- **Firecrawl** — event select "Firecrawl event": Page changed / Page added /
  Page removed / Page unchanged / Page error / Check completed →
  `firecrawl.monitor.page.{changed,new,removed,same,error}` /
  `firecrawl.monitor.check.completed`. Optional `for monitor` + input "Monitor ID",
  placeholder "All monitors" → filter path `monitor.id`.
- Any other catalog provider gets a generic editor: signal-type select from the
  catalog's `signal_types` (labels from `name`), no filters.
- Instance selection: when the team has exactly one enabled instance for the
  provider, it is used implicitly; with several, a trailing `via` + instance select
  appears.

## 5. Provider connect dialog

Opened from the trigger card (unconnected provider) and from Settings → Signals →
"Connect provider". Modeled on the connector setup dialog interaction (ADR-0027).

Steps in one dialog:

1. Name — input "Connection name" prefilled with the provider name.
2. If the catalog says the provider requires a signing key
   (`webhook_verification.requires_signing_key`): a secret input labeled per
   `signing_key_description` (e.g. "GitHub webhook signing key"), helper "Stored
   encrypted. You choose this value and paste the same value into the provider."
3. The computed webhook URL in a read-only input with a copy button, shown BEFORE
   creation (the control service pre-assigns the instance id), plus the provider's
   `instructions` markdown rendered with `{{webhook_url}}` substituted.
4. Create → shows instance status. A **Send test event** button calls the test-fire
   endpoint and reports "Test delivered" / the upstream error.
5. Providers the upstream cannot auto-provision (currently Slack) surface the
   upstream error verbatim in the dialog with no retry loop.
6. Firecrawl (no signature verification): show the note "This provider does not sign
   requests. Treat the webhook URL as a secret."

## 6. Run history

Inside the routine editor. A list (`aria-label` "Run history"), newest first,
composed of:

- Signal deliveries for the routine's event triggers (per instance, filtered to the
  routine's rule ids via `matched_rule_ids`), and
- The schedule snapshot: one row from `last_run_at`/`last_error`/`last_session_id`
  when present (Tilde keeps no cron run log — deviation).

Row: left, a relative time, sentence-cased ("Just now", "5 min ago", "Today at
7:00 AM", "Mar 4 at 7:00 AM" — the shared relative-time helper; 12-hour clock,
locale-stable). Right: an icon only — spinner (`aria-label` "Running") for
pending/processing deliveries, check ("Succeeded") for completed, close ("Failed")
for failures — with the delivery `summary` or `error_message` as the row tooltip.
Rows with a session id are clickable and select that session in the sidebar.
Empty state: a tertiary-colored line, **No runs yet**.

## 7. Settings → Signals

New settings section "Signals" (`/settings/signals`), following the settings-app
section pattern:

- List of provider instances: provider glyph, display name, status badge
  (enabled/disabled), last error when present, webhook URL with copy button.
- Row actions (dropdown): Enable/Disable, Rotate signing key (secret input dialog),
  Send test event, View recent deliveries (expands the last 20: time, signal type,
  summary, status icon), Delete (confirm dialog: "This permanently deletes the
  connection. Routines with triggers on it will stop firing. This can't be undone.").
- Header action: **Connect provider** → provider picker → connect dialog (§5).

## 8. Component inventory

New in `packages/ui` (exported from the barrel): `switch.tsx` primitive
(shadcn-style), `agent-details-pane.tsx`, `routines-section.tsx` (list + empty
state), `routine-editor.tsx`, `trigger-card.tsx`, `schedule-editor.tsx`,
`event-trigger-editor.tsx`, `signal-provider-dialog.tsx`, `signals-settings.tsx`,
plus a small `relative-time.ts` helper (or reuse client-runtime's if placed there).
Presentation-only; all data via props/callbacks fed from the client-runtime store in
`apps/web` (ADR-0023). Status/error strings come from runtime state.

`apps/web` wiring: pane toggle state as a validated search param on `/` (so deep
links can open a routine: `details=routines`, `routine=<id|new>`), the settings
route + section entry, runtime action dispatch, and `startRoutinePolling` while the
pane is open.

## 9. Copy rules

User-facing noun is **routine** everywhere (never "automation", "cron job", or
"rule"); provider connections are **connections** in settings copy; the verb for
manual execution is **Test run**. Arming is **Active** (never "Enabled") in the
editor; the paused list state reads **Paused**.
