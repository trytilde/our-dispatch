# Contributing

Everything in this repository is driven by one CLI. `openbot` operates an installation —
`init`, `dev`, `deploy`, `secrets`, `env` — and carries the developer workflow: repository
gates and remote desktop hosts. Prefer a CLI command over a
hand-written script or a remembered command line; see [ADR-0018](docs/adrs/0018-developer-workflow-cli.md).

Run it as `pnpm openbot <command>` inside the repository, or `openbot <command>` from a global
`npm install --global openbot`.

## Prerequisites

Required on every platform:

| Dependency | Version | Why |
| --- | --- | --- |
| Node.js | 24.x | pinned by `engines`; the CLI and every package target it |
| pnpm | 10.33.1 | pinned by `packageManager`; `corepack enable pnpm` installs it |
| Git | any recent | worktrees and fork workflow |
| GitHub CLI (`gh`) | any recent | `openbot init` verifies authenticated access; PR workflow |

Needed only for the surfaces you touch:

| Surface | Dependency | Notes |
| --- | --- | --- |
| Browser end-to-end | Playwright browsers | `pnpm exec playwright install chromium` |
| Desktop publication | the AWS CLI, a Developer ID Application certificate, an App Store Connect API key | upstream only, see ADR-0028. Only `openbot desktop release publish|manifest|status` needs them; building and packaging locally does not. Without the Apple credentials the build still succeeds and produces unsigned artifacts |
| Local Computer, deployment | Microsandbox, SOPS, age | see [docs/sandbox.md](docs/sandbox.md) and [docs/configuration.md](docs/configuration.md) |

## Setup on Linux

```bash
# Node 24 and pnpm
curl -fsSL https://fnm.vercel.app/install | bash && exec "$SHELL" && fnm install 24 && fnm use 24
corepack enable pnpm

# repository
gh repo clone trytilde/openbot && cd openbot
pnpm install
pnpm openbot check
```

A Linux host without a display runs the Electron shell behind Xvfb with x11vnc bound to
loopback on VNC 5901. `pnpm openbot connect -- <host>` forwards that desktop.

## Setup on macOS

```bash
# Node 24 and pnpm
brew install fnm && exec "$SHELL" && fnm install 24 && fnm use 24
corepack enable pnpm

# repository
gh repo clone trytilde/openbot && cd openbot
pnpm install
pnpm openbot check
```

## Working on a change

```bash
pnpm openbot check                     # contracts, types, lint, package tests
pnpm openbot build                     # every package, plus artifact verification
pnpm openbot test                      # repository tests
pnpm openbot e2e                       # browser Playwright suite
pnpm openbot desktop dev               # launch the Electron shell
pnpm openbot desktop package           # Electron packaging
pnpm --filter <package> test           # narrowest useful check while iterating
```

Start with the narrowest check that covers your change and broaden by risk. Run `e2e` when
browser behavior changed and `desktop package` when packaging, preload, or bundled resources
changed. Never claim a check you did not run.

Work on a focused branch and preserve unrelated fork changes.

## Boundaries

Provider contracts belong in `core.ts` or `core/` inside their domain provider package;
implementations belong beside them. Fork-specific integrations live in
`configuration/providers/` when `configuration/index.ts` selects them explicitly. Agent
prompts and execution belong in the primary `configuration/agent/` tree or one of its
`subagents/<id>/`, not the server router.

Shared client behavior belongs in `packages/client-runtime` before any client renders it; a
capability added to the web or desktop client requires an explicit decision about the other.

Never commit `.env`, deployment state, generated credentials, or machine-specific paths.
Development host names and addresses belong in fork-owned `configuration/dev-hosts.json`,
which stays untracked upstream.

## Publishing the desktop app

Desktop publication is upstream-only for the same reason (ADR-0028). Signed builds go to
`s3://tilde-app-updates-prod/desktop/openbot/<channel>/`, and `openbot desktop release` refuses
the official bucket from any other remote:

```bash
pnpm release:desktop -- status
pnpm release:desktop -- build --platform mac
pnpm release:desktop -- publish --yes
pnpm release:desktop -- manifest --yes
```

`publish` and `manifest` require `--yes` because both change a public feed. In CI this runs as
the manually triggered **Release desktop** workflow, which needs these repository variables:

| Variable | Purpose |
| --- | --- |
| `AWS_OIDC_ROLE_ARN` | Role the workflow assumes through GitHub OIDC |
| `AWS_REGION` | Region of the updates bucket |
| `DESKTOP_UPDATES_S3_BUCKET` | Bucket name; omit upstream to take the default |
| `DESKTOP_UPDATES_S3_PREFIX` | Prefix above the channel, default `desktop/openbot` |
| `DESKTOP_UPDATES_BASE_URL` | Public https origin used for download URLs |

and these repository secrets for a signed, notarized macOS build:

| Secret | Purpose |
| --- | --- |
| `MACOS_CERTIFICATE` | Base64 Developer ID Application `.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `APPLE_API_KEY` | Base64 App Store Connect `.p8` used by notarytool |
| `APPLE_API_KEY_ID` | Key ID for that `.p8` |
| `APPLE_API_ISSUER` | Issuer ID for that key |

Without the certificate secrets the build still succeeds but produces **unsigned** artifacts
that macOS Gatekeeper refuses, recorded as `signed: false` in `version.json`. A fork publishes
to its own bucket with `OPENBOT_DESKTOP_UPDATES_BUCKET`, optionally
`OPENBOT_DESKTOP_UPDATES_PREFIX` and `OPENBOT_DESKTOP_UPDATES_BASE_URL`. Never commit an Apple
certificate or an App Store Connect key.

## Changing an external dependency

If your change adds, removes, or bumps a tool a contributor must install, update the prerequisite
table and setup section above in the same PR. The `create-pr` skill gates this.

## Fork contributions and release notes

When contributing from a fork, separate reusable core changes from private configuration.
`.agents/skills/upstream-pr` documents the repository workflow for coding agents.

Owner-visible behavior and package API changes require a file under `.changeset/`. Every
workspace package is in one fixed version group; never change package versions or generated
changelogs independently. Use `pnpm changeset` or follow `.agents/skills/add-changeset`.
