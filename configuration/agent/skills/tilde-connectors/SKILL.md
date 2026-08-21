---
name: tilde-connectors
description: Configure a connector (Tilde tool provider such as Gmail, Slack, GitHub, or Stripe) for this bot end to end — discover the provider, let the user pick or add an account with the in-chat picker, then enable and map its tools onto this bot's MCP server.
---

# Configure connectors for this bot

A connector is a Tilde tool provider. Your `tilde_*` control-plane tools are team-scoped: never pass `org_id` or `team_id` arguments. Your own runtime MCP server instance id is in your instructions.

## Workflow

1. `SEARCH_TOOLS` first — the capability may already be mapped onto your server.
2. `tilde_search_enabled_capabilities` with `kinds: ["toolkit_provider_instance"]` — is a provider account already enabled for this team?
3. `tilde_search_available_capabilities` with `kinds: ["toolkit_provider"]` — does the provider exist in the catalog? Never guess `tool_group_source_type_id` or `credential_source_type_id`; take them from search results.
4. When the user must choose or add an account, call your direct `configure_connector` tool with the provider's `tool_group_source_type_id`. The client renders the picker from your tool result: give a one-sentence reason and stop your turn. Do not paste authorization links or request credential values in chat.
5. The user's selection arrives as their next message with `tool_group_source_type_id` and `tool_group_instance_id`.

## After the user selects an account

The user's selection message already carries `tool_group_source_type_id` and `tool_group_instance_id` — use them directly; do not re-derive them with more capability searches. One `tilde_search_enabled_capabilities` call (filtered by `tool_group_instance_id`) is enough to confirm the account is `active` and read the exact `tool_source_type_id` values; if the response carries `approval_url` / `next_tool_name`, follow that instruction and wait for `approved`.

Then batch the whole mutation into a SINGLE `MULTI_EXECUTE_TOOL` call whose `invocations` array carries, in order:

1. `tilde_set_toolkit_tool_enabled` for each required function (`tool_group_instance_id`, `tool_source_type_id`, `enabled: true`).
2. `tilde_set_mcp_server_tool_enabled` for each of those functions (`mcp_server_instance_id`, `tool_source_type_id`, `tool_group_source_type_id`, `tool_group_instance_id`, `enabled: true`).
3. One verification `tilde_search_enabled_capabilities` filtered by `mcp_server_instance_id`.

Enable only the functions the task needs, confirm the verification result, then continue the original task.

## Etiquette

- Enabling providers and adding accounts change the team's configuration: act on an explicit user request or picker selection; a choice made on the picker already came from the user, so proceed on it directly.
- Reads (search, status) never need permission.
- With several accounts on one provider, name the account you act through whenever it could matter; resolve ambiguity by showing the picker rather than assuming.
