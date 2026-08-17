# OpenBot

OpenBot is being rebuilt from the user experience downward. The current workspace connects its owner-facing chat to configured agents while provider and computer capabilities continue to expand behind narrow contracts.

## Run locally

Requirements: Node.js 24 and pnpm 10.

Install the standalone CLI with `npm install --global openbot`, or use `npx openbot`. Create and enter a completely empty destination directory before running init; any visible or hidden entry makes initialization stop before prompts or external changes.

AI agents and automation can initialize without a TTY by piping a JSON answer object through standard input:

```bash
openbot init --non-interactive --json < openbot-answers.json
```

Secrets therefore stay out of process arguments. See `cli/README.md` for stable answer IDs and a complete example.

```bash
mkdir my-openbot
cd my-openbot
openbot init
pnpm install
pnpm dev
```

- Web: `http://127.0.0.1:4173`
- API: `http://127.0.0.1:4100`
- Health: `http://127.0.0.1:4100/healthz`

A fresh upstream checkout intentionally contains only `configuration/.gitignore`, which hides all configuration contents. `openbot init` creates and clones the owner repository into the empty destination before configuring it; successful initialization removes that exact upstream sentinel so the fork can commit its configuration and initial agent. Commit the deletion with the generated configuration. Ordinary upstream merges preserve the fork's committed deletion while upstream leaves the sentinel unchanged. No setup or pairing code is required.

## Deploy

```bash
openbot init
pnpm openbot new-agent
pnpm deploy:prod -- --dry-run --json
pnpm deploy:prod -- --yes
```

`openbot init` creates `configuration/index.ts` and `configuration/.env`, seeds the fork-owned `configuration/templates/agent/` defaults, configures SOPS, generates a dedicated age identity for the trusted development sandbox, and asks for an independent owner identity. Managed owner identities support HashiCorp Vault Transit, Azure Key Vault, Google Cloud KMS, and AWS KMS. Local fallbacks store a generated owner age identity in 1Password or the native operating-system keychain. Provider-contributed questions are saved either to `.env` or `configuration/secrets.enc.yaml`; secret input is never written to command arguments.

The default inference provider is Vercel AI Gateway. Init asks for a human-readable API-key name, creates the key with the configured Vercel account, and stores it in SOPS as `AI_GATEWAY_API_KEY`. Newly scaffolded agents pass `openai/gpt-5.6-sol` directly to AI SDK, which is Vercel's recommended automatic Gateway path; `AI_MODEL` can select another Gateway model. The inference provider provisions credentials but does not supply a model factory.

Root `.env`, `.env.local`, and root SOPS files are intentionally unsupported. Fork configuration comes only from `configuration/.env` and `configuration/secrets.enc.yaml`; contributor machines and CI supply repository-maintenance values through their process environment, so contributor configuration cannot silently propagate into forks.

`openbot dev` checks every runtime provider, starts the shared Computer through Microsandbox, and reconciles Tilde resources for every authored agent before starting the watched control/agent server. Vercel service providers perform no remote development deployment, and a configured Vercel Sandbox provider delegates development to Microsandbox. Computer image inputs are watched; changes rebuild the image and replace the local sandbox while preserving its `/workspace` volume. Tilde creates or updates each local-running Vercel AI SDK endpoint, synchronizes authored skills and an exact registry, creates one dynamic MCP server, and enables the Tilde control-plane toolkit per agent. A Vercel service deployment also enables its proxied MCP connection. Their IDs are maintained as `AGENT_<ID>_*` values in `configuration/.env`; one-time endpoint credentials remain encrypted. Each reconciliation first checks stable identity and current fields, creates missing resources, and updates only drift. Run the command under the Tilde tunnel when ChatKit must reach local agent routes.

OpenBot does not import or export Tilde state during normal lifecycle commands. For a one-time setup or migration to another environment, an operator can manually export state from one Tilde team and import it into another with the Tilde CLI; subsequent OpenBot runs reconcile that imported state through the API.

Use `pnpm openbot secrets set NAME --description "Purpose"` and `pnpm openbot secrets unset NAME` to maintain encrypted values without learning SOPS commands. Every secret is stored as `{ description, value }`; SOPS leaves the description readable and encrypts only `value`. Setting a value requires a current SOPS release with `set --value-stdin` support so plaintext never appears in the process list. Use `pnpm openbot env set NAME VALUE --description "Purpose"` and `pnpm openbot env unset NAME` for plaintext configuration; descriptions are rendered as comments immediately above assignments.

Commit `configuration/index.ts`, `.sops.yaml`, and `secrets.enc.yaml` after initialization. Never commit `configuration/.env`. Owner identity lookup metadata is user-specific and lives in `~/.openbot/config.json` under `sops`; it must not be committed. Interactive SOPS-backed commands recover missing lookup metadata through CLI questions, while non-interactive commands fail with instructions to run interactive init. The sandbox age private key is encrypted as `SECRETS_SOPS_AGE_KEY.value`. Trusted-sandbox deployment refreshes `.env`, `.sops.yaml`, and `secrets.enc.yaml`, installs the identity as a mode-`0400` file readable only by the sandbox Linux user, and sources a loader from `.bashrc` and `.bash_profile` to export dotenv and decrypted SOPS values.

The CLI checks and builds every selected provider that exposes `buildable`, then plans and deploys providers that expose `deployable`. `openbot deploy --skip-deploy` stops after producing artifacts. `openbot deploy --service agents --yes` builds and deploys the agent project without compiling or redeploying control; `--service control` does the inverse. A configured computer provider builds its shared image before agent functions and the control runtime. For Vercel Sandbox, deployment creates the Vercel projects first and then creates the agent project's VCR repository on the first image push; local Microsandbox keeps the content-tagged Docker image local. Provider lifecycles persist their own environment and encrypted secrets; deployment results retain named handoff outputs.

`configuration/index.ts` is the only composition root and explicitly constructs every provider role under its `providers` object. Agent entrypoints read their runtime environment directly and do not import the composition root or a second runtime-provider module. Init selects one Tilde agent provider that reconciles the agent, its authored skills, dynamic MCP server, Tilde control-plane tools, and deployment-platform MCP integrations. The full primary agent lives at `configuration/agent/`; `new-agent` creates equally complete agents below `configuration/agent/subagents/<id>/`. Each owns its instrumentation, skills, tools, and workspace seed. Custom provider source lives under `configuration/providers/`. When provider wiring changes, inspect `configuration/templates/agent/` so future agents receive matching environment variables, tools, prompts, and endpoint setup. Global `configuration/skills/` and `configuration/sandbox/` directories are unsupported, and filesystem locations are not configuration options.

The agent-local folder remains named `sandbox/workspace/` to stay structurally compatible with Eve where practical; runtime terminology is Computer everywhere else. Run `pnpm openbot new-agent` to create an agent from its display name by rendering the fork-owned `configuration/templates/agent/**/*.hbs` tree. Template edits affect future agents only. Each generated agent explicitly owns thin tool files for shell, background-shell waiting, file access, search, and screenshots. Their shared Zod schemas and typed computer-service implementations live in `@tryopenbot/computer-tools`; every file fixes the path-derived agent ID outside its model-visible schema. Populated seeds initialize `/workspace/<agent-id>` once on the shared computer. That path is the agent's default directory, not a security boundary. Agent source imports vendor SDKs directly and never imports provider packages.

Agent Bash tools run `bash -lc` with `HOME=/workspace/<agent-id>`. Init scaffolds
each agent's `sandbox/workspace/.profile`, which Bash loads before
each command and which may source an optional `.bashrc`. Like every workspace
seed, the profile is copied only when that agent is first registered; editing
it does not modify an existing deployed workspace.

`openbot init` also generates `COMPUTER_SERVICE_API_KEY` in the SOPS document and preserves that name in the runtime environment. Agent and control services receive it through their normal secret installation, and each computer receives the same value when it is created. Computer-service rejects every RPC without the exact bearer key; the key is never returned as a deployment output or written into a generated public artifact.

- `vercel` builds a control/web project and a separate agent project. Every configured agent is a parallel-built Vercel Function; both projects deploy from prebuilt artifacts.
- `local` builds separate control and agent Hono servers, writes private service environments, and installs two user-level systemd services on Linux or launchd agents on macOS. Development still hosts control and agents in one Hono process.

`--dry-run` performs native checks, writes local build artifacts, and calls the read-only `plan()` lifecycle. It does not link projects, publish Vercel deployments, or start services. Use `--skip-deploy` when only the artifacts are wanted and no deployment plan is needed.

The production build stages the web app in the control provider's `.vercel/output/static` artifact for Vercel's CDN and deploys its provider-owned Hono Function for `/healthz` and `/api/*`.

## Current application boundary

- `cli` owns the React Ink repository CLI, development process supervision, and provider deployment coordination.
- `packages/runtime-provider` owns the optional provider deployment contract and runtime-last coordinator.
- `packages/control-service-provider` owns local and Vercel control/web builds and deployment.
- `packages/agent-service-provider` owns Eve-compatible agent-directory discovery, instrumentation startup, concurrent per-agent Vercel bundles, the local agent server, and deployment.
- `apps/web` owns the workspace, agent selection, conversation composer, and frontend routes.
- `apps/control-service` owns the portable Hono application, built web UI fallback, `/healthz`, the allowlisted Tilde ChatKit REST/SSE bridge under `/api/chat/*`, and the local control-service entrypoint.
- `packages/computer-service-proto` owns the API-key-protected internal computer API.
- No control database is retained while the reset application has no persisted control state.
- Each domain provider package owns both its TypeScript contract in `src/core.ts` or `src/core/index.ts` and its concrete adapters; provider contract interfaces never live in adapter modules or the package-root entrypoint, and they are not RPC surfaces.

```bash
pnpm check
pnpm build
pnpm test:e2e
```

OpenBot is MIT licensed. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [PROVENANCE.md](PROVENANCE.md).
