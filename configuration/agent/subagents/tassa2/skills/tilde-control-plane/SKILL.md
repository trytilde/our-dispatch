---
name: tilde-control-plane
description: Orientation to the Tilde control-plane tool families available on this bot's MCP server — identity, capability search, tool providers, MCP servers, ChatKit, signals, skills, memory, wallet, and state — and the ground rules for using them.
---

# The Tilde control plane

Every OpenBot agent's MCP server carries the team-scoped Tilde control-plane toolkit (`tilde_*`). Ground rules:

- Team-scoped: never pass `org_id` or `team_id` arguments; the workspace is inferred.
- Never guess identifiers (`tool_group_source_type_id`, `credential_source_type_id`, instance ids); take them from search results.
- When a response carries `approval_url` plus `next_tool_name`/`next_tool_arguments`, surface the URL to the user and immediately invoke the continuation tool; do not proceed until it returns `approved`.
- One-time secrets in responses (API keys, signing keys) go to the human for secure storage — never into chat history, source, or logs.
- Reads are free; mutations change the team's configuration and follow the user's explicit request.

## Tool families

- Identity: `tilde_whoami`, `tilde_generate_api_key`.
- Discovery: `tilde_search_available_capabilities` (installable), `tilde_search_enabled_capabilities` (configured); both accept `kinds` filters and `include_schemas`.
- Tool providers: `tilde_enable_toolkit_provider`, `tilde_auto_provision_toolkit_provider`, `tilde_set_toolkit_tool_enabled` — see the tilde-tools and tilde-connectors skills.
- MCP servers: `tilde_create_mcp_server`, `tilde_set_mcp_server_tool_enabled`, `tilde_remove_mcp_server_tool`; proxied servers via `tilde_connect_proxied_mcp_server` / `tilde_refresh_proxied_mcp_server`; custom backends via `tilde_register_custom_tool_backend` / `tilde_refresh_custom_tool_backend`.
- Reverse proxies: `tilde_list_reverse_proxies`, `tilde_set_reverse_proxy_enabled`.
- ChatKit and signals: see the tilde-chatkit skill.
- Skills: see the tilde-skills skill. Memory and wikis: see the tilde-memory skill. Portable state: see the tilde-state skill.

Enabling a tool on a provider (`tilde_set_toolkit_tool_enabled`) does not expose it to any agent; mapping it onto a runtime MCP server (`tilde_set_mcp_server_tool_enabled`) is the separate, second step.
