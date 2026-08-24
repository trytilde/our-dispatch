---
name: tilde-memory
description: Create and wire Tilde memory banks and wikis — provisioning, schema packs, continuous ingestion bindings, and exposing memory or wiki tools on an agent's MCP server.
---

# Memory over the Tilde control plane

Your `tilde_*` tools are team-scoped: never pass `org_id` or `team_id` arguments. A **memory bank** stores durable semantic memories (recall, retain, reflect, delete). A **wiki** stores structured Markdown pages, schemas, relationships, revisions, and assets.

## Memory banks

`tilde_list_memory_providers` → `tilde_create_memory_bank` (clear name and purpose) → save the id → verify with `tilde_get_memory_bank` and `tilde_check_memory_bank_health`. Banks are hosted through Hindsight and are paid per bank per month — confirm with the user before creating one.

## Wikis and schema packs

`tilde_create_wiki` (set `memory_bank_ids` for ingestion) → `tilde_list_wiki_schema_packs` → `tilde_apply_wiki_schema_pack` (`wiki_id`, `schema_pack_key`) → verify with `tilde_get_wiki`; `tilde_retry_wiki_provisioning` only after an errored attempt. `tilde_update_wiki` renames and replaces the complete memory-bank selection; an empty array detaches all banks.

## Continuous ingestion

`tilde_set_memory_source_bindings` replaces the complete bank selection for one source: `source_kind` (`chatkit_channel`, `chatkit_session`, `signal_provider`, `signal_delivery`, `skill_registry`, `skill`, `mcp_server`, `wiki`, `wiki_page`), `source_id`, `memory_bank_ids` (empty array detaches). Inspect with `tilde_list_memory_bank_sources`; `tilde_retry_memory_sync` after fixing a failed sync.

## Exposing tools

Creating a bank or wiki enables a private tool provider but does not expose functions on any MCP server. Find them with `tilde_search_enabled_capabilities`, select only what the agent needs (avoid destructive functions), and map each with `tilde_set_mcp_server_tool_enabled`. Treat the wiki as the source of truth for structured knowledge; retain only concise durable facts in banks.
