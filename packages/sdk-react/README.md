# @trytilde/sdk-react

React context and hooks for applications using `@trytilde/sdk` ChatKit clients.

## Public API

- `TildeProvider` creates one SDK client from `TildeProviderProps` and provides it to descendants.
- `useTildeClient()` returns the configured core SDK client.
- `useChatKit()` returns its ChatKit client.
- `useChatKitMessageHistory(options)` loads and refreshes paginated ChatKit message history.
- `useChatKitSessionEvents(options)` polls ChatKit session event history.

The hook option and result types are exported with their corresponding functions.
