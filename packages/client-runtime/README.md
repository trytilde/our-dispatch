# @tryopenbot/client-runtime

Framework-neutral client behavior shared by OpenBot web and Electron clients.

## Public API

- The package root exports the transport client, Zustand vanilla runtime, reducers, and all client contracts.
- `contracts/auth` owns the UI-visible owner session and authentication adapter contract.
- `contracts/sidebar` owns agents, sessions, pagination, and sorting.
- `contracts/agents` owns the durable background agent-setup start and status payloads.
- `contracts/messages` owns conversation messages and parts.
- `contracts/capability-approvals` validates tokenless, proposal-hash-bound approval cards and
  submits their exact Yes/No binding through the authenticated control-service boundary. Unknown
  proposal fields are stripped and the nested approval must bind to the same proposal identifier.
- `contracts/events` owns generic one-session SSE envelopes, participant lifecycle activity, and the closed ChatKit realtime event union.
- `contracts/workspace` owns aggregate bootstrap, conversation snapshot, turn-submission,
  and consolidated ChatKit search responses plus the durable event revision used to reconnect the
  team-wide observer.
- `chat/websocket` owns ChatKit realtime ticket use, the awaited `ready` snapshot barrier,
  success-only reconnect cursors, capped jittered backoff, ping, parsing, and abort.
- `contracts/installation` owns control-service health, public native-auth discovery, and the selected installation.
- `contracts/attachments` owns attachment metadata and upload handshakes.
- `contracts/queue` owns queued agent turns.
- `contracts/rooms` owns the dormant durable roster, role, invitation, and departure contract.
  Owner UI remains deferred until human identity discovery can replace raw user identifiers.
- `contracts/connectors` owns connector (Tilde tool-provider) configuration: the `configure_connector` tool's `connector_selection` payload, provider and account schemas, `connectorSetupFields` schema-to-form flattening, `connectorAuthorizedReturnUrl`, `waitForConnectorAccountActive` polling, and the structured hand-back message builders.
- `contracts/plugins`, `contracts/routines`, and `contracts/signals` own the client projections of
  native Tilde settings resources. Their transport uses the installation's operation-allowlisted
  `/api/tilde/*` credential bridge; the control service defines no parallel domain APIs. Plugin
  inventory is assembled from Tilde's generated MCP and Skills resource contracts, with every
  native continuation token exhausted rather than relying on an OpenBot-specific aggregate.
  `createTildePluginsClient` accepts `TildePluginsTransport`, resolves relative provider assets
  against the active Tilde origin, coalesces native and managed entries for one provider, and
  caches the assembled read catalogue briefly while invalidating it after mutations.
- `contracts/workspaces` and the workspace registry helpers own persisted public control-service
  origins, display metadata, and active-workspace selection without moving credentials between
  installations.
- `queuedTurnText` normalizes queued ChatKit request text, while runtime actions own
  run-now, reorder, removal, refresh, and error reconciliation for every client.
- `contracts/onboarding` plus `loadOnboarding`, `completeOnboarding`, and
  `resetOnboarding` own persisted first-run state through a platform-supplied storage port.
- `contracts/platform` owns the narrow Electron renderer bridge.

The runtime has no React, DOM, Electron, or Node dependency. Applications provide authentication, fetch, storage, lifecycle, and file capabilities at their platform boundary. Tilde remains authoritative for chat resources; these schemas validate only the resource subset consumed by OpenBot clients.

The runtime maintains one team-wide ChatKit realtime observer so inactive sessions keep their busy,
preview, per-user unread, queue, turn, and streamed-message state current. Platform-supplied `agentSetupPersistence` may
restore an in-progress setup job; the runtime polls it to readiness, refreshes the authoritative
sidebar, and selects the created agent only after it appears there.
The observer retains the last durable revision and resumes from it after a disconnect.
Agent, session, participant, read-state, message, queue, and turn events reduce directly from their
discriminated payloads; participant activity remains separate from messages, and no recursive payload
inspection or event-name substring matching is retained.

Initial load, conversation selection, and turn submission consume server-authored aggregate
responses. Web and Electron therefore reconcile identical authoritative snapshots without
issuing per-session fan-out reads after each user action or realtime event.

`searchChatKit` searches session titles, associated bots, and messages across the workspace, or
messages within one session. Runtime search actions discard stale responses and open results using
the same sidebar and conversation state as ordinary navigation.
