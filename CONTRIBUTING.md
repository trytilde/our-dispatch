# Contributing

Use Node 24 and pnpm 10. Work on a focused branch, preserve unrelated fork changes, and run:

```bash
pnpm install
pnpm check
pnpm build
```

Provider contracts belong in `packages/provider-sdk`; default integrations belong in `packages/providers`; fork-specific integrations belong in `configuration/providers/`. Agent prompts and execution belong in `configuration/agents/`, not the server router. Never commit `.env`, `configuration/sandbox/secrets.yaml`, deployment state, or generated credentials.

When contributing from a fork, separate reusable core changes from private configuration. `.agents/skills/upstream-pr` documents the repository workflow for coding agents.

Owner-visible behavior and package API changes require a file under `.changeset/`. Every workspace package is in one fixed version group; never change package versions or generated changelogs independently. Use `pnpm changeset` or follow `.agents/skills/add-changeset`.
