# OpenBot — AGENTS.md

OpenBot is a TypeScript monorepo for a local or Vercel-hosted agent workspace. It combines a React/Vite web app, Electron desktop shell, Hono and ConnectRPC services, provider adapters, Tilde ChatKit, and local or Vercel sandboxes.

## Start here

1. Read this file, `README.md`, and `CONTEXT.md`.
2. Inspect `git status --short --branch`; preserve unrelated work.
3. Read the owning package and its tests before editing.
4. Read relevant records under `docs/adrs/` before changing a recorded decision.
5. Use `.agents/skills/<name>/SKILL.md` for repository workflows. Runtime skills under the primary `configuration/agent/skills/` or a `configuration/agent/subagents/<id>/skills/` directory serve that OpenBot agent, not the coding-agent process.

## Toolchain and commands

- Node.js 24, pnpm 10, TypeScript ESM, strict mode.
- Use repository-pinned tools through `pnpm`; do not install global substitutes.
- Do not hand-edit generated files under `packages/computer-service-proto/src/gen/` or `apps/web/src/routeTree.gen.ts`.

```bash
pnpm install
pnpm dev
pnpm check
pnpm build
pnpm test
pnpm test:e2e
pnpm --filter @tryopenbot/desktop package
```

Run focused package tests while iterating:

```bash
pnpm --filter openbot test
pnpm --filter @tryopenbot/control-service test
pnpm --filter openbot test
```

## Repository map

- `cli`: React Ink repository CLI; command entrypoints live under `cli/src/commands/`, while shared process, environment, initialization, and UI helpers remain at `cli/src/`.
- `apps/web`: React 19, Vite, TanStack Router, and a direct Tilde ChatKit REST/SSE client through the same-origin bridge.
- `apps/control-service`: Hono HTTP routes, the allowlisted Tilde ChatKit REST/SSE bridge, and the local control-service entrypoint.
- `apps/desktop`: Electron main/preload shell and packaged local server.
- `apps/computer-service`: API-key-protected ConnectRPC service inside computers.
- `packages/agent-provider`: aggregate external agent, authored-skill, registry, MCP, and tool-resource reconciliation lifecycle.
- `packages/inference-provider`: inference-account initialization and credential provisioning; never an authored-agent model factory.
- `packages/computer-tools`: typed Vercel AI SDK tools that call computer-service; this is a runtime utility, not a provider.
- `packages/configuration`: typed contract for the fork-owned composition root.
- `packages/utilities`: shared utilities, including strict Handlebars rendering for generated source, configuration, service, and deployment files.
- `configuration`: fork-owned Eve-compatible agent directories, future-agent templates, provider composition, and provider plugins.
- `packages/runtime-provider`: shared build and phased deployment contracts and coordinator.
- `packages/control-service-provider`, `packages/agent-service-provider`: independent local and Vercel service artifacts and deployment.
- `packages/ui`: shared React UI and vendored Beautiful UI components.
- `scripts/`: non-interactive build helpers that do not belong to the operator CLI.
- `docs/adrs`: concise records of durable architecture, code, and product design decisions.

## Architecture rules

### API and contracts

- Preserve Tilde's native REST/SSE shapes for owner chat through the allowlisted same-origin bridge.
- Keep Hono routes for protocol-native HTTP surfaces: setup unlock, ChatKit compatibility, signed Tilde callbacks/tools, and health.
- Edit `packages/computer-service-proto/proto/openbot/computer/v1/computer.proto` for the internal Computer API, then run `pnpm contracts:generate`.
- Keep handlers thin: validate input, authorize, call the owning provider/store, map to protobuf or HTTP response.
- Preserve Web-standard `Request`/`Response` behavior so the same server works locally and in Vercel Functions.
- Preserve raw request bodies and webhook verification on signed Tilde routes.

### Providers

- Providers exist only for initialization and external provisioning or check/build/deploy lifecycles. Remove interface methods without one of those consumers; do not preserve speculative generic APIs.
- The Agent Provider owns the complete external footprint of each authored agent. Keep skills, registries, MCP servers, and external tool reconciliation as cohesive internal modules rather than separately configured provider roles.
- Code under `configuration/agent/`, including its `subagents/`, must not import provider packages or provider composition. Integrate model, tool, prompt, and vendor SDK behavior directly in the authored agent; Composio and other direct integrations do not require a provider abstraction.
- Providers must not expose model factories, prompt injection, AI SDK tool registration, or arbitrary vendor-specific convenience functions for authored agents. Put non-provider runtime utilities in a purpose-specific package such as `computer-tools`.
- Inference providers may provision gateway accounts and credentials, but authored agents still import AI SDK providers directly.
- Define provider contracts in `core.ts` or `core/` inside the owning provider package and keep implementations beside them. Do not expose internal provider interfaces over RPC by default.
- Use the `implement-provider` skill whenever adding or editing a provider implementation.
- Keep small implementations in `<provider>.ts`. When one owns multiple responsibilities or runtime files, use `<provider>/index.ts`, cohesive subfiles, and `assets/`.
- Store generated-file sources as `*.hbs` assets, not TypeScript strings. Provider build and deploy lifecycles render them through `@tryopenbot/utilities` into ignored artifacts; runtime persistence and user-supplied bytes remain byte-preserving data.
- Pass `ProviderCallContext` through calls so cancellation, deadlines, request IDs, and idempotency remain available.
- Convert provider-specific failures to `ProviderError` at the adapter boundary.
- Keep provider selection in composition code, not UI branches.
- Construct concrete providers explicitly under `Configuration({ providers: { ... } })` in `configuration/index.ts`; provider packages must not export string-to-provider selector factories or descriptors.
- When provider composition changes, inspect `configuration/templates/agent/` and keep future agent wiring aligned; migrate existing agents explicitly when needed.
- Add focused contract tests for each adapter change.
- Treat every lifecycle hook as idempotent. Repeated `check`, `build`, `plan`, `configure`, and `deploy` calls must converge without duplicate resources. Keep vendor reconciliation and configuration persistence inside provider implementations; the CLI only schedules hooks. Deployment results contain named handoff outputs only.

### Web and desktop

- Keep server state behind Connect clients and TanStack Query; avoid duplicating control state in the renderer.
- Reuse `packages/ui`; keep direct Beautiful UI modifications documented in its provenance files.
- Electron renderer must not gain direct Node.js access. Keep privileged work in main/preload with a narrow bridge.
- Preserve same-origin proxying between packaged web assets and the local control server.

### Tilde and AI runtime

- Use the canonical Tilde skill and `https://trytilde.ai/llms.txt` for current Tilde behavior.
- Keep ChatKit webhook verification, history conversion, streaming, and credentials server-side.
- Reconcile Tilde resources through the typed API client inside idempotent provider lifecycles. OpenBot does not use a Tilde state file during normal operation; operators may use the Tilde CLI directly for one-time team-to-team state migration.
- Do not guess Tilde identifiers or expose one-time API/webhook keys.
- The agent loop uses Vercel AI SDK. Verify current SDK signatures before changing them.
- Agent model, MCP, skill, and other external integrations are ordinary authored code. Keep the matching defaults in `configuration/templates/agent/`; migrate existing agents explicitly.
- The full primary agent lives at `configuration/agent/`; full additional agents live at `configuration/agent/subagents/<id>/`. Nested subagents are unsupported. Follow ADR-0011 for their identical Eve-compatible subset, ChatKit entrypoint, instrumentation ordering, and one-time `/workspace/<id>` seeds on the shared computer.
- Keep `sandbox/workspace/` as the sole Eve-compatibility naming exception. Use Computer in runtime APIs and require each agent's standard Computer tools to import `@tryopenbot/computer-tools`, which calls the typed computer-service API with that agent's fixed ID.

### Sandboxes

- Linux with KVM and Apple Silicon use Microsandbox by default; Intel macOS or explicit remote mode uses Vercel Sandbox.
- Ordinary agent Computers must not receive control-plane credentials. The trusted development sandbox is the explicit exception: deployment refreshes its complete `configuration/.env`, `.sops.yaml`, and encrypted secrets, plus a user-readable-only age identity.
- Preserve capability checks in `apps/computer-service` and provider implementations.
- Execute agent computer-tool requests through `apps/computer-service`; validate `agent_id` there and map it to the registered Linux user and private `/workspace` mount.
- Keep one Computer while giving each agent a computer-service-owned virtual display and browser profile. Display routing is not process, filesystem, network, or authorization isolation. Owner preview stays behind the narrow control-service preview route.
- Treat browser profiles, screenshots, and sandbox files as sensitive user data.

### Fork files

- Repository resources use fixed paths, not `OpenBotConfiguration` options: the primary agent in `configuration/agent/`, additional agents in `configuration/agent/subagents/<id>/`, future-agent templates in `configuration/templates/agent/**/*.hbs`, agent-local skills and workspace seeds inside either full agent directory, and custom providers in `configuration/providers/`. Global `configuration/skills/` and `configuration/sandbox/` directories are unsupported.

## Local development

`pnpm dev` delegates to `openbot dev`, loads `.env.local`, generates contracts, and starts the watched Hono app, web app, and Electron when available.

- Default web URL: `http://127.0.0.1:4173`.
- Default control server: `http://127.0.0.1:4100`.
- Use `NO_DESKTOP=1` for headless work.
- Use `SANDBOX_PROVIDER=vercel-sandbox` when local KVM is unavailable and remote credentials are configured.
- Do not expose generated setup codes or files under `.data/`.

## Security

- Never print, commit, or paste `.env.local`, `.openbot-deploy/`, setup codes, API keys, webhook keys, database tokens, or browser session data.
- Keep tracked environment files as sanitized examples only.
- Validate paths and capabilities before file, process, or desktop operations.
- Ask before destructive actions, external publication, paid changes, production deployment, or resource deletion.

## Validation

Use the narrowest useful check first, then broaden by risk:

1. Focused package test.
2. `pnpm check`.
3. `pnpm build`.
4. `pnpm test:e2e` for changed browser workflows.
5. Desktop packaging for Electron changes.

For browser-visible changes, verify the real route, console, network, and visible state. Store ad hoc artifacts outside the repository. Do not commit Playwright output, screenshots, videos, traces, HAR files, `.data/`, `.vercel/`, or deployment state.

## Deployment and delivery

- Production deployment uses `pnpm deploy:prod -- --dry-run --json`, then `pnpm deploy:prod -- --yes` only when explicitly requested.
- The deploy script coordinates Vercel, Tilde API reconciliation, encrypted environment, Sandbox snapshot, and smoke tests. Do not replace it with a raw production deploy.
- Commit, push, open a PR, merge, or deploy only when requested.
- Before creating or updating a PR, always review the full diff for major architecture, strongly opinionated code, or durable code/product design decisions. If found, pause and prompt the user through an ADR under `docs/adrs/`; do not silently invent or skip the decision.
- Keep ADRs concise. Start with caveman-style `In brief` bullets and add a small Mermaid diagram when it clarifies a real relationship or flow. When amending a governing ADR, append a chronological ISO-8601 timestamped bullet under `Updates` and preserve older entries.
- Before handoff, review the diff for secrets, generated noise, unrelated changes, and the exact checks run.

## Relevant skills

- `pre-commit-checks`: validation before commit or handoff.
- `create-pr`: commit, push, and draft PR workflow.
- `add-changeset`, `setup-changesets`: unified workspace version notes and release automation.
- `add-api-endpoint`: Hono or ConnectRPC endpoint changes.
- `e2e-debug-and-qa`: running browser evidence.
- `diagnose`: evidence-led debugging.
- `implement-provider`: provider implementation structure, assets, lifecycles, and tests.
- `edit-openbot-configuration`: fork-owned composition, custom providers, and future-agent templates.
- `vercel`, `tilde`: platform-specific work.
- `safe-refactor`, `surgical-patch`, `migration`, `lean-build`, `verify-and-stop`: scope-specific engineering workflows.
