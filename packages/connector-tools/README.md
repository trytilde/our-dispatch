# @tryopenbot/connector-tools

Vercel AI SDK tools for in-chat connector (Tilde tool-provider) configuration.
Authored agents import these tools directly without depending on a deployment
provider package.

## Public API

- `createConfigureConnectorTool(options)` — a local agent tool that lists a
  provider's enabled Tilde accounts and emits a `connector_selection` payload
  the clients render as an account-picker card. The tool result tells the
  model the card is in the chat and to end its turn; the owner's selection
  returns as an ordinary user message.

`ConnectorToolOptions` supplies the Tilde API key, org, and team (directly or
as lazy resolvers) plus an optional base URL and fetch implementation.
