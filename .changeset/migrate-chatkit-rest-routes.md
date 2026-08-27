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
"@trytilde/api-client": minor
"@trytilde/sdk": minor
---

Migrate OpenBot to Tilde's regular ChatKit activity, agent, session, message, search, turn, and realtime-ticket REST routes while preserving the Mission Control WebSocket contract.

Migration:
- Replace `OpenBotClient.getBootstrap` with `OpenBotClient.getActivity`.
- Read the agent page from the activity response's `activity` field.
