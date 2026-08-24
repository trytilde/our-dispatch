---
name: tilde-chatkit
description: Register and wire Tilde ChatKit agents — endpoints, agent-to-agent messaging, ChatKit providers, and Signals that turn provider events into ChatKit messages.
---

# ChatKit over the Tilde control plane

Your `tilde_*` tools are team-scoped: never pass `org_id` or `team_id` arguments.

## Register an agent

`tilde_register_chatkit_agent` with `display_name`, `endpoint_url` (HTTPS in production, a path like `api/agent` with `local_running_endpoint: true` for Dev Tunnels), optional `concurrency_policy` (`queue`, `interrupt`, `queue_and_batch`), optional `memory_bank_ids`. The response returns the plaintext API key and webhook signing key once, plus `message_tool_provider_id`. Hand both secrets to the human for server-side storage; never print them into source, state, logs, or chat.

## Agent-to-agent messaging

1. Find the child agent's `chatkit_agent_message` provider (from registration or `tilde_search_enabled_capabilities`).
2. Map `chatkit_agent_message_send` and `chatkit_agent_message_wait_for_response` onto the parent's runtime MCP server with `tilde_set_mcp_server_tool_enabled`.
3. Call the exposed message tool with `message.parts`; pass `session_id` only to continue an existing child conversation. Immediately call the wait tool with the returned `ticket_id`, keep the request open, and treat the final `response` as the canonical persisted message. Terminal `status` is `completed`, `failed`, or `cancelled`.

## ChatKit providers

1. `tilde_search_available_capabilities` with `kinds: ["chatkit_provider"]`, `include_schemas: true`.
2. `tilde_configure_chatkit_provider` with `provider_id`, `display_name`, the registered agent inbox id, and provider-specific configuration.
3. Follow any returned approval URL plus continuation tool.
4. Verify with `tilde_search_enabled_capabilities` (`kinds: ["chatkit_channel", "chatkit_agent"]`).

## Signals

`tilde_list_signal_providers` → `tilde_create_signal_provider` → `tilde_create_signal_rule` (stable session key so related events continue one body of work) → `tilde_trigger_fake_signal` to test → `tilde_list_signal_deliveries` to inspect; `tilde_retry_signal_delivery` only for a failed delivery safe to repeat. List instances and rules before mutating with the update/delete variants.
