---
name: tilde-skills
description: Create Tilde skills and skill registries, expose their progressive-discovery tools on an agent's MCP server, and inspect registries from the control plane.
---

# Skills over the Tilde control plane

Your `tilde_*` tools are team-scoped: never pass `org_id` or `team_id` arguments. A skill is a focused instruction document; a registry groups skills behind progressive discovery so an agent loads full instructions only when relevant.

## Create a registry

1. `tilde_create_skill` per document — lowercase hyphenated name, concise discovery description, complete Markdown content. Recover ids with `tilde_list_skills`.
2. `tilde_create_skill_registry` with a focused name, description, and `skill_ids`.
3. Change membership with `tilde_update_skill_registry` — it replaces the complete `skill_ids` array.
4. Verify with `tilde_list_skill_registries`.

A registry's private provider is created automatically and exposes `list_skills`, `search_skills`, `read_skill_description`, and `read_skill`.

## Expose discovery to an agent

Find the registry-bound provider with `tilde_search_enabled_capabilities`, map its four discovery functions with `tilde_set_mcp_server_tool_enabled`, and verify filtered by `mcp_server_instance_id`. Tell the runtime agent to search summaries first, read one description, and load a full skill only when relevant.

## Inspect from the control plane

`tilde_list_skill_summaries`, `tilde_search_skill_registry`, `tilde_read_skill_description`, `tilde_read_skill`.
