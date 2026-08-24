# Upstream sync to cdf23ce (PR #65 and the workspace rewrite)

- Merged upstream main through PR #65 (in-chat connector configuration) plus the
  owner-workspace rewrite, desktop release workflows, and dev-reliability fixes.
- Conflict policy per owner decision: upstream wins everywhere, including copy
  ("Add bot", opensource feedback address) and the removed Computer take-over
  control; the fork's earlier UI deviations were stale. Fork keeps only its
  configuration tree.
- Fork migrations applied: re-rendered both agents' `agent.ts`,
  `instructions.ts`, and the media tool files (`copy_from_computer`,
  `copy_to_computer`, `screenshot`) from the current templates for the new
  session-bound computer-tools API; refreshed `configure_connector`, the
  `tilde-connectors` skill, and the fork template tree to the scrubbed upstream
  versions.
- Validated with `pnpm check`, `pnpm build`, `pnpm test`, and
  `CI=1 pnpm test:e2e` (9 passed, 1 skipped).
