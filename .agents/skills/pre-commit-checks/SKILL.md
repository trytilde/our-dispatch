---
name: pre-commit-checks
description: Run OpenBot's TypeScript, protobuf, Vitest, build, browser, provider, and desktop checks before committing, pushing, opening a PR, or handing off work. Use risk-based focused checks first, then repository gates.
---

# Pre-Commit Checks

Use repository-pinned Node.js 24 and pnpm 10 tooling. Start narrow, then run the gates required by the changed surface.

## First Guard

Inspect the worktree and secret-bearing paths before broad checks:

```bash
git status --short --branch
git diff -- .env .env.* '*.env' '*.local'
git check-ignore -v .env.local .data .vercel .openbot-deploy
```

Never stage credentials, setup codes, browser profiles, local databases, Vercel metadata, decrypted deployment files, or test artifacts.

## Metadata Semantics Guard

Inspect every changed metadata read and write:

```bash
base="$(git merge-base HEAD origin/main)"
git diff "$base"..HEAD -- '*.ts' '*.tsx' '*.hbs' '*.json' | \
  rg -n 'metadata|providerMetadata|provider_metadata|Record<string, unknown>|\.pointer\(' || true
```

Metadata is allowed only for provider-specific facts that cannot be normalized
and opaque client extensions that core code never reads. Fail the handoff when
agent templates, SDKs, control routes, client runtime, UI, or provider
composition use metadata for internal authorization, identity, routing,
lifecycle, retries, relationships, models, budgets, runs, jobs, compaction, or
memory semantics. Require a typed Tilde/OpenBot contract instead.

## Required Gates

For non-trivial code changes:

```bash
pnpm check
pnpm build
```

`pnpm check` regenerates protobuf contracts, type-checks scripts and packages, and runs package lint/test tasks plus deployment-script tests. Run focused tests first while iterating:

```bash
pnpm --filter @tryopenbot/control-service test
pnpm --filter @tryopenbot/agent-service-provider test
pnpm --filter @tryopenbot/computer-service-provider test
pnpm --filter @tryopenbot/client-runtime test
pnpm --filter @tryopenbot/desktop test
```

Run `pnpm test:e2e` when browser behavior changed or the user requested end-to-end proof. Run `pnpm --filter @tryopenbot/desktop package` when packaging, preload, Electron startup, or bundled-resource behavior changed.

## TypeScript Fix Policy

Fix strict TypeScript failures at the owning seam. Do not hide them with broad `any`, unchecked double casts, disabled compiler options, or copied provider response types.

Prefer:

- schema validation for untyped external payloads
- exhaustive unions for provider states and errors
- shared provider contracts in `src/core.ts` or `src/core/index.ts` inside the owning provider package, or in protobuf for an actual service boundary
- shared client contracts in `packages/client-runtime` for anything a renderer consumes; do not satisfy a UI type error by declaring a local copy of a wire or state shape
- request cancellation through `AbortSignal`
- focused compatibility adapters at external boundaries

Avoid unrelated formatting or dependency churn; no repository-wide formatter is configured.

## Generated Files

After protobuf changes:

```bash
pnpm contracts:generate
git diff -- packages/control-service-proto packages/computer-service-proto
```

Edit the `.proto` source, never generated TypeScript. Do not commit `apps/web/src/routeTree.gen.ts` unless the project intentionally begins tracking it.

## Release Notes

OpenBot uses Changesets with one fixed group for every workspace package. Follow `add-changeset` for owner-visible behavior or package API changes. Do not edit versions or changelogs directly. Documentation-only, test-only, CI-only, and internal refactors need no placeholder changeset.

## Fix Before Commit

- Required focused tests pass.
- `pnpm check` and `pnpm build` pass for non-trivial code changes.
- E2E or desktop packaging was run when relevant, or the handoff names what was not run.
- Generated contracts match protobuf sources.
- Diff contains no secrets, local state, generated noise, or unrelated edits.
- Changed metadata is provider-specific or client-opaque and has no internal
  OpenBot/Tilde semantics.
- A valid changeset is present when release impact requires one, or the handoff explains why none is needed.
- Changed provider contract interfaces are defined in `src/core.ts` or `src/core/index.ts`, re-exported by the package root, and reflected in the package README's `Public API` section.
- New or changed major UX surfaces and state interactions consume `packages/client-runtime` contracts. `apps/web` and `apps/desktop` added no local wire types, fetch/SSE parsing, or duplicate snapshots; only presentation-only state is component-local.
