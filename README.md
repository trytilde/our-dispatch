# OpenBot

OpenBot is a fork-first, open-source agent workspace. Fork the repository, describe your agents and integrations as ordinary TypeScript and Markdown, then run the same configuration locally or on Vercel.

## Start locally

Requirements: Node.js 24, pnpm 10, and Linux with KVM or Apple Silicon macOS.

```bash
git clone https://github.com/trytilde/openbot.git
cd openbot
pnpm install
pnpm openbot setup
pnpm openbot doctor
pnpm openbot dev
```

The default fork includes one agent, Tilde skill registration, an isolated computer, and the web/desktop application. Local state and credentials are ignored by Git. When Tilde credentials are present, the dev tunnel gives repository agents a public signed endpoint and startup reconciliation registers them.

## Deploy your fork

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftrytilde%2Fopenbot&project-name=openbot&repository-name=openbot&env=OPENBOT_SETUP_CODE&envDescription=Use%20at%20least%2032%20random%20bytes.)

The hosted path uses Vercel, Turso Marketplace, and Tilde. Generate `OPENBOT_SETUP_CODE` with `openssl rand -base64 32`, complete the setup UI, then use:

```bash
pnpm openbot deploy --dry-run --json
pnpm openbot deploy --yes
```

Deployment validates and builds the fork, provisions or reuses its resources, deploys, reconciles committed skills and agents under a database lease, and runs smoke tests. A private mirror works too; configure the same environment values and retain an `upstream` remote for updates.

## The repository is the configuration

```text
openbot.config.ts       provider selection and repository paths
configuration/agents/<id>.ts
                        one Vercel AI SDK-compatible agent endpoint per file
configuration/skills/<name>/SKILL.md
                        runtime skills registered by the selected skill provider
configuration/providers/<id>/
                        fork-owned provider plugin implementations
configuration/sandbox/assets/
                        files copied to /workspace on every sandbox start
configuration/sandbox/bootstrap.sh
                        idempotent script run after those files are copied
```

Agent route modules export `POST` using Tilde `chatKitEndpoint` and the Vercel AI SDK. OpenBot serves each module at `/api/agents/<id>`. Skills are reconciled into the configured Tilde registry. Removed agents remain orphaned by default; `pnpm openbot sync --prune --yes` explicitly disables them remotely.

Only sandbox-specific secrets declared in `configuration/sandbox/secrets.example.yaml` are injected. Set them as `OPENBOT_SANDBOX_SECRET_<NAME>` or, for local development only, in ignored `configuration/sandbox/secrets.yaml`. Provider and control-plane credentials are never implicitly copied into a sandbox. SOPS portability is intentionally deferred from this first version.

## Common commands

Run `pnpm openbot` in a terminal for an interactive launcher with arrow-key navigation. Every command also remains directly callable for scripts and repeatable workflows:

```bash
pnpm openbot check
pnpm openbot doctor
pnpm openbot agent create --id researcher --name "Researcher"
pnpm openbot agent create --id researcher --name "Researcher" --publish
pnpm openbot providers list
pnpm openbot sync
pnpm openbot status
```

Long-running operations show live progress and finish with compact status tables. Add `--json` to `check`, `doctor`, `providers list`, `sync`, or `status` when another tool needs stable machine-readable output.

`agent create` writes a local module by default. With `--publish`, OpenBot creates a branch and pull request through the configured source-control provider. A human merges it; the normal deployment then federates and registers the new endpoint. Runtime code never commits directly to the deployment branch.

See [configuration](docs/configuration.md), [agents](docs/agents.md), [provider plugins](docs/providers.md), [sandbox setup](docs/sandbox.md), and [fork maintenance](docs/forks.md). Contributor agents can use the repository skills in `.agents/skills/` for running, customizing, updating, and contributing OpenBot.

## Architecture and validation

The Hono server serves signed agent endpoints and Connect control APIs. Tilde owns remote agents, skill registries, ChatKit sessions, and runtime MCP tools. Turso/libSQL stores reconciliation leases and non-secret control state. Provider secrets stay behind `EnvProvider`; sandbox browser state remains sensitive.

```bash
pnpm check
pnpm build
pnpm test:e2e
```

OpenBot is MIT licensed. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [PROVENANCE.md](PROVENANCE.md).

Changesets records release impact and maintains one version across all workspace packages. Contributors add a `.changeset/*.md` entry for owner-visible behavior or package API changes; GitHub Actions opens the unified version pull request. Packages and changelogs are never versioned independently.
