---
name: edit-openbot-configuration
description: Edit a fork's repository-owned OpenBot composition, providers, agent defaults, instrumentation, environment declarations, and templates under configuration/. Use when changing configuration/index.ts, configuration/providers/, configuration/instrumentation.ts, configuration/templates/agent/, or the defaults used by openbot new-agent.
---

# Edit OpenBot configuration

## Read ownership first

Read `docs/configuration.md`, `docs/providers.md`, `docs/agents.md`, and the relevant ADRs. Inspect `configuration/index.ts` and `configuration/templates/agent/` before editing.

Keep fork choices in `configuration/`. Modify upstream packages only when the needed seam is missing or reusable across forks.

## Keep composition explicit

- Construct concrete domain providers under `Configuration({ providers: { ... } })` in `configuration/index.ts`.
- Keep `configuration/index.ts` as the only provider composition root. Agent entrypoints read their runtime environment directly and must not import provider composition.
- Keep providers limited to control-service operations, initialization/provisioning, and lifecycle hooks. Do not expose model, prompt, tool, or arbitrary vendor APIs for agents.
- Share one concrete platform instance when several providers use Tilde or Vercel.
- Put custom provider source under `configuration/providers/`.
- Keep credentials out of tracked source. Use described environment or SOPS commands.

## Keep future agents aligned

If provider composition changes in `configuration/index.ts`, inspect `configuration/templates/agent/`. Update the template when future agents need matching environment variables or direct SDK/endpoint wiring. Authored agents must not import provider packages; integrate OpenAI, Tilde, Composio, or another chosen system directly in agent code.

Each file below `configuration/templates/agent/` must end in `.hbs`. `openbot new-agent` preserves its relative path, removes `.hbs`, and renders these strict values:

- `AGENT_ID`
- `AGENT_ID_JSON`
- `AGENT_NAME`
- `AGENT_NAME_JSON`
- `AGENT_ENV_PREFIX`

Template changes affect only agents created later. Update the primary `configuration/agent/` and existing `configuration/agent/subagents/<id>/` directories explicitly when compatibility requires it. Never silently regenerate or overwrite them.

## Preserve fixed paths

Keep the full primary agent under `configuration/agent/` and full additional agents under `configuration/agent/subagents/<id>/`. Every one supports its own instrumentation, skills, tools, and `sandbox/workspace/`. Do not nest another `subagents/` directory, add global `configuration/skills/` or `configuration/sandbox/`, or make these paths configurable.

## Verify

Run focused initialization and agent-scaffold tests. Scaffold a temporary agent and inspect rendered paths and provider wiring. Then run `pnpm check`; run `pnpm build` when imports, package boundaries, or runtime composition changed. Review the diff for secrets and unintended edits to existing agents.
