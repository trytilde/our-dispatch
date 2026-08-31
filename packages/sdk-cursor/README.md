# @trytilde/sdk-cursor

Maps Cursor Agent hook payloads to canonical Tilde ChatKit messages and tool-execution events.

## Public API

- `normalizeCursorHook(input)` converts a supported Cursor hook payload to a harness-neutral event.
- `recordCursorHook(options)` records that event through `@trytilde/sdk` and ignores unsupported hooks.
