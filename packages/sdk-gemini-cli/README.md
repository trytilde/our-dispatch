# `@trytilde/sdk-gemini-cli`

Normalizes Gemini CLI command-hook payloads and records them as Tilde ChatKit sessions,
messages, and tool executions.

```ts
import { recordGeminiCliHook } from "@trytilde/sdk-gemini-cli";

await recordGeminiCliHook({ client, agentId, input: hookPayload });
```

Use `openbot plugin --cli gemini` to install the hooks, Tilde MCP servers, and skills.

## Public API

- `normalizeGeminiCliHook(input)` converts a supported Gemini CLI hook payload to a
  harness-neutral event.
- `recordGeminiCliHook(options)` records that event through `@trytilde/sdk` and ignores
  unsupported hooks.
