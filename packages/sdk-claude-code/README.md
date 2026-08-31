# @trytilde/sdk-claude-code

Maps Claude Code hook payloads to canonical Tilde ChatKit messages and tool-execution events.

## Public API

- `normalizeClaudeCodeHook(input)` converts a supported Claude Code hook payload to a harness-neutral event.
- `recordClaudeCodeHook(options)` records that event through `@trytilde/sdk` and ignores unsupported hooks.
