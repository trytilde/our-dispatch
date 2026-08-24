---
"@tryopenbot/agent-provider": patch
"@tryopenbot/agent-service-provider": patch
"@tryopenbot/auth-provider": patch
"openbot": patch
"@tryopenbot/computer-service-provider": patch
"@tryopenbot/client-runtime": patch
"@tryopenbot/computer-tools": patch
"@tryopenbot/computer-service": patch
"@tryopenbot/computer-service-proto": patch
"@tryopenbot/configuration": patch
"@tryopenbot/desktop": patch
"@tryopenbot/utilities": patch
"@tryopenbot/platform-integrations": patch
"@tryopenbot/control-service-provider": patch
"@tryopenbot/runtime-provider": patch
"@tryopenbot/control-service": patch
"@tryopenbot/ui": patch
"@tryopenbot/web": patch
"@tryopenbot/git-provider": patch
---

Keep newly created bots on the local-runtime tunnel until their complete agent template is ready, reconcile independent Tilde resources concurrently behind a shared request ceiling, and keep managed skill and tool assignments idempotent.
