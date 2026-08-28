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

## Develop this repository

Contributors and coding agents drive the repository through the same `openbot` CLI, which
carries the developer workflow beside its operator commands (ADR-0018):

```bash
pnpm openbot check                  # contracts, types, lint, package tests
pnpm openbot build                  # every package, plus artifact verification
pnpm openbot test                   # repository tests
pnpm openbot e2e                    # browser Playwright suite
pnpm openbot desktop dev            # Electron shell, headless with VNC on a display-less host
pnpm openbot desktop package        # Electron packaging
pnpm openbot mobile doctor          # verify the mobile toolchain
pnpm openbot mobile emulator        # Android emulator, headless on a display-less Linux host
pnpm openbot mobile expo run:ios    # iOS simulator, macOS only
pnpm openbot mobile release status  # EAS store builds, upstream only; a mobile-v* tag releases
pnpm openbot connect -- <host>      # tunnel a remote dev host's emulator, Metro, and adb
pnpm openbot sdk refresh            # regenerate, build, and test the Tilde SDK
```

Prerequisites differ per platform and per surface — a JDK 17 or 21 for Android, Xcode 16.1 or
newer with CocoaPods for iOS, KVM with Xvfb and x11vnc for a headless Linux emulator. See
[CONTRIBUTING.md](CONTRIBUTING.md) for Linux and macOS setup from scratch, and run
`pnpm openbot mobile doctor` to check the current machine.

## Deploy

```bash
openbot init
pnpm openbot new-agent
pnpm deploy:prod -- --dry-run --json
pnpm deploy:prod -- --yes
```

`openbot init` creates `configuration/index.ts` and `configuration/.env`, seeds the fork-owned `configuration/templates/agent/` defaults, configures SOPS, generates a dedicated age identity for the trusted development sandbox, and asks for an independent owner identity. Managed owner identities support HashiCorp Vault Transit, Azure Key Vault, Google Cloud KMS, and AWS KMS. Local fallbacks store a generated owner age identity in 1Password or the native operating-system keychain. Provider-contributed questions are saved either to `.env` or `configuration/secrets.enc.yaml`; secret input is never written to command arguments.

Every interactive init run shows React Ink selectors for provider domains with multiple built-in implementations. Each selector includes every available implementation and preselects the provider currently composed in `configuration/index.ts`, so rerunning init can update runtime or inference without editing generated composition by hand. As soon as a provider is selected, init asks and provisions that provider's configuration before showing another provider domain; selecting ChatGPT therefore starts Codex device login before any Tilde setup. Init rewrites only a recognized, canonical built-in composition. A custom or owner-edited composition remains selectable as the current value and must be changed explicitly.

Init offers Vercel AI Gateway or a ChatGPT subscription through Codex for local and directly managed Vercel runtimes; Vercel AI Gateway remains the default. Directly managed Gateway setup creates a named key stored in SOPS as `AI_GATEWAY_API_KEY`, while Tilde Cloud uses automatic project OIDC and stores no Gateway key. Both default to `openai/gpt-5.6-sol`. The Codex path always runs device-code login, stores the opaque Codex credential cache in SOPS as `CODEX_AUTH_JSON`, and defaults to `gpt-5.6-sol`. Development checks and refreshes that cache before services start and requests another device login when an owner is present; production deployment refreshes valid credentials but stops with an explicit reauthentication instruction when they are missing, expired, or revoked. Vercel agent functions receive the Linux Codex executable and opt into Vercel Large Functions because the native binary exceeds the standard function bundle limit.

The selected inference provider seeds its SDK-specific `inference.ts.hbs` into the fork-owned default agent template. When init changes inference providers, it migrates the future template and existing agents only when each affected file still exactly matches the previous provider scaffold; fork-owned edits stop the switch with an explicit migration error. Generated agents keep the same AI SDK call shape and import vendor SDKs directly. Codex app-server receives the ordinary OpenBot AI SDK tool set through the provider package's local MCP bridge. Sampling controls and strict structured-output behavior remain subject to the community provider's documented limitations.

Root `.env`, `.env.local`, and root SOPS files are intentionally unsupported. Fork configuration comes only from `configuration/.env` and `configuration/secrets.enc.yaml`; contributor machines and CI supply repository-maintenance values through their process environment, so contributor configuration cannot silently propagate into forks.

`openbot dev` checks every runtime provider, starts the shared Computer through Microsandbox, and reconciles Tilde resources for every authored agent before starting the watched control/agent server. Vercel service providers perform no remote development deployment, and a configured Vercel Sandbox provider delegates development to Microsandbox. Computer image inputs are watched; changes rebuild the image and replace the local sandbox while preserving its `/workspace` volume. Tilde creates or updates each local-running Vercel AI SDK endpoint, synchronizes authored skills and an exact registry, creates one dynamic MCP server, and enables the Tilde control-plane toolkit per agent. A Vercel service deployment also enables its proxied MCP connection. Their IDs are maintained as `AGENT_<ID>_*` values in `configuration/.env`; one-time endpoint credentials remain encrypted. Each reconciliation first checks stable identity and current fields, creates missing resources, and updates only drift. Run the command under the Tilde tunnel when ChatKit must reach local agent routes.

OpenBot does not import or export Tilde state during normal lifecycle commands. For a one-time
setup or migration to another environment, an operator can run `openbot state export` and
`openbot state import`; subsequent OpenBot runs reconcile that imported state through the API.

## Tilde SDK

This monorepo owns the public Tilde TypeScript SDK packages alongside OpenBot:

- `@trytilde/api-client`: generated API client and URL helpers.
- `@trytilde/sdk`: stable hand-authored Tilde client, ChatKit, MCP, skill, and reverse-proxy APIs.
- `@trytilde/sdk-react`: React provider and ChatKit hooks.
- `@trytilde/sdk-vercel-ai-node` and `@trytilde/sdk-vercel-ai-react`: Vercel AI SDK adapters.

Use `openbot auth`, `openbot state`, `openbot tunnel`, and `openbot plugin`; there is no separate
Tilde CLI or plugin package. SDK packages version independently from OpenBot's fixed package group.
Run `openbot sdk refresh` after an intentional Tilde OpenAPI change.

Use `pnpm openbot secrets set NAME --description "Purpose"` and `pnpm openbot secrets unset NAME` to maintain encrypted values without learning SOPS commands. Every secret is stored as `{ description, value }`; SOPS leaves the description readable and encrypts only `value`. Setting a value requires a current SOPS release with `set --value-stdin` support so plaintext never appears in the process list. Use `pnpm openbot env set NAME VALUE --description "Purpose"` and `pnpm openbot env unset NAME` for plaintext configuration; descriptions are rendered as comments immediately above assignments.

Commit `configuration/index.ts`, `.sops.yaml`, and `secrets.enc.yaml` after initialization. Never commit `configuration/.env` or root `local-user-config.json`. The latter stores this checkout's SOPS owner lookup metadata under `sops` and is gitignored. Interactive SOPS-backed commands such as `dev`, `deploy`, and secret mutation configure it inline when it is absent; non-interactive commands fail with instructions to rerun interactively. The sandbox age private key is encrypted as `SECRETS_SOPS_AGE_KEY.value`. Trusted-sandbox deployment refreshes `.env`, `.sops.yaml`, and `secrets.enc.yaml`, installs the identity as a mode-`0400` file readable only by the sandbox Linux user, and sources a loader from `.bashrc` and `.bash_profile` to export dotenv and decrypted SOPS values.

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
- `tilde-cloud` uses the same Vercel service and Sandbox implementations behind Tilde's hosted control plane. A single Tilde API request creates a dedicated team, projects, OIDC-backed AI Gateway access, persistent Computer, and deterministic Vercel project hostname. Custom Cloudflare DNS is a follow-up. Its `LocalGitProvider` keeps the writable fork and bare origin entirely under the Computer's ignored `.openbot/` directory. Tilde retains its Vercel credential exclusively in the deployment worker; OpenBot publishes content-addressed prebuilt releases through a team-scoped Tilde capability.
- `local` builds separate control and agent Hono servers, writes private service environments, and installs two user-level systemd services on Linux or launchd agents on macOS. Development still hosts control and agents in one Hono process.
- `exe-dev` runs the consolidated watched runtime and host-native Computer continuously on
  one persistent exe.dev VM. Deployment sizes the VM, publishes Vite through exe.dev HTTPS,
  installs the complete fork configuration in a private service environment, and supervises
  `pnpm dev` with systemd user linger. Code Storage supplies the repository remote using only a
  repository-scoped JWT after transient organization-key setup.

`--dry-run` performs native checks, writes local build artifacts, and calls the read-only `plan()` lifecycle. It does not link projects, publish Vercel deployments, or start services. Use `--skip-deploy` when only the artifacts are wanted and no deployment plan is needed.

The production build stages the web app in the control provider's `.vercel/output/static` artifact for Vercel's CDN and deploys its provider-owned Hono Function for `/healthz` and `/api/*`.

## Current application boundary

- `cli` owns the React Ink `openbot` CLI: operator commands, development process supervision, provider deployment coordination, and the developer workflow — repository gates, Expo runs across local and remote mac/Linux hosts, headless emulators, ssh tunnels, and toolchain doctor — for humans and sandboxed agents alike.
- `packages/api-client` and `packages/sdk*` own the public Tilde TypeScript integration surface and remain usable outside OpenBot; coding-agent plugin setup belongs to `openbot plugin`.
- `packages/runtime-provider` owns the optional provider deployment contract and runtime-last coordinator.
- `packages/control-service-provider` owns local and Vercel control/web builds and deployment.
- `packages/agent-service-provider` owns Eve-compatible agent-directory discovery, instrumentation startup, concurrent per-agent Vercel bundles, the local agent server, and deployment.
- `apps/web` owns the workspace, agent selection, conversation composer, and frontend routes.
- `apps/mobile` owns the Expo and React Native owner surface for authentication, sidebar navigation, and regular chat, built on BNA UI components copied into `apps/mobile/src/components/ui`.
- `packages/client-runtime` owns grouped UI contracts, Tilde REST/SSE parsing, live-event reducers, and shared Zustand vanilla state without platform APIs. Every major UX surface and state interaction goes through it; renderers keep only presentation-only state.
- `apps/control-service` owns the portable Hono application, built web UI fallback, `/healthz`, the allowlisted Tilde ChatKit REST/SSE bridge under `/api/chat/*`, and the local control-service entrypoint.
- `packages/computer-service-proto` owns the API-key-protected internal computer API.
- `packages/git-provider` owns brokered GitHub access: the Tilde-managed GitHub App credential and the REST and git-over-HTTPS reverse-proxy profiles used by the trusted development sandbox and the factory agent.
- No control database is retained while the reset application has no persisted control state.
- Each domain provider package owns both its TypeScript contract in `src/core.ts` or `src/core/index.ts` and its concrete adapters; provider contract interfaces never live in adapter modules or the package-root entrypoint, and they are not RPC surfaces.

```bash
pnpm check
pnpm build
pnpm test:e2e
```

OpenBot is MIT licensed. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [PROVENANCE.md](PROVENANCE.md).
