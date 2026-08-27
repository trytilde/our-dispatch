# @tryopenbot/client-runtime

Framework-neutral client behavior shared by OpenBot web, Electron, and Expo clients.

## Public API

- The package root exports the transport client, Zustand vanilla runtime, reducers, and all client contracts.
- `contracts/auth` owns the UI-visible owner session and authentication adapter contract.
- `contracts/sidebar` owns agents, sessions, pagination, and sorting.
- `contracts/agents` owns the durable background agent-setup start and status payloads.
- `contracts/messages` owns conversation messages and parts.
- `contracts/events` owns ChatKit SSE event envelopes.
- `contracts/mission-control` owns the aggregate ChatKit activity envelope, conversation snapshot, turn-submission,
  and consolidated ChatKit search responses plus the durable event revision used to reconnect the
  team-wide observer.
- `chat/websocket` owns Mission Control ticket use, the awaited `ready` snapshot barrier,
  success-only reconnect cursors, capped jittered backoff, ping, parsing, and abort.
- `contracts/installation` owns control-service health, public native-auth discovery, and the selected installation.
- `contracts/attachments` owns attachment metadata and upload handshakes.
- `contracts/queue` owns queued agent turns.
- `contracts/connectors` owns connector (Tilde tool-provider) configuration: the `configure_connector` tool's `connector_selection` payload, provider and account schemas, `connectorSetupFields` schema-to-form flattening, `connectorAuthorizedReturnUrl`, `waitForConnectorAccountActive` polling, and the structured hand-back message builders.
- `contracts/workspaces` and the workspace registry helpers own persisted public control-service
  origins, display metadata, and active-workspace selection without moving credentials between
  installations.
- `queuedTurnText` normalizes queued ChatKit request text, while runtime actions own
  run-now, reorder, removal, refresh, and error reconciliation for every client.
- `contracts/onboarding` plus `loadOnboarding`, `completeOnboarding`, and
  `resetOnboarding` own persisted first-run state through a platform-supplied storage port.
- `contracts/platform` owns the narrow Electron renderer bridge.

The runtime has no React, DOM, Electron, Expo, or Node dependency. Applications provide authentication, fetch, storage, lifecycle, and native file capabilities at their platform boundary. Tilde remains authoritative for chat resources; these schemas validate only the resource subset consumed by OpenBot clients.

The runtime maintains one team-wide Mission Control observer so inactive sessions keep their busy,
preview, unread, and streamed-message state current. Platform-supplied `agentSetupPersistence` may
restore an in-progress setup job; the runtime polls it to readiness, refreshes the authoritative
sidebar, and selects the created agent only after it appears there.
The observer retains the last durable revision and resumes from it after a disconnect.

Initial load consumes `GET /chatkit/activity`, while conversation selection and turn submission
consume server-authored aggregate responses. Web, Electron, and Expo therefore reconcile identical
authoritative snapshots without issuing per-session fan-out reads after each user action or realtime
event.

`searchChatKit` searches session titles, associated bots, and messages across the workspace, or
messages within one session. Runtime search actions discard stale responses and open results using
the same sidebar and conversation state as ordinary navigation.
