---
name: tilde-state
description: Export and import portable Tilde workspace state (tilde.state.yaml) — validate, plan, apply with approval, and capture one-time generated outputs.
---

# Portable Tilde state

Your `tilde_*` tools are team-scoped: never pass `org_id` or `team_id` arguments. State reproduces agents, ChatKit providers, tools, MCP servers, skills, wikis, memory bindings, reverse proxies, and relationships. It never contains API keys, signing keys, provider credentials, conversation history, or memory content.

## Export

`tilde_export_state` with `format: "yaml"`; write the returned `state` string unchanged to `tilde.state.yaml` beside the agent source and commit it.

## Import

1. Read the complete state file as text.
2. `tilde_validate_state` with `state`, `format: "yaml"`, and any declared string `variables`. Stop if invalid.
3. `tilde_plan_state_import` with the identical state, format, and variables.
4. Show the plan to the user; never apply conflicts, destructive changes, or unexpected replacements without approval.
5. `tilde_import_state` only after approval; never as a substitute for planning.
6. Poll `tilde_get_state_import` with the returned `import_id` until `applied`, `failed`, or `rolled_back`.
7. Capture generated outputs from the first applied read — they are one-time secrets cleared from later reads. Hand them to the human for secure storage.
8. Tell the user to complete any pending credential setup in Tilde.
