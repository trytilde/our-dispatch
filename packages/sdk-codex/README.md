# @trytilde/sdk-codex

Maps Codex hook payloads to canonical Tilde ChatKit messages and tool-execution events.

## Public API

- `normalizeCodexHook(input)` converts a supported Codex hook payload to a harness-neutral event.
- `recordCodexHook(options)` records that event through `@trytilde/sdk` and ignores unsupported hooks.
- `codexPluginRoot()` returns the packaged Codex plugin directory for installers.
