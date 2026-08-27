---
name: tilde-tools
description: Configure Tilde tools end to end with the control-plane tools — enable managed toolkit providers, connect proxied MCP servers, register custom HTTP tool backends, use reverse proxies, and map functions onto a runtime MCP server.
---

# Configure tools over the Tilde control plane

Your `tilde_*` tools are team-scoped: never pass `org_id` or `team_id` arguments. Do not confuse the control plane with your own runtime MCP server (its instance id is in your instructions).

## Recommended workflow

1. `tilde_search_available_capabilities` with a specific intent such as "GitHub pull request tools". Use `include_schemas: true` when you need provider or tool input details. Never guess provider or credential source ids.
2. Configure the source:
   - Managed provider: `tilde_enable_toolkit_provider` (`tool_group_source_type_id`, `credential_source_type_id`, `display_name`, an existing credential id only when the user supplied one). For user-facing account selection and credential entry, prefer the `configure_connector` picker (see the tilde-connectors skill).
   - Provider app Tilde should provision: `tilde_auto_provision_toolkit_provider` with the identifiers returned by search.
   - Existing Streamable HTTP MCP server: `tilde_connect_proxied_mcp_server` with its declared `auth_mode`; never put secrets in names, URLs, or descriptions. Call `tilde_refresh_proxied_mcp_server` after the upstream catalog changes.
   - Harness SDK `toolEndpoint` backend: `tilde_register_custom_tool_backend`, then `tilde_refresh_custom_tool_backend` after its manifest changes.
3. If a response contains `approval_url`, send it to the user, then immediately invoke the returned `next_tool_name` with `next_tool_arguments` and wait until it returns `approved`.
4. `tilde_search_enabled_capabilities` for the exact `tool_group_instance_id` and `tool_source_type_id` values.
5. Call `tilde_enable_and_bind_provider_tools` once with the required tool ids and every target `mcp_server_instance_id`. Use `all_tools: true` only when the task genuinely requires the provider's entire tool catalog.
6. Use `tilde_set_toolkit_tool_enabled` or `tilde_set_mcp_server_tool_enabled` only for a single-tool enable/disable or mapping adjustment; remove mappings with `tilde_remove_mcp_server_tool`.
7. Verify with `tilde_search_enabled_capabilities` filtered by `mcp_server_instance_id`.

## Reverse proxies

Reverse proxies let application code call a provider's native API while Tilde injects the credential. `tilde_list_reverse_proxies` finds profile ids and proxy base URLs; call `tilde_set_reverse_proxy_enabled` only to change live traffic.
