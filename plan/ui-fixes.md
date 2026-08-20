# OpenBot fork fix queue

Working repository: `/root/our-openbot`, branch `fork/main`.
Rule from the user: **fix in the fork now, do not open upstream PRs until explicitly asked.**
Almost every item here is upstream-shaped work (it lives outside `configuration/`), so each entry
records what upstream package it will eventually target.

Status legend: `todo` / `in progress` / `done (fork)` / `upstreamed`.

---

## 1. Chat window does not scroll on overflow — `done (fork)`

Symptom: in the main chat window, when the transcript overflows the viewport it does not scroll.
Cause: `.chat-pane` is `display:grid; grid-template-rows: auto 1fr auto`, and a grid item defaults to
`min-height:auto`. The transcript row therefore grew to content height instead of clamping, so
`.conversation { overflow-y:auto }` never had a bounded box and `.workspace-shell { overflow:hidden }`
clipped the excess.
Fix: `packages/ui/src/openbot-ui.css` — `.chat-pane` gains `min-height:0` and
`grid-template-rows: auto minmax(0, 1fr) auto`; `.conversation` gains `min-height:0`. Applied to both
palette copies of the rule.
Upstream target: `@tryopenbot/ui`.

## 2. Agent images arrive as markdown instead of Tilde media references — `done (fork)`

Symptom: agents emit images as markdown; they should upload multimedia through the Tilde harness
SDK (S3) and return a media reference in the message format that the browser renders natively.
Scope: every snapshot/multimedia-producing tool must use the Tilde protocol, not inline markdown.
Reference sources to read: `/root/tilde-api`, `/root/harness-sdk`.
Upstream target: `packages/computer-tools`, agent templates in `configuration/templates/agent/` and
`cli/src/assets/agents/**`, possibly `@tryopenbot/client-runtime` contracts.

Findings so far:
- `createScreenshotTool` (`packages/computer-tools/src/index.ts:224`) returns
  `{ media_type: "image/png", data: <base64> }` straight to the model. The model then has no
  attachment to reference, so it re-emits the image as markdown.
- The browser already renders real attachments: `MessageContent`
  (`packages/ui/src/message-content.tsx:47`) collects `file` / `image` parts and resolves them via
  `resolveAttachmentUrl(sessionId, attachmentId)`.
- The web composer already speaks the three-step Tilde protocol in
  `apps/web/src/web-attachments.ts`: `createAttachment` → `PUT upload_url` (S3, presigned) →
  `completeAttachment`.
- The harness SDK exposes the same operations server-side: `createAttachmentUpload`,
  `uploadAttachmentContent`, `completeAttachmentUpload`, `getAttachmentDownloadUrl`
  (`/root/harness-sdk/packages/api-client/src/generated/sdk.gen.ts:1108+`). Only the download side
  is wrapped in `core/src/chatkit/index.ts` today.
- Inbound attachments are already handled by `createChatKitAttachmentFilePartHandler`
  (`/root/harness-sdk/packages/vercel-ai-node/src/chatkit-attachments.ts`); the outbound direction
  is the gap.

Design problem to settle before building: tools are constructed at module scope in
`configuration/agent/agent.ts` and know only their `agentId`; the ChatKit `sessionId` lives in the
per-request `context` inside `chatKitEndpoint({ handler })`. Uploading requires the session. Options:
1. `AsyncLocalStorage` set by the handler, read inside tool `execute` — no signature changes, but
   implicit context.
2. Explicit: tool factories take an `attachments` sink; the agent binds one per request.
3. Push the upload into the harness SDK (a `createChatKitAttachmentSink(client, context)` alongside
   the existing download handler), so every Tilde agent gets it, not just OpenBot.
**Decision (user, this session):** make the computer tools factory functions and construct the MCP
client inside `chatKitEndpoint`'s handler, passing `sessionId` through. That means dropping the
process-wide `mcpTools` memo in `configuration/agent/agent.ts` and paying an MCP handshake per turn;
if that cost bites, memoize per session with eviction rather than reintroducing a module-level
mutable session (which is racy across concurrent turns in one process).

All three upload operations are session-scoped — confirmed against both the generated client and the
API source (`/projects_1/tilde-api/crates/chatkit-router/src/attachment.rs:46`), where `session_id`
is a required `WrappedUuidV4` path param:

```
POST /api/v1/team/{team_id}/chatkit/session/{session_id}/attachment/upload
PUT  …/attachment/{attachment_id}/content        (debug-build fallback)
POST …/attachment/{attachment_id}/complete
```

`createAttachmentUpload` returns presigned object-store URLs; follow the URL it returns instead of
hardcoding either path. Auth is the agent's existing Tilde API key — no new credential.

### Shipped in the fork

- `packages/computer-tools/src/attachments.ts` (new): `createTildeMediaUploader` implements the
  three-step protocol — reserve (`POST …/attachment/upload`), `PUT` to whatever `upload_url` the
  reservation returns, then `POST …/complete`. It follows the returned URL rather than assuming
  object storage, and only attaches Tilde credentials when the upload URL is the API's own origin,
  never to a presigned object-store URL. SHA-256 and byte length are sent on both calls.
- `ComputerToolOptions` gains `uploadMedia`. `createScreenshotTool` returns
  `{ attachment_id, media_type, filename }` when an uploader is configured and falls back to base64
  when there is none, so tools still work outside a ChatKit session.
- `configuration/agent/tools/screenshot.ts` is now a factory taking the uploader.
  `configuration/agent/agent.ts` builds the tool set and the MCP client per turn from
  `context.sessionId`, and closes the MCP client in `onFinish`.

Remaining for this item: the browser renders `file` parts through `MessageContent`, but a tool
result carrying an attachment reference is still drawn by `ToolsBlock` as a tool result. Rendering
tool-result attachments inline is the last mile, and worth doing before upstreaming.

### `<FOLLOW UP>` blocks to carry into the eventual PRs

```text
<FOLLOW UP>
Owner: trytilde/api chatkit attachments
Trigger: when an agent-produced medium has no natural conversation to belong to (background job,
scheduled run, or a tool result reused across sessions)
Work: decide whether ChatKit attachment upload must stay session-scoped, or whether a team-scoped
upload plus a later session binding is the better protocol; every upload route today requires
session_id in its path, which forces a live session on every producer; acceptance proof is either a
documented decision that session scoping is intentional and permanent, or a team-scoped upload
endpoint with a binding step and round-trip coverage
</FOLLOW UP>
```

```text
<FOLLOW UP>
Owner: trytilde/harness-sdk vercel-ai-node MCP client
Trigger: when a local tool needs per-request context such as the ChatKit session id
Work: allow local tools to be registered or replaced after the initial MCP connect, so a process can
keep one memoized MCP client instead of re-handshaking per turn to swap a session-bound tool set;
today wrapMcpClientWithLocalTools binds tools at construction (packages/vercel-ai-node/src/mcp.ts:76);
acceptance proof is a single long-lived client whose local tool set can be swapped per request, with
a test showing two concurrent sessions receiving their own bound tools
</FOLLOW UP>
```

## 3. Sidebar resize, minimized state, and account menu — `done (fork)`

- Do not show the blue line on hover while resizing either sidebar.
- Left sidebar in minimized form: drop the search placeholder text, centre chat rows to icons only,
  hide the accompanying chat text.
- Animate hiding the search bar as the sidebar minimizes; when minimized do not render search at all.
Upstream target: `@tryopenbot/ui` (`sidebar-components.tsx`, `workspace-sidebar.tsx`, `openbot-ui.css`).
Fix:
- Dropped the `:hover` rule that painted `--accent` on `.sidebar-resize-handle::after` /
  `.workspace-resize-handle::after`. The line now appears only while `body.resizing-workspace`
  is set, i.e. during an actual drag.
- Added stable hooks: `.sidebar-search` on the search wrapper, `.sidebar-agent-row` /
  `.sidebar-agent-meta` / `.sidebar-agent-unread` on chat rows.
- `.sidebar-collapsed .sidebar-search` animates to `grid-template-rows: 0fr` with fading opacity,
  then goes `visibility:hidden; pointer-events:none` — search is gone from view and from the
  accessibility tree, and the collapse is animated rather than a snap.
- `.sidebar-collapsed .sidebar-agent-row` centres the avatar (`justify-content:center; gap:0;
  padding-inline:0`) and `.sidebar-agent-meta` / `.sidebar-agent-unread` are hidden.
Second pass (user follow-up), now Motion-driven rather than CSS-only:
- The search field is wrapped in `AnimatePresence`; collapsing animates height and opacity to zero
  and then **unmounts** it, so it is genuinely not rendered. The earlier `visibility:hidden` CSS was
  replaced.
- The agent list is a `motion.nav` with `layout`, so the rows glide upward into the freed space
  instead of jumping.
- Collapsed chat rows are 44×44 squares centred in the rail, and `GlideMenu` receives a square
  highlight (`left-1/2 w-11 -translate-x-1/2`) so the hover block is no longer a full-width bar.
- Collapsed rail gains `padding-inline: 14px` on the list and the account row.
- `WorkspaceAccount` takes `collapsed`: the "Your account" label animates out through
  `AnimatePresence`, and the avatar animates 28px → 36px to match the chat avatars (`size-9`).
- Account menu trimmed to `Log out` only — Settings, About, Help Center, and Send Feedback are gone,
  along with their icon paths and the now-unused separator import.
- `collapsed` is plumbed from `layout.sidebarCollapsed` (which is `compact`, so it also covers the
  automatic narrow-viewport collapse).

## 4. Computer panel: broken screen view and tab removal — `done (fork)`

- Clicking the computer icon (top right) fails with "can't reach Factory's screen".
- Remove the Computer and Activity tabs, and the tab strip itself.
- Render only the live feed as a thumbnail.
- Bottom right: maximize icon that takes the feed full screen.
- Top right: double right chevron that closes the panel.
Upstream target: `@tryopenbot/ui` (`agent-workspace-panel.tsx`, `openbot-ui.css`), `apps/web`
(`screens/openbot-app.tsx`), `packages/ui/stories/Computer.stories.tsx`.

Root cause of "Can't reach Factory's screen" (from `~/127.0.0.1.har`, 269 entries): the backend is
healthy. `GET /api/computer/factory/preview` answers `307` to
`http://127.0.0.1:6081/vnc.html?autoconnect=1&resize=remote&token=…`, and every noVNC asset then
loads `200` from WebSockify, ending in the `/websockify` upgrade. The panel's `onLoad` handler read
`iframe.contentDocument`, which **throws** because `:6081` is a different origin from the app on
`:58140`; the `catch` treated that throw as failure. So the preview was working and the UI reported
it as unreachable every time.

Fix:
- `onLoad`'s `catch` now sets `failed = false`: a cross-origin document is the ordinary success
  path, and only same-origin error payloads remain detectable.
- Removed the Computer/Activity tabs and the whole `workspace-tabs` header, plus its CSS.
- The pane now renders the live feed alone: `.agent-workspace-pane` is a single
  `grid-template-rows: minmax(0, 1fr)`.
- Floating controls: `.computer-collapse` (double chevron `»`, top right) closes the pane;
  `.computer-maximize` (bottom right) toggles full screen. Reload and "Drive it yourself" buttons
  are gone; the placeholder keeps its retry, and click-to-take-over still works through the shield.
- `AgentWorkspacePanel` lost its `activity` / `activityCount` props; the caller and the Storybook
  story were updated.

**Consequence to decide:** removing the Activity tab left the queued-turn controls (reorder, run
now, edit, remove) with no surface. `AgentActivity`, `mutateQueue`, `editQueuedTurn`, `eventSummary`,
and `humanEventName` were removed from `apps/web/src/screens/openbot-app.tsx`; `AgentActivity` still
exists in `@tryopenbot/ui` but nothing renders it. Queue state itself is still consumed for
`queuedMessageIds`. Ask the user where queue management should live before upstreaming.

## 5. Agent stays "working" after the response ends — `done (fork)`

Symptom: the header keeps showing the agent working with the seconds counter climbing, and the
composer keeps the Stop button, long after the reply finished.

Cause: `agentBusy` is set `true` on send (`state/runtime.ts:429`) and is only cleared by
`eventBusyState` (`chat/reducer.ts:120`), which never matched a real Tilde event:
- `eventName()` returns Tilde's underscore names (`message_streaming`), while the checks compared
  dotted names (`message.streaming`), so the "still streaming" branch never fired.
- Tilde has no `turn_completed` event at all — the enum is `message_created`, `message_updated`,
  `message_streaming`, `session_*`, `agent_turn_queued`/`dequeued`, `task_*`, `error`, `custom`
  (`/projects_1/tilde-api/crates/chatkit-core/src/event.rs:10`), so the `turn.completed` branch was
  dead too.
- The finish check used `findField(data, "type")`, which only descends `delta`/`ui`/`value`/
  `payload` — it cannot reach `data.kind.message_streaming.delta`, the nested production shape.
So every event returned `undefined` and the busy flag was never lowered.

Fix (`packages/client-runtime/src/chat/reducer.ts`): resolve the streaming payload exactly as the
reducer does (`eventKindPayload` for both nested spellings, else the flat `data`), then read
`payload.delta` for `finish`/`abort`/`error`; event names are normalised underscore → dot before the
remaining checks. Three tests added in `reducer.test.ts` (flat finish, nested finish, nested
text-delta stays busy); `pnpm --filter @tryopenbot/client-runtime test` → 17 passed.

Both reported symptoms share this one flag, so the Stop button clears with the spinner.

Note: this depends on a terminal `finish`/`abort`/`error` delta actually arriving. If a stream dies
without one, busy still sticks — a timeout or stream-close fallback would be the follow-up.

## 6. New agent, settings, and feedback placement — `done (fork)`

- "New agent" moved out of the sidebar into the chat header as an icon-only button (`PlusIcon`,
  `packages/ui/src/chat-components.tsx`), wired to the existing create-agent dialog.
- Sidebar gains a `SidebarUtilityRow` pair above the account row, shaped like a shadcn sidebar menu
  button (icon + label, one row, hover fill): **Settings** and **Send Feedback**. Both collapse to
  centred icons with the label animated out through Motion.
- Send Feedback is an anchor to `mailto:daniel@trytilde.ai` (overridable via the `feedbackEmail`
  prop) so it opens the owner's default mail client.
- Settings is a full-screen route, not a modal: `/settings` in `apps/web/src/router.tsx` rendering
  `screens/settings-app.tsx` — left nav with a single **General** entry (cog), a Back control, and an
  Appearance card wired to the existing `getThemePreference`/`setThemePreference`.
- Removed the horizontal divider above the account row.
- `motion` added to `apps/web` dependencies; per the user, motion.dev is the animation library for
  all app animations.

---

## 7. Rail metrics, colour, and typography — `done (fork)`

- Default sidebar width 400px (`SIDEBAR_DEFAULT`), maximum raised to 520 so it still resizes both
  ways; the drag and collapse e2e expectations moved with it.
- New `--rail-surface` token: grayer than the page in light mode (`#f4f4f4`), lighter in dark
  (`#202020`). Only `.rail` consumes it, so no other surface shifts.
- `--hover` and `--hover-2` lightened in both palettes.
- Vertical gap between chat rows and between footer rows increased to 4px.
- Bottom rows (Settings, Send Feedback, and the new-agent icon) all render in `--ink`, one colour,
  no muted variant.
- Collapsed rail: 52×52 avatar tiles, gutter padding cut from 14px to 9px, larger icons.
- Paper Mono vendored at `packages/ui/src/assets/fonts/paper-mono-variable.woff2` (SIL OFL 1.1,
  recorded in `THIRD_PARTY_NOTICES.md` with its licence file beside it) and wired through
  `--font-mono-face` / `--font-inter`, applied to `body`, inputs, buttons, and selects.
- `motion` added to `apps/web`; motion.dev drives every animation added in this pass.

## 8. Glide highlight behaviour — `done (fork)`

`packages/ui/src/beautiful-ui/atoms/glide-menu.tsx` rewritten on motion.dev:
- First hover lands in place and fades in; no vertical slide from the previous position.
- Row-to-row movement glides, slowed to 320ms.
- Leaving the column fades the highlight out.
- Hovering the selected row shows no highlight at all — it already carries its own fill.

## 9. Local diagnostics and workspace polish — `done (fork)`

Requested for the fork first, with upstream-shaped ownership recorded here:

- Log agent endpoint failures with the authored agent, request path, status, elapsed time, and full
  error stack in the local service log, including failures raised while streaming a response.
- Add one redacted trace id across the Computer iframe, control preview route, Computer provider,
  and computer-service desktop allocation/capability path. Never log the VNC capability token or
  a query string containing it.
- Replace Paper Mono throughout the shared web/Electron workspace. The later recovered-app review
  superseded the interim DM Sans choice: use its native system stack (SF Pro on Apple platforms,
  Segoe UI on Windows) without redistributing proprietary font files; retain a system monospace
  stack only for explicitly monospaced content. Expo remains on its native design system.
- Let the main transcript and message rows use the full available chat width so user messages can
  justify to the right edge.
- Keep an agent's cached `last_message_preview` visible while its selected conversation loads.
- Disable layout interpolation during continuous sidebar resizing while retaining the deliberate
  collapsed/expanded rail animation.
- Render New agent, Settings, and Send Feedback at 24px in the collapsed rail.

Implemented at the owning boundaries: agent-service handler/stream observation, a redacted
`openbot-vnc` trace spanning browser → control service → provider → computer service, shared UI
typography/layout, and web conversation reconciliation. The trace id is returned as
`x-openbot-vnc-trace-id`; logs expose only endpoint origin/path and never the capability query.

Cross-client decision: the shared DOM UI changes apply to web and Electron. Expo is deliberately
unchanged because its native UI does not consume `@tryopenbot/ui` or the DOM workspace layout.

Local validation was started before the operator changed the standing workflow: focused package
tests and typechecks passed. The focused workspace browser run reached the new cached-preview
scenario (5 passed, 1 skipped) and exposed one ambiguous text locator, which was scoped afterward.
Per the operator's instruction, no further tests or checks were run; the next requested validation
must cover all changes made since that instruction.

Upstream targets: `@tryopenbot/agent-service-provider`, `@tryopenbot/control-service`,
`@tryopenbot/computer-service-provider`, `@tryopenbot/computer-service`, `@tryopenbot/ui`, and
`@tryopenbot/web`.

## 10. Pill composer, steering, and native media — `done (fork)`

- Adapt the vendored Beautiful UI pill prompt bar verbatim at the visual/interaction level, while
  keeping only OpenBot's real controls: plus, autosizing textarea, stop, and send. No microphone,
  source browser, command menu, demo shader, or model selector. Plus opens the existing photo/file
  upload flow; attachments render as removable pills.
- Preserve the existing Tilde queue contract when sending during an active turn, but present queued
  messages directly above the composer as a compact steering stack. Keep reorder, edit, remove,
  and explicit `steer` actions backed by the existing client-runtime methods.
- Rework ChatKit file parts into native rich media: full-width single images, compact multi-image
  galleries, inline video/audio controls, document cards, fullscreen image/video previews, loading
  feedback, signed-URL refresh, and explicit unavailable/retry states. The recovered app informed
  the state model and interaction density; no recovered class names or renderer code were copied.
- Match the recovered app's typography metrics: native system sans, 13px base, 18px line height,
  antialiasing. Its macOS face is SF Pro, which is proprietary rather than open source; OpenBot
  references the installed system face and ships no font binary.
- Set the rail to `#F7F7F7` in light mode and `#111111` in dark mode. Set the profile avatar fill to
  `#8D6E62` and raise the initial from 12px to 13px without changing the circle dimensions.
- Follow-up: make the plus control open the Beautiful-style popover instead of opening the picker
  directly; its only supported item remains **Add photos & files**.
- Follow-up: send and stop are one morphing action in the same slot. During an active turn, Enter
  submits the current draft to Mission Control's queue while the visible button remains Stop.
- Queue root cause: Mission Control holds the first message POST open for the whole agent turn, but
  both the web screen and client runtime rejected every later submit while that request was marked
  `submitting`. The runtime now marks the agent busy when the request starts, releases the
  short-lived submit lock immediately, and clears busy when that long request resolves. This lets a
  later Enter reach the same Mission Control message endpoint, where Tilde creates the pending turn.
- Diagnostics follow-up: every local authored-agent request now logs received/completed/cancelled,
  not only exceptions, and the ChatKit proxy logs safe upstream 5xx status/detail without request
  bodies, credentials, or query strings.

Cross-client decision: web and Electron share these DOM components. Expo attachment rendering and
composer presentation are deferred because they are separate native components; no wire contract
changed in this pass.

No tests or checks were run for this section by operator instruction. The next requested local
validation must cover this section and every change made after that instruction.

## 11. Client workspace selector — `done (fork)`

- Removed the active-drag accent rule entirely. Sidebar and Computer resize handles now remain
  visually transparent during hover and drag; only the column-resize cursor remains.
- Added **Switch workspace** directly below **Send Feedback** in the sidebar utility group.
- Added a versioned `client-runtime` workspace registry persisted under `openbot.workspaces.v1`.
  Each entry owns a control origin, client-shell origin, derived label, stable avatar colour, and
  creation timestamp. No token, cookie, API key, or other credential enters this registry.
- The selector uses the command-menu footprint without search: profile-style coloured avatars,
  control origins, compact gray Remove badges, and a final gray plus row.
- The add state replaces the list with one large control-server URL input, Back and Join. Join shows
  a loading state, validates public health and native auth discovery, then verifies or initiates the
  platform auth handshake. A failed connection is never persisted.
- Selecting another hosted workspace transfers only public registry metadata in the URL fragment
  and reloads that installation's full shell. The destination validates itself before a pending join
  becomes durable. Local Vite keeps the 4173 client shell associated with the 4100 control origin.
- Removing the active workspace immediately replaces the application with the centered selector.
  The empty state uses the same selector and a fixed, non-drifting constellation of bot avatars.
- A saved workspace is now the web entry point and skips the old first-run agent onboarding. Expired
  authentication gets a small workspace sign-in surface rather than replaying onboarding.
- Simplified the no-active-workspace entry point after visual review: no leading icon, explanatory
  subtext, divider, shaded card, or oversized URL field. It now renders a flat labelled join form
  with a trailing chevron, omits Back when there is nothing to return to, and surrounds the form
  with fixed bot avatars rather than generic utility glyphs on cards.

Cross-client decision: the framework-neutral registry and discovery behavior are reusable by all
clients; web and hosted Electron renderer presentation ship here. Expo keeps its existing native
single-installation screen until the same multi-workspace list is expressed in BNA UI. Dynamic
multi-origin switching in packaged Electron remains blocked by its main-process single-origin proxy
and credential owner; the selector reports that limitation rather than moving tokens into renderer
storage.

No tests or checks were run by operator instruction. The next requested validation must include
workspace persistence, join failure, auth resume, active removal, cross-origin transfer, light/dark
appearance, and the sidebar drag with no visible rule.

## 12. Inline streaming indicator — `done (fork)`

- Removed the rich-chat streaming indicator's inherited horizontal `auto` margin, which centred its
  wide status block and made it appear more indented than assistant messages.
- The indicator now uses the same assistant-row width cap, starts at the transcript edge, and keeps
  only vertical separation from the preceding message.

No tests or checks were run by operator instruction. Include active-turn streaming alignment in the
next requested validation batch.

## 13. Queue-authoritative chat loop — `done (fork)`

- Every composer submission now uses Mission Control's queue-producing message endpoint. The client
  no longer selects a separate dispatch path based on its locally inferred busy state.
- Queue snapshots refresh immediately and again after short propagation delays, independently of
  the long-lived send request, so pending turns render while the active turn is still running.
- Remove, reorder, and steer now update client-runtime state optimistically and reconcile with the
  durable queue afterward; failures restore the prior snapshot.
- Late replies are ordered causally using Tilde's `in_reply_to_message_id`, keeping each response
  beside the prompt that triggered it instead of sorting a delayed response beneath newer prompts.
- The authored agent and future-agent template trim live session history to the queued request's
  enqueue-time message cutoff, preventing an old queued turn from seeing prompts submitted later.
- Vite development startup always seeds and activates its loopback control server in the persisted
  client workspace registry, allowing dev mode to bypass a missing local workspace entry.

No tests or checks were run by operator instruction. The next requested validation batch must cover
rapid multi-submit queue visibility, remove/reorder/steer rollback, causal late-response rendering,
queued history cutoff, and automatic local workspace seeding.

## 14. Branded access loading state — `done (fork)`

- Replaced the web and Electron access-check shimmer with the blue onboarding bot in its busy state,
  including the existing animated gold orbit ribbons and the same restrained status label.
- Kept the visual implementation in `packages/ui` so browser and Electron render the same loading
  treatment rather than maintaining app-specific copies.

<FOLLOW UP>
Owner: apps/mobile
Trigger: when the Expo client adopts the illustrated OpenBot avatar
Work: render the native blue OpenBot avatar and gold busy orbit for full-screen access and bootstrap loading states; do not import the React DOM packages/ui component
</FOLLOW UP>

No tests or checks were run by operator instruction. Include light and dark access-check rendering,
reduced-motion behavior, and accessible status announcement in the next requested validation batch.

## 15. Composer stop glyph and floating errors — `done (fork)`

- Made the stop control's inner square participate in layout so the black circular button visibly
  contains its contrasting square instead of rendering as an empty disc.
- Removed control-server and other runtime errors from the prompt bar's internal flow. Errors now
  render as compact, accessible floating pill cards directly above the composer without resizing it.
- Applied the prompt treatment to the shared React DOM UI, covering web and Electron. Expo keeps its
  native inline-error treatment because it does not use the pill prompt bar.

No tests or checks were run by operator instruction. Include the busy stop control plus short, long,
light-mode, and dark-mode error pills in the next requested validation batch.

## 16. Screenshot media and enforced ChatKit queueing — `done (fork)`

- Converts successful `screenshot` tool attachment results directly into the transcript's native
  image-preview segment and deduplicates any matching ChatKit file part. Screenshot attachment JSON
  no longer appears in the tool trace.
- Makes `queue` an explicit desired-state property of every Tilde agent. Development and production
  reconciliation now creates new agents with the queue policy and repairs existing agents that drift.
- Keeps Mission Control message submission as the only ChatKit queue producer and extends the
  bounded queue refresh tail to cover slower persistence and SSE propagation.

<FOLLOW UP>
Owner: apps/mobile
Trigger: when Expo renders tool-produced ChatKit attachments in its conversation transcript
Work: map successful screenshot tool attachment results to the native image preview and suppress the attachment-reference JSON, matching the shared web and Electron behavior
</FOLLOW UP>

No tests or checks were run by operator instruction. The next requested validation batch must cover
screenshot-only tool output, duplicate file-part suppression, queue policy create/update idempotency,
and rapid multi-send queue visibility while the first response is streaming.

## 17. Named client workspaces — `done (fork)`

- Changed the add-workspace surface to a compact two-field form: workspace name first, then control
  server URL. Both values are required before Join becomes available.
- Persists the user-supplied name in the existing framework-neutral workspace registry and updates
  the saved name when the same control server is joined again.
- Carries the name through cross-origin handoff and authentication resume, while keeping hostname
  fallback compatibility for the automatic development workspace and older pending joins.
- Workspace selection rows now render the saved name without exposing the control server URL.

Cross-client decision: this ships in the shared React DOM selector used by web and Electron. Expo's
native installation picker remains unchanged because it does not consume the browser/Electron
multi-workspace registry UI.

No tests or checks were run by operator instruction. Include named join persistence, auth resume,
cross-origin transfer, duplicate-origin rename, and name-only selector rows in the next requested
validation batch.

## 18. Attachment-native transcript media — `done (fork)`

- Fixed the remaining screenshot/image JSON leak: UI parts whose wire type is `image` now use the
  same native attachment renderer as `file` parts instead of falling through to the JSON fallback.
- Generalized tool-result promotion from the specifically named `screenshot` tool to any completed
  tool output carrying a ChatKit `attachment_id`. Images, video, audio, and documents therefore
  render from their attachment metadata without exposing the transport object in the transcript.
- Kept the existing inline native treatment for each media kind and made Preview available from its
  caption. Image and video previews use the full-screen dark media viewer; audio and documents use
  the full modal file viewer.
- Added a download control to both viewer variants, beside the close/open controls, using the
  attachment's resolved signed URL and filename.

<FOLLOW UP>
Owner: apps/mobile
Trigger: when Expo renders ChatKit tool-result attachments in its native transcript
Work: promote any attachment-shaped tool result to native image, video, audio, or document UI; add a native full-screen preview and platform download/share action without exposing attachment JSON
</FOLLOW UP>

No tests or checks were run by operator instruction. Include image-typed wire parts, generic
attachment-producing tools, duplicate suppression, every media kind, unavailable URLs, modal
keyboard dismissal, and download controls in the next requested validation batch.

## Investigation log

- **HAR (67 entries, 2026-08-20)**: no failed HTTP requests. The chat error is a persisted signal,
  `"ChatKit HTTP agent returned 500 Internal Server Error"`, 47 occurrences, session `04d14df5…`.
- **Which endpoint Tilde calls**: the live agent record shows
  `endpoint_url: https://daniel-54b4f7b9bdaa.trytilde-sb.com/api/agents/pirate-poet` with
  `local_running_endpoint: true`, updated 07:56Z by the running `pnpm dev`. Tilde was calling the
  **local-runtime tunnel**, not `our-ob-agents.vercel.app`. `dev.ts:215` returns the tunnel origin
  and `agent-lifecycle.ts:78` registers it. The 500 therefore came from the local dev process; its
  stack is in the `pnpm dev` terminal and `~/.openbot/logs/*.log`, not in Vercel.
- Vercel was checked and is healthy: routes answer `401 Missing x-tilde-webhook-id header`, and all
  89 project env vars including the full `AGENT_PIRATE_POET_*` set are present. Not the culprit.
- **Fresh local logs (10:19–10:30Z)**: the active restarted control service logged no authored-agent
  failure for the newly reported 500; only aborted response streams were present. Because the old
  failure-only wrapper could not prove whether a request arrived, received/completed lifecycle logs
  were added. On the next trigger, absence of `request received` isolates the failure to tunnel/Tilde
  delivery; presence followed by failure isolates it to the authored handler or stream.
- **Prod Tilde defect**, unrelated to the chat: `/ecs/tilde-api-prod` logs
  `common provider recovery reconciliation failed … Decryption failed: aead::Error` for
  `credential_id cad11206-2a68-4639-baf5-39d350902897` every ~60s. Filed as
  <https://github.com/trytilde/api/issues/143>.
- Prod also logged `timed out waiting for Mission Control agent response` for `factory` at 08:14Z —
  same tunnel, same cause family.

## Verification

- `pnpm check` → 0 errors, 24 pre-existing warnings across 347 files.
- `pnpm build` → passed, including `verify:packages` and `verify:cli`.
- `pnpm --filter @tryopenbot/client-runtime test` → 17 passed (3 new busy-state cases).
- `pnpm --filter openbot test` → 117 passed. `@tryopenbot/ui` → 4 passed.
- `pnpm test:e2e` → 6 passed, 1 skipped. Specs updated for the new UX: 400px rail, 460px after drag,
  52×52 collapsed tiles, search unmounted while collapsed, account menu down to `Log out`, and the
  Activity-tab assertions removed.
- Not done: real browser evidence (screenshots) for the new settings route and collapsed rail.

## Working notes

- Fork branch `fork/main` = upstream `d4a8aca` + fork configuration + tracked `configuration/.env`
  and `configuration/secrets.enc.yaml`.
- This file lives in `plan/`, which `.gitignore:1` ignores; it is force-added so the queue travels
  with the fork while scratch files in that directory stay untracked.
- Nothing here has been upstreamed. Each item records its upstream target for when that starts.
- Fork commits carrying this work: `5e5fd27` (scroll, resize, computer pane) and `4366747` (rail
  controls, settings route, Paper Mono, busy-state fix, Tilde media uploads).
