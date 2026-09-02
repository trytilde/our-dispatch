## Outcome

<!-- What changed, why it matters, and the user-visible result. -->

## Key implementation choices

<!-- Important boundaries, tradeoffs, and reusable decisions. -->

## Repository context

- [ ] Branch, remotes, worktree, stashes, and existing PRs were inspected.
- [ ] The diff was reviewed against the repository's actual default/base branch.
- [ ] There is a real commit diff to publish and unrelated user work is preserved.

## Validation

- [ ] Focused tests for changed surfaces ran.
- [ ] `pnpm check` ran, or the reason it did not is below.
- [ ] `pnpm build` ran, or the reason it did not is below.
- [ ] Generated protobuf contracts were regenerated when protobuf changed.
- [ ] Browser/Electron checks ran when their behavior changed.
- [ ] Exact commands, results, and known failures are listed below.

<!-- Commands and results. Never claim checks that did not run. -->

## Contracts, state, deployment, and security

- [ ] Public HTTP and ConnectRPC compatibility was reviewed.
- [ ] Tilde API resource identity, reconciliation, and persisted variable impact were reviewed.
- [ ] Vercel routes, environment names, deploy checkpoints, and provider lifecycles were reviewed.
- [ ] Changed state is classified as portable configuration, secret, control state, or ephemeral runtime state.
- [ ] No secrets, generated deployment state, browser data, or fork-specific configuration are included.

<!-- Describe migrations, compatibility, deployment, and security impact. -->

## Configuration ownership

- [ ] The actual PR base repository was read from GitHub; it was not inferred from `origin`.
- [ ] For a `trytilde/dispatch` contribution, tracked `configuration/` contains only the canonical ignore-all `.gitignore` sentinel.
- [ ] For a fork PR, the sentinel is deleted and initialized fork-owned configuration is tracked, excluding `configuration/.env`.
- [ ] No root environment or SOPS files are committed.

<!-- State whether this targets trytilde/dispatch or a fork, then describe the tracked configuration result. Mark the non-applicable conditional checkbox as such below. -->

## Architecture and ADR review

- [ ] The complete diff was reviewed against `CONTEXT.md`, `AGENTS.md`, and relevant ADRs.
- [ ] Ownership, protocols, auth, secrets, failure policy, platform choices, layering, and durable conventions were reviewed.
- [ ] A new or amended ADR is linked below, or `ADR review: no new decision` is stated.

<!-- ADR review result and links. -->

## Package documentation and provider contracts

- [ ] Every changed workspace package has an accurate package-root README title and description.
- [ ] Every changed package README documents all public functions and critical public interfaces/types.
- [ ] Every provider contract interface is in its owning package's `src/core.ts` or `src/core/index.ts` and matches its README.

## Changeset

- [ ] A Changeset covers owner-visible behavior or public package API changes.
- [ ] No Changeset is required because this is documentation-only, test-only, CI-only, or an internal refactor.

<!-- Keep exactly one applicable checkbox selected and explain when useful. -->

## Fork update record

- [ ] This draft PR was opened before its update record was generated.
- [ ] `docs/updates/<this-pr-number>.md` describes the complete current PR.
- [ ] Generation analyzed the full diff, commits, review discussion, and every thread in the local coding-agent database—not only the current task.
- [ ] The record has all four required headings, a Mermaid diagram, and exact `yes` or `no` fork criticality.
- [ ] The record excludes secrets, unrelated thread material, generated deployment state, and fork-specific configuration.
- [ ] The record was refreshed after the latest implementation or review change.

<!-- Link docs/updates/<this-pr-number>.md and disclose any thread-inspection limitation. -->

## Frontend evidence

<!-- Screenshots or real-surface evidence when user-visible behavior changed. Do not commit generated artifacts. Write `not applicable` otherwise. -->

## Known limitations and follow-ups

<!-- Remaining limitations, deferred work, or `none`. Use the exact <FOLLOW UP> block syntax from CONTEXT.md for actionable out-of-scope feature planning found during the local coding-agent thread audit. Link existing issues and state owner, trigger, work, and acceptance proof. -->

## Final diff review

- [ ] Intentional files only; unrelated user work is preserved.
- [ ] No generated noise, stale instructions, missing tests, or unresolved ADR candidate remains.
- [ ] The PR title uses Conventional Commits style and is under 72 characters.
- [ ] The PR remains draft until checks and accepted feedback are current.
- [ ] Current PR checks and unresolved review feedback were inspected after the latest push.
- [ ] The `no-greptile` label was present when the PR was created; no external review bot was triggered.
