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

Remove the paused Expo mobile client, Android/iOS tooling, EAS publication workflow, and `openbot mobile` command group from main. The complete implementation remains preserved on the `codex/mobile-archive` DO NOT MERGE branch.

Migration:
- Stop invoking `openbot mobile`, mobile root scripts, Metro/adb tunnels, or `mobile-v*` releases.
- Use the web workspace or Electron desktop client while the product foundation is stabilized.
