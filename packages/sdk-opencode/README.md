# `@trytilde/sdk-opencode`

Normalizes OpenCode plugin payloads and records them as Tilde ChatKit sessions, messages,
and tool executions.

```ts
import { recordOpenCodeHook } from "@trytilde/sdk-opencode";

await recordOpenCodeHook({ client, agentId, input: pluginPayload });
```

Use `openbot plugin --cli opencode` to install the fail-open OpenCode plugin, Tilde MCP
servers, and skills.

## Public API

- `normalizeOpenCodeHook(input)` converts a supported OpenCode plugin payload to a
  harness-neutral event.
- `recordOpenCodeHook(options)` records that event through `@trytilde/sdk` and ignores
  unsupported hooks.
- `opencodePluginPath()` returns the packaged global plugin file for installers.
