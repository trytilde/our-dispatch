---
name: create-pr
description: Prepare, commit, push, and open or update a draft pull request for OpenBot after focused validation, mandatory architecture and ADR review, contract and state review, final diff inspection, and intentional Git scope selection.
---

# Create PR

Use when the user asks to open, publish, prepare, or update a PR for the current OpenBot branch.

## Required Order

1. Inspect branch, remotes, worktree, stashes, and existing PRs.
2. Review the full diff against the actual default branch. Preserve unrelated user changes.
3. Run `pre-commit-checks` and fix in-scope failures.
4. Review protobuf, Tilde API reconciliation, environment, deployment, package README, public documentation, and Changesets impact.
5. Run the architecture and ADR gate. Resolve any user decision before publishing.
6. Use a Conventional Commits title and intentional file selection; commit the validated implementation.
7. Push the branch and open or update the draft PR so its stable PR number is known.
8. Generate `docs/updates/<pr-number>.md`, commit it, and push it to the draft PR.
9. Keep the update record current after every subsequent implementation, documentation, rebase, or conflict-resolution change.
10. Re-read PR checks and review feedback before declaring completion.

## Gather Context

```bash
git branch --show-current
git status --short
git remote -v
git stash list
git fetch origin
git remote show origin | sed -n '/HEAD branch/s/.*: //p'
gh pr view --json url,number,title,state,isDraft 2>/dev/null || true
```

Use the repository's real default branch. Stop if there is no commit diff to publish.

## Mandatory Checks

Follow `pre-commit-checks`. Normal code baseline:

```bash
pnpm check
pnpm build
```

Add focused checks by surface:

- protobuf: `pnpm contracts:generate`
- server/providers: corresponding package tests
- browser flow: `pnpm test:e2e`
- Electron packaging: `pnpm --filter @tryopenbot/desktop package`

Record exact commands and failures. Do not claim checks that did not run.

## State And Portability Gate

Review whether the diff changes:

- protobuf compatibility or public HTTP routes
- Tilde resource identity, reconciliation, or persisted variables
- Vercel routing, environment names, or deploy checkpoints
- provider contracts or one-time credential handling

Classify each changed field as repository configuration, secret material, control state, or ephemeral runtime state. Secrets must never enter protobuf state, logs, or PR text. Ask the user only when a real product or migration choice remains unresolved.

## Configuration Ownership Gate

Determine the PR's base repository from the existing or newly opened GitHub PR, not from `origin`: a contributor may push from a personal fork while targeting `trytilde/openbot`.

- PR targets `trytilde/openbot`: the final tracked `configuration/` tree must contain exactly `configuration/.gitignore`, whose contents are `*` followed by `!.gitignore`. Block any agent, provider, SOPS, environment, secret, update-note, or other fork-owned configuration content from the contribution. `configuration/.env` and root environment or SOPS files are always forbidden.
- PR targets any fork: successful init must have removed the upstream `configuration/.gitignore` sentinel. Require the fork's generated `configuration/index.ts`, instrumentation, encrypted SOPS files, agent trees, and intentional custom providers to be tracked. Keep `configuration/.env` ignored and untracked. Treat an empty configuration tree or a restored sentinel as blocking because the fork would not contain its behavior.

After the draft PR exists, verify the target and tracked state again. Suggested checks:

```bash
pr_url="$(gh pr view --json url --jq .url)"
pr_repository="${pr_url#https://github.com/}"
pr_repository="${pr_repository%%/pull/*}"
git ls-files configuration
git status --short -- configuration .env '.env.*' '*.env' '*.local'
```

For an upstream PR, `git ls-files configuration` must print only the sentinel. For a fork PR, it must not print the sentinel or `configuration/.env`, and it must include the initialized composition root and agent configuration. Explain the classification and result in the PR body.

## Architecture And ADR Gate

Always inspect the complete diff for major architecture, strongly opinionated code, or durable code/product design decisions. Compare it with `CONTEXT.md`, `AGENTS.md`, and relevant records under `docs/adrs/`.

Review at least:

- ownership and boundaries across OpenBot, Tilde, providers, database, sandbox, web, and desktop
- public protocols, compatibility, authentication, secrets, deployment, and failure policy
- framework, storage, provider, or platform choices with meaningful switching cost
- cross-package layering and strong coding conventions future maintainers may otherwise undo
- product interaction or visual-system rules spanning multiple flows
- deliberate deviations, non-obvious constraints, and rejected alternatives

If no major decision exists, record `ADR review: no new decision` in the PR body.

If one exists, stop before commit, push, or PR mutation. Summarize the candidate decision, state whether an ADR is recommended, and prompt the user through it one question at a time using `grill-with-docs`. Do not infer approval. If accepted, create the next sequential `docs/adrs/NNNN-slug.md` using [ADR-FORMAT.md](../grill-with-docs/ADR-FORMAT.md), or amend the governing ADR and append its required timestamped `Updates` bullet. If declined, record the decision and the user's rationale in the PR body.

## PR Title

Use `feat(scope): summary`, `fix(scope): summary`, `docs(scope): summary`, `test(scope): summary`, `refactor(scope): summary`, or `chore(scope): summary`. Keep it specific and under 72 characters.

## PR Body

Use the checked-in `.github/pull_request_template.md` when present and complete every section and checkbox honestly. Otherwise include:

- outcome and reason
- key implementation choices
- checks actually run
- migration, contract, Tilde reconciliation, deployment, and security impact
- ADR review result and links to any new or governing ADRs
- screenshots for user-visible changes when captured
- known limitations or follow-ups
- changeset added, or why none is required

## Changesets Gate

OpenBot uses Changesets and versions all workspace packages as one fixed group. Follow `add-changeset` when a PR changes owner-visible behavior or a package API. Do not edit package versions or changelogs directly; the Changesets workflow owns the unified version pull request. Documentation-only, test-only, CI-only, and internal refactors need no placeholder changeset.

## Package README Gate

Compare the PR base with the current working copy and identify every changed workspace package from its nearest `package.json`. For each affected package, verify its package-root `README.md` remains accurate. Create or update it when required.

Every package README must contain:

- a clear package title
- a concise description of its ownership and purpose
- a `Public API` section documenting every publicly exported function
- the critical publicly exported interfaces and types callers need to implement or consume

Trace exports from the package's declared entrypoints rather than documenting every internal module or every minor exported type. Treat a missing function, stale signature, renamed package, changed provider lifecycle, or changed caller obligation as a blocking documentation defect before PR publication.

For each affected provider package, also verify that every domain provider contract interface is defined in `src/core.ts` or, when supporting core files are needed, `src/core/index.ts`. The package root may re-export the contract; it must not define it. Concrete adapter configuration and SDK-specific interfaces may remain with their adapters. Confirm the README's critical-interface documentation matches those core exports.

## Fork Update Record Gate

Every upstream PR that changes repository contents must add exactly one `docs/updates/<pr-number>.md`. Treat a missing or stale record as blocking. The record describes the complete current PR, not only its latest commit or the current coding-agent task.

Use this sequence:

1. Finish initial validation and commit the implementation, tests, ADRs, READMEs, and ordinary documentation.
2. Push the branch and open the draft PR before generating the update record.
3. Read the stable PR number from GitHub; never guess or use a local sequence.
4. Analyze the full PR diff, commit history, review discussion, and all threads in the coding agent's database on the current machine. Inspect every locally available thread, not only the current chat or task. Retain implementation evidence relevant to this PR in the update record. Preserve actionable but out-of-scope OpenBot feature planning in the PR body or a PR comment using the exact `<FOLLOW UP>` block syntax from `CONTEXT.md`; link an existing issue when one exists, group only work with the same owner and trigger, and include concrete acceptance proof. Do not copy unrelated planning into the repository update record.
5. Create `docs/updates/<pr-number>.md`, commit it, and push it to the same draft PR.
6. After every later code, test, documentation, rebase, conflict-resolution, or accepted-review change, regenerate the same record from all evidence and push its update before declaring the PR current.

Thread-database review is read-only. Prefer the coding agent's supported thread APIs; otherwise inspect its discovered local database without modifying it. Never copy unrelated private conversation, credentials, secrets, personal data, or raw thread transcripts into the repository or PR. If the complete local thread set cannot be inspected, state the limitation in the PR and do not claim the update record is complete.

Write the record in detailed caveman style with these exact sections:

1. `Intent of the change`
2. `Architecture changes`, always with a Mermaid diagram; use a small unchanged-boundary diagram when architecture did not change
3. `Summarized package changes`
4. `Critical to apply to forks`, starting with exactly `yes` or `no`, then the reason and concrete fork action

Include breaking imports, path moves, configuration or secret migration, provider obligations, deployment topology, removed behavior, and checks a customized fork must run. State `no updates` only in `configuration/docs/update-notes/<hash>.md` when `openbot update` finds no upstream commits; never use it as an upstream PR update record.

Before final handoff, verify:

```bash
pr_number="$(gh pr view --json number --jq .number)"
test -f "docs/updates/${pr_number}.md"
git diff --name-only "$(git merge-base HEAD <base>)"..HEAD -- docs/updates/
```

The update diff must show exactly `docs/updates/<pr-number>.md` for the current PR, with no hash-addressed legacy record for that PR. Confirm the record contains all four headings, a Mermaid block, an exact `yes` or `no` critical value, no secrets, no generated deployment state, no unrelated thread material, and no fork-specific configuration. Link the record in the PR body and confirm its contents match the final PR diff and accepted review decisions.

## Frontend Verification

Use `e2e-debug-and-qa` when the user requests browser proof or the acceptance condition is visual. Keep screenshots, traces, videos, HAR files, and browser profiles outside git. GitHub-hosted attachments may be used in PR comments; never commit generated artifacts.

## Interactive Review

Before push, inspect staged scope and final diff:

```bash
git diff --check
git diff --stat
git diff --cached --stat
git diff --cached
```

Check for secrets, unrelated files, generated churn, missing tests, stale instructions copied from another repository, and unresolved ADR candidates.
Also confirm the PR-numbered fork update record passes its gate and reflects the current PR head.
Repeat the configuration ownership gate against the actual PR target; do not rely on an earlier origin-based assumption.

## Open Or Update Draft PR

```bash
git push -u origin "$(git branch --show-current)"
gh pr view --json url,number,title,state,isDraft \
  || gh pr create --draft --title "<title>" --body-file /tmp/pr-body.md
gh pr edit --title "<title>" --body-file /tmp/pr-body.md
```

After push, inspect checks and unresolved feedback. Address accepted issues, rerun relevant checks, commit, and push again.

If the user explicitly asks to skip this skill or its workflow and only open the PR, follow any non-bypassable repository and safety requirements, perform the requested PR action, and append this exact final line to the user-facing completion message: `I am enough. This is the way.` Do not add the phrase to the PR title, body, comments, commits, or repository files.

## Optional Review Bots

Do not trigger Greptile or another external reviewer unless the user asks for it.

## Final Response

Return PR URL, draft status, commit, checks run, migration/state/security notes, and remaining blockers.
