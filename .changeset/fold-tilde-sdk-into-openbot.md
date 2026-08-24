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
---

Move the Tilde TypeScript SDK into the OpenBot monorepo under the `@trytilde/sdk*` package names and add Tilde authentication, state, tunnel, plugin, and SDK workflows to `openbot`.

Migration:
- Replace `@trytilde/harness-sdk*` imports with the corresponding `@trytilde/sdk*` package.
- Replace `@trytilde/harness-plugins` and coding-agent wrapper binaries with `openbot plugin`.
- Replace `tilde auth|state|tunnel` with `openbot auth|state|tunnel`.
