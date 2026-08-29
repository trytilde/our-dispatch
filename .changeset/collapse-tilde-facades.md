---
"@tryopenbot/agent-provider": minor
"@tryopenbot/agent-service-provider": minor
"@tryopenbot/auth-provider": minor
"openbot": minor
"@tryopenbot/computer-service-provider": minor
"@tryopenbot/client-runtime": minor
"@tryopenbot/computer-tools": minor
"@tryopenbot/computer-service": minor
"@tryopenbot/computer-service-proto": minor
"@tryopenbot/configuration": minor
"@tryopenbot/desktop": minor
"@tryopenbot/utilities": minor
"@tryopenbot/platform-integrations": minor
"@tryopenbot/control-service-provider": minor
"@tryopenbot/runtime-provider": minor
"@tryopenbot/control-service": minor
"@tryopenbot/ui": minor
"@tryopenbot/web": minor
"@tryopenbot/git-provider": minor
---

Use native Tilde plugin, connector, routine, and signal resources through one authenticated allowlisted bridge, and remove the corresponding control-service route APIs.

Plugin inventory now pages Tilde's native MCP, skill, provider, and registry collections directly; it no longer depends on Tilde's OpenBot-specific aggregate catalogue or its first-page limit.

Routines now consume Tilde's native trigger/version contract, and signal history uses native trigger IDs while accepting legacy rule IDs during the migration window. Signal provider and instance inventories follow every continuation token.

Development agent creation retains the completed source-generation result until asynchronous Tilde bundle provisioning becomes active, so queued provisioning no longer turns the next status poll into “job not found”.

The ChatKit credential bridge now permits only the workspace, queue, observation, and attachment operations used by Client Runtime instead of forwarding the complete ChatKit namespace.

Migration:
- Replace direct calls to `/api/plugins`, `/api/connectors`, `/api/routines`, and `/api/signals` with `@tryopenbot/client-runtime`.
- Replace `registerConnectorRoutes` with `registerConnectorAuthorizedRoute` when constructing a custom control service.
