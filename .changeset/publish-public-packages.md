---
"@tryopenbot/agent-provider": minor
"@tryopenbot/agent-service-provider": minor
"openbot": minor
"@tryopenbot/computer-provider": minor
"@tryopenbot/computer-service": minor
"@tryopenbot/computer-service-proto": minor
"@tryopenbot/configuration": minor
"@tryopenbot/desktop": minor
"@tryopenbot/utilities": minor
"@tryopenbot/control-service-provider": minor
"@tryopenbot/runtime-provider": minor
"@tryopenbot/control-service": minor
"@tryopenbot/ui": minor
"@tryopenbot/web": minor
---

Publish all OpenBot workspace packages publicly with runnable JavaScript artifacts and declarations, and provide `openbot` as an installable standalone CLI.

Refresh selected AWS profile credentials through AWS CLI before SOPS operations so IAM Identity Center sessions work during initialization and later secret access.

Support AI agents and automation with non-interactive initialization through stable JSON answers on stdin and machine-readable JSON results.

Migration:

- Replace the internal package name `@tryopenbot/cli` with the public `openbot` package.
- Invoke the installed CLI with `openbot <command>` or `npx openbot <command>`.
