---
name: update-openbot
description: Update a fork from the OpenBot upstream repository while preserving fork-owned configuration. Use for upstream syncs, conflict resolution, and compatibility migrations.
---

# Update OpenBot

1. Inspect remotes, branch status, and uncommitted changes. Do not overwrite fork work.
2. Fetch the configured upstream and merge or rebase in a dedicated branch according to the repository convention.
3. Treat `openbot.config.ts` and the complete `configuration/` tree as fork-owned. Resolve conflicts by preserving their intent while adopting updated interfaces.
4. Do not copy upstream secrets or generated deployment state.
5. Regenerate the repository manifest and contracts, then run `pnpm openbot check`, `pnpm check`, and `pnpm build`.
6. Summarize upstream changes, fork conflict decisions, and any required configuration migration.
