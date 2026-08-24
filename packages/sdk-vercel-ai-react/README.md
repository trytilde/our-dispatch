# @trytilde/sdk-vercel-ai-react

React helpers that connect `@trytilde/sdk-react` applications to Tilde's Vercel AI SDK ChatKit
transport.

## Public API

The package re-exports `TildeProvider`, `useTildeClient`, `useChatKit`,
`useChatKitMessageHistory`, and `useChatKitSessionEvents` from `@trytilde/sdk-react`.

`useChatKitVercelUiEndpoint(options)` returns the Vercel UI endpoint for a ChatKit session, inbox,
and instance. `UseChatKitVercelUiEndpointOptions` carries those IDs and an optional streaming flag.
