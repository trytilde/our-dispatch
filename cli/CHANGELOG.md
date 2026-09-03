# openbot

## 1.0.0

### Minor Changes

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a standalone `AgentAvatar` entry with component-scoped styles for applications that do not use the complete OpenBot interface.

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add agent-owned context compaction with durable ChatKit lifecycle reporting and restart-safe handoff summaries.

- [`1e67339`](https://github.com/trytilde/dispatch/commit/1e67339f075e71601e1966b32efade7197100b17) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add guarded, idempotent agent deletion and an end-to-end agent lifecycle production evaluation.

- [`cd77f24`](https://github.com/trytilde/dispatch/commit/cd77f24613ac272843fe68d7493d3ccefac2a35e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add agent-centric chat workspaces with rich streamed messages and isolated live Computer desktops per agent.

- [#120](https://github.com/trytilde/dispatch/pull/120) [`db20bc5`](https://github.com/trytilde/dispatch/commit/db20bc531bb246b3962a79e2d7c58a1d6620a0a3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add automatic memory recall, owner-managed facts, and a least-privilege Memory Catcher synthesizer to OpenBot bots.

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add session-bound goal and task management APIs and default agent tools for durable work tracking.

- [`ff913c3`](https://github.com/trytilde/dispatch/commit/ff913c375a8dd607cb45df6844981ea4446ae77c) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Move repository operations into the React Ink CLI and make it own local Hono startup.

- [#71](https://github.com/trytilde/dispatch/pull/71) [`983eb35`](https://github.com/trytilde/dispatch/commit/983eb352c39fee4fabfe45116b4ee9dcda4c5c28) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add optional local and Vercel-hosted ChatGPT subscription inference with Codex device-code authentication, provider-owned agent templates and deployment assets, AI SDK 7 support, resumable staged init selectors that immediately configure the selected provider while offering every built-in alternative, checkout-scoped gitignored user configuration, and correct separation of provider-managed and team-owned Tilde registry membership.

- [#115](https://github.com/trytilde/dispatch/pull/115) [`3c85b64`](https://github.com/trytilde/dispatch/commit/3c85b6488802a0e3f002311949fe40d42dbe824a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add Codex, Claude Code, and Cursor hook adapters that record searchable ChatKit messages and canonical tool executions while `openbot plugin` installs Tilde MCP servers and skills.

- [#66](https://github.com/trytilde/dispatch/pull/66) [`b9a66cb`](https://github.com/trytilde/dispatch/commit/b9a66cba146cccfc971589b6149603f4085edb3e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Make Cua Driver the Computer's programmatic GUI backend, expose its runtime catalog as direct local tools, and reconcile canonical and OpenBot computer-use skills for every agent.

- [#60](https://github.com/trytilde/dispatch/pull/60) [`c906650`](https://github.com/trytilde/dispatch/commit/c9066502f26eda728d1c2c67be9ace4e979ee775) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add `openbot desktop release` and a manually triggered desktop release workflow. Desktop artifacts publish to the shared updates bucket under a fork-guarded prefix with a `version.json` update manifest, and macOS builds are signed and notarized when credentials are present.

- [#48](https://github.com/trytilde/dispatch/pull/48) [`2e56350`](https://github.com/trytilde/dispatch/commit/2e56350137c8804597a8877d1c5b527221c97a51) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add the developer workflow to the `openbot` CLI for humans and sandboxed agents working on the codebase. Repository gates `e2e` and `desktop package` join `check`, `build`, and `test`; a `mobile` command group carries Expo runs with the Android and Node toolchain resolved, an idempotent headless emulator with loopback VNC, SDK setup, AVD creation, screenshots, logs, and doctor; `connect` and `remote` reach fork-configured mac and Linux dev hosts over ssh. Root scripts adopt a verb:target taxonomy (`dev:mobile:*`, `connect`, `dev:remote`, `doctor`).

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add high-level durable background-agent job helpers and a default authored tool for delegating, inspecting, steering, stopping, resuming, and collecting child work.

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a durable AgentRun host with continuation limits, budget enforcement, restart recovery, and side-effect receipts.

- [#69](https://github.com/trytilde/dispatch/pull/69) [`206e39f`](https://github.com/trytilde/dispatch/commit/206e39f523fa2dd5421ab643d58f02ed9dedb8f3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Run new-agent setup durably in the trusted development Computer and resume its progress after navigation or reload.

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Expose durable goals, tasks, background jobs, and routines through the shared web/Electron Work pane and teach default agents when to plan, delegate, steer, and schedule recurring work.

- [`d0aaada`](https://github.com/trytilde/dispatch/commit/d0aaada9ff5c00faba2063410b0fd42855951bda) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add interactive encrypted configuration initialization and provider-defined onboarding questions.

  Build and deploy control and agent services as independent artifacts with native TypeScript checks, concurrent per-agent Vercel functions, and separate local services.

  Keep deployment entrypoints, platform configuration, and service templates as provider-owned assets that are materialized by build and deploy lifecycles.

  Provision the trusted development sandbox with the fork environment, encrypted secrets, a user-readable-only age identity, and automatic Bash-profile loading.

  Use one full primary agent at `configuration/agent/` and scaffold equally complete additional agents under `configuration/agent/subagents/<id>/`.

  Provision a named Vercel AI Gateway key during initialization and default authored agents to GPT-5.6 Sol with medium reasoning through AI SDK's built-in Gateway model routing.

  Carry `devMode` through every lifecycle hook. Development skips Vercel service deployment, keeps Tilde reconciliation and local endpoint tunneling active, delegates Vercel Sandbox to Microsandbox, and rebuilds and replaces the local Computer when image inputs change.

  Attribute lifecycle failures to their concrete provider implementation and domain, and print complete redacted CLI error stacks with cause chains by default.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a single-VM exe.dev runtime with a host-native Computer, trusted development mode, public noVNC routing, and repository-scoped Code Storage Git with optional GitHub sync.

- [#57](https://github.com/trytilde/dispatch/pull/57) [`6a328b0`](https://github.com/trytilde/dispatch/commit/6a328b0e62e55a3be382c18785e51194d6062914) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Replace the Hello World primary agent with the Factory agent and give it an end-to-end build/test/deploy loop. A new `@tryopenbot/git-provider` derives the fork repository from the checkout's origin remote, brokers a GitHub App credential through Tilde, and reconciles GitHub REST and git-over-HTTPS reverse-proxy profiles; the trusted development sandbox attaches its seeded source tree to the owner's fork through that proxy so the factory agent has an authenticated git client without holding a token. The factory agent's computer tools target the development sandbox, its skills cover creating, locally testing (Tilde local-runtime tunnel), and deploying agents, and the primary agent additionally receives the brokered GitHub toolkit on its MCP server. A background orchestrator (`openbot orchestrate`) owns the lifecycle: edits route every agent through the local-runtime tunnel with hot reload, and settled edits are verified, published to the openbot/sandbox-edits branch, and redeployed automatically. Every subagent can edit its own source in the development sandbox, and the web workspace's New Agent entry scaffolds, registers, and opens a chat with the agent itself.

- [#123](https://github.com/trytilde/dispatch/pull/123) [`25563d9`](https://github.com/trytilde/dispatch/commit/25563d961711e4745d0817c8ed1e353130ff6e80) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add AI-credit reservation and receipt APIs, meter managed project-OIDC model calls with durable AgentRun effect recovery, release authoritative BYOK receipts, and exclude direct-key and subscription-backed inference.

- [#65](https://github.com/trytilde/dispatch/pull/65) [`0a4c682`](https://github.com/trytilde/dispatch/commit/0a4c682b49c7a72b08d34851d7e53d3cbf0f64d0) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Bots configure their own connectors from chat. The new `configure_connector`
  agent tool renders an in-chat account picker on web, desktop, and Expo;
  new-account credential setup posts to owner-authenticated `/api/connectors`
  routes so secrets never enter the transcript; brokered OAuth returns land on
  `/connectors/authorized` and hand back to the agent automatically. The agent
  reconciler now maps every Tilde control-plane function onto each agent's MCP
  server, namespaces Tilde skill names per agent, and agent templates ship the
  tool plus eight Tilde platform skills. Modal overlays are URL-routable via
  workspace search params.

- [`1f926b5`](https://github.com/trytilde/dispatch/commit/1f926b569f4f30679b322c769a465c4c377c607b) Thanks [@danielblignaut](https://github.com/danielblignaut)! - <!-- # DO NOT UPSTREAM -->
  <!-- #reason: Fork-only release note for the private trytilde/api submodule workflow. -->

  Add `openbot dev --local-tilde-api [ORIGIN]` with private submodule initialization and supervised `make dev` startup.
  <!-- #END DO NOT UPSTREAM -->

- [#118](https://github.com/trytilde/dispatch/pull/118) [`8e98d8f`](https://github.com/trytilde/dispatch/commit/8e98d8f28ebbe4e0339b2e95641a0d85dc5aed2e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Show participant joins and leaves as lightweight session activity while keeping them out of the message transcript.

- [#70](https://github.com/trytilde/dispatch/pull/70) [`8fb0d80`](https://github.com/trytilde/dispatch/commit/8fb0d809f1eef9cac06d569d0ed0a223de4f6dbf) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add the initial settings catalogue for browsing and assigning tools and skills to bots.

- [`07fd4db`](https://github.com/trytilde/dispatch/commit/07fd4dbda7e9cd4bffe61e946c52dce1aff1b32b) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add `openbot eval` to measure production answers, delegated Computer work, and self-cleaning routine lifecycles with machine-readable latency and tool-call results.

- [#121](https://github.com/trytilde/dispatch/pull/121) [`848f821`](https://github.com/trytilde/dispatch/commit/848f821b87f161521a3b862379f27c2a7cc398c9) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add durable human-reviewed self-extension proposals and a propose-only default agent tool.

- [`380fbc5`](https://github.com/trytilde/dispatch/commit/380fbc56314485d94b1f8b51296fb854e2bb1550) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Represent shared Tilde and Vercel access as concrete platform implementations, centralize their common request and deployment helpers, initialize each once across its dependent providers, and allow init to revisit existing provider configuration with stored prompt defaults. Load fork-owned TypeScript configuration through the standalone CLI's TypeScript loader so generated `.js` specifiers resolve their `.ts` sources.

- [#122](https://github.com/trytilde/dispatch/pull/122) [`b4bbd3a`](https://github.com/trytilde/dispatch/commit/b4bbd3a405466ff6d7a5883872b8da75dc654b66) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add opt-in speaker-bound personal tool federation for shared ChatKit agents.

- [#84](https://github.com/trytilde/dispatch/pull/84) [`1f70986`](https://github.com/trytilde/dispatch/commit/1f70986751bc83eb87eb110de794bb24ee76318e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add the Tilde Cloud runtime, managed Vercel credential boundary, persistent sandbox-local Git provider, managed owner identity files, and project-scoped OIDC access to Vercel Sandbox and AI Gateway.

- [`2b0d90c`](https://github.com/trytilde/dispatch/commit/2b0d90c5ebbc457a2cfe2badafa7ad30dd0cb0e4) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add team-scoped Tilde sign-in, browser sessions, and secure desktop token refresh for OpenBot installations.

- [`19dc06a`](https://github.com/trytilde/dispatch/commit/19dc06a9b02343fee33f071c7baa3072d6b33570) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Provision each authored agent through Tilde's durable Agent Resource Bundle API with a stable machine-user profile, uploaded avatar, default memory bank, safe credential rotation, and human-owned creation followed by machine reconciliation.

- [`c75b77d`](https://github.com/trytilde/dispatch/commit/c75b77d4c8f1940a5ce787a6e3c03e32b9abd659) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Collapse Tilde agent, skill, registry, MCP, and tool reconciliation into one `AgentProvider` lifecycle, and replace the owner-facing Chat Provider and ConnectRPC projection with the native Tilde REST/SSE bridge.

- [`a79856f`](https://github.com/trytilde/dispatch/commit/a79856fadab1916105edc8a1ce990f373cd9c1e4) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Use native Tilde plugin, connector, routine, and signal resources through one authenticated allowlisted bridge, and remove the corresponding control-service route APIs.

  Plugin inventory now pages Tilde's native MCP, skill, provider, and registry collections directly; it no longer depends on Tilde's OpenBot-specific aggregate catalogue or its first-page limit.

  Routines now consume Tilde's native trigger/version contract, and signal history uses native trigger IDs while accepting legacy rule IDs during the migration window. Signal provider and instance inventories follow every continuation token.

  Development agent creation retains the completed source-generation result until asynchronous Tilde bundle provisioning becomes active, so queued provisioning no longer turns the next status poll into “job not found”.

  Fresh installations and future agents now explicitly select ChatKit `agentLoop` response mode, matching the required SDK endpoint contract.

  The ChatKit credential bridge now permits only the workspace, queue, observation, and attachment operations used by Client Runtime instead of forwarding the complete ChatKit namespace.

  Migration:

  - Replace direct calls to `/api/plugins`, `/api/connectors`, `/api/routines`, and `/api/signals` with `@tryopenbot/client-runtime`.
  - Replace `registerConnectorRoutes` with `registerConnectorAuthorizedRoute` when constructing a custom control service.

- [#116](https://github.com/trytilde/dispatch/pull/116) [`ee6dc62`](https://github.com/trytilde/dispatch/commit/ee6dc622b6b5078bfa1306b19e0c41057e473b81) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add OpenCode and Gemini CLI adapters that record searchable ChatKit messages and canonical tool executions while `openbot plugin` installs their native audit integrations.

- [#80](https://github.com/trytilde/dispatch/pull/80) [`e8df3ca`](https://github.com/trytilde/dispatch/commit/e8df3cab93505bb092ee426c539175f9525d60f8) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add bot-scoped tool and skill management, durable live conversation activity, atomic bot setup presentation, and an Electron Computer preview to the owner workspace.

- [`f73d6b8`](https://github.com/trytilde/dispatch/commit/f73d6b8b5742f7d9f0f5c8534a164c46b9b904a4) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Give Computer a fixed Tilde MCP server, remove stale non-system mappings, and expose only its local CUA tools to the model.

- [`3c03ef1`](https://github.com/trytilde/dispatch/commit/3c03ef1364269165c4075b730cf5d990946e60e8) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a consolidated OpenBot runtime deployment, direct secure ChatKit workspace streaming, persisted unified routines, and bulk tool assignment.

- [`d6f9091`](https://github.com/trytilde/dispatch/commit/d6f90912c7e66b8df710b5aa0013fa764ce55851) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Consolidate provider contracts into their owning packages and add isolated agent workspaces plus a trusted, SOPS-capable development sandbox deployment.

- [#59](https://github.com/trytilde/dispatch/pull/59) [`39ceb4b`](https://github.com/trytilde/dispatch/commit/39ceb4b4947b60d024115aee0a1c7d9f2deb6010) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add `openbot desktop dev` and `openbot desktop package`, and make the Electron shell runnable on a display-less host. Desktop renders to its own virtual screen on display `:2` with loopback VNC on 5901, separate from the Android emulator's `:1` and 5900 so both run at once; `openbot connect` forwards both screens, and `openbot remote <host> desktop` and `desktop-package` run them on a configured host. Also builds unbuilt workspace dependencies before starting Expo, so a fresh clone no longer fails Metro bundling with `Unable to resolve "@tryopenbot/client-runtime"` when its `dist` is missing.

- [#60](https://github.com/trytilde/dispatch/pull/60) [`6c81cb8`](https://github.com/trytilde/dispatch/commit/6c81cb86ffa00a966cf13a17b7ebe41ab9e0542b) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Name the desktop identity for its publisher too: the Electron `appId` moves from `dev.openbot.desktop` to `ai.trytilde.openbot`, matching the mobile identifier, and resolves from the same `OPENBOT_APP_ID` a fork already sets for Expo. Done before the first signed release, after which the identifier is baked into every signed artifact.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a persistent exe.dev single-VM runtime with Code Storage deployment, host Computer desktops, and explicit reconciliation recovery controls.

- [#76](https://github.com/trytilde/dispatch/pull/76) [`52cce4c`](https://github.com/trytilde/dispatch/commit/52cce4ccda162f64cbd5ac4e74e6fa784138dce7) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Expose the authenticated owner's display name, avatar, organization, and workspace through the shared session contract.

- [`c7927b4`](https://github.com/trytilde/dispatch/commit/c7927b43a71551b8a4d4428a7528ecf650b399e8) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add the complete reusable OpenBot workspace component system, exact light palette, motion curves, agent identity artwork, continuous chat composition, rich message content, activity surface, and Computer pane to `@tryopenbot/ui`.

- [#73](https://github.com/trytilde/dispatch/pull/73) [`a6a7913`](https://github.com/trytilde/dispatch/commit/a6a791320bfbd636f92ee658b58a27cb1d20cefc) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Move the Tilde TypeScript SDK into the OpenBot monorepo under the `@trytilde/sdk*` package names and add Tilde authentication, state, tunnel, plugin, and SDK workflows to `openbot`.

  Migration:

  - Replace `@trytilde/harness-sdk*` imports with the corresponding `@trytilde/sdk*` package.
  - Replace `@trytilde/harness-plugins` and coding-agent wrapper binaries with `openbot plugin`.
  - Replace `tilde auth|state|tunnel` with `openbot auth|state|tunnel`.

- [`26d0e7a`](https://github.com/trytilde/dispatch/commit/26d0e7abbd7c99decd17fbe961dc62943320720e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add one fork-owned `configuration/` tree for directly authored Vercel AI SDK-compatible agent endpoints, agent-scoped skills and workspace seeds, and provider integrations, with an interactive terminal CLI for setup and operation. Concrete implementations are grouped under `Configuration({ providers: { ... } })`; repository resources use canonical file locations instead of configurable paths. OpenBot discovers committed agent modules without generating or publishing TypeScript at runtime.

- [#129](https://github.com/trytilde/dispatch/pull/129) [`d677077`](https://github.com/trytilde/dispatch/commit/d677077954370423a77502f24199bbdacbae76ae) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Meter Memory Catcher synthesis through durable hosted inference billing.

- [#96](https://github.com/trytilde/dispatch/pull/96) [`1784f6c`](https://github.com/trytilde/dispatch/commit/1784f6cc0b4552eb11b615b82d71e2190e7ba2e6) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Migrate OpenBot to Tilde's regular ChatKit activity, agent, session, message, search, turn, and realtime-ticket REST routes while preserving the ChatKit realtime contract.

  Migration:

  - Replace `OpenBotClient.getBootstrap` with `OpenBotClient.getActivity`.
  - Read the agent page from the activity response's `activity` field.

- [#63](https://github.com/trytilde/dispatch/pull/63) [`608839d`](https://github.com/trytilde/dispatch/commit/608839db733e8c5b023ca13087ffea0c8970cc83) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add shared queued-turn controls and native owner-client parity for onboarding, rich chat, attachments, and Computer takeover.

- [`a1aecaf`](https://github.com/trytilde/dispatch/commit/a1aecaf7f691a6f4fff4f79905b57171ab4ad506) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Separate chat APIs from agent provisioning, remove unused model-facing provider
  hooks, and keep authored agents independent through direct SDK integrations and
  non-provider runtime helpers.

- [#59](https://github.com/trytilde/dispatch/pull/59) [`7f08497`](https://github.com/trytilde/dispatch/commit/7f0849739fadcb51e858b984b8b843b8e85ae7e8) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add store publication for the official OpenBot app through EAS. `openbot mobile release build|submit|status|credentials` drives `eas-cli`, requires an explicit `--yes` before spending build minutes or changing a public listing, and refuses to use the official EAS project from any remote other than `trytilde/dispatch`. `apps/mobile/app.json` becomes `app.config.ts` so a fork can point at its own EAS project, bundle identifier, and Expo owner through the environment rather than editing a tracked file. Recorded in ADR-0027.

- [`bd417b1`](https://github.com/trytilde/dispatch/commit/bd417b1d7bb0327c031cc4c11a05dfc11f5cb917) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Publish all OpenBot workspace packages publicly with runnable JavaScript artifacts and declarations, and provide `openbot` as an installable standalone CLI.

  Refresh selected AWS profile credentials through AWS CLI before SOPS operations so IAM Identity Center sessions work during initialization and later secret access.

  Support AI agents and automation with non-interactive initialization through stable JSON answers on stdin and machine-readable JSON results.

  Migration:

  - Replace the internal package name `@tryopenbot/cli` with the public `openbot` package.
  - Invoke the installed CLI with `openbot <command>` or `npx openbot <command>`.

- [`c5df8df`](https://github.com/trytilde/dispatch/commit/c5df8df5e0244d45c80deba036ce780c94cfc3b8) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Reconcile authored agents, skills, tools, services, and Computers through idempotent provider lifecycles in development and deployment.

- [`a865749`](https://github.com/trytilde/dispatch/commit/a865749af593eabe061bb33d137338e17ed78216) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Refine the owner workspace into a continuous per-agent chat with the reference light palette, patterned agent avatars, message replies, file composition, and Tilde connector authorization cards.

- [#110](https://github.com/trytilde/dispatch/pull/110) [`251c0c0`](https://github.com/trytilde/dispatch/commit/251c0c01cb513e9f55168d69fb6977d8b17d9ad4) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Remove the paused Expo mobile client, Android/iOS tooling, EAS publication workflow, and `openbot mobile` command group from main. The complete implementation remains preserved on the `codex/mobile-archive` DO NOT MERGE branch.

  Migration:

  - Stop invoking `openbot mobile`, mobile root scripts, Metro/adb tunnels, or `mobile-v*` releases.
  - Use the web workspace or Electron desktop client while the product foundation is stabilized.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Replace the owner-chat transport with typed ChatKit workspace and realtime contracts, including per-user read state and explicit queue and turn lifecycle events.

- [`1e2084f`](https://github.com/trytilde/dispatch/commit/1e2084f0ac32beea9aa9c8293ca092f17af563a0) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Standardize generated source, configuration, service, deployment, and provider assets on strict Handlebars templates.

- [#68](https://github.com/trytilde/dispatch/pull/68) [`c2b115e`](https://github.com/trytilde/dispatch/commit/c2b115ec173991e6403cbd10fa9d408705b4862a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Replace the Computer's Openbox desktop with a focused XFCE session and permanent Files and browser launchers.

### Patch Changes

- [#147](https://github.com/trytilde/dispatch/pull/147) [`add92f5`](https://github.com/trytilde/dispatch/commit/add92f582f82ccd227615e87e4ec6e6dd551769a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Recognize Tilde's service-unavailable prefix on the retryable memory-binding checkpoint.

- [#106](https://github.com/trytilde/dispatch/pull/106) [`a200646`](https://github.com/trytilde/dispatch/commit/a2006462dc4963669cad3bc04f1192bcb2b4c763) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add canonical ChatKit registration and execution reporting for local Vercel AI SDK tools, including first-class dynamic child correlation, and enable it in generated OpenBot agents.

- [`1e8c974`](https://github.com/trytilde/dispatch/commit/1e8c9744676d92012f8fec41dc52793c896d2608) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Centralize graphical browser and desktop work in a CUA-only Computer specialist, with per-agent resource policies and delegated display provenance so callers keep their existing screen and browser profile.

- [`d8c3d20`](https://github.com/trytilde/dispatch/commit/d8c3d2011a8399db4979cab6a2da07c4d7709553) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add one-command provider lifecycle deployment with separate control and agent
  services on Vercel or local systemd and launchd runtimes.

- [#59](https://github.com/trytilde/dispatch/pull/59) [`3382853`](https://github.com/trytilde/dispatch/commit/338285340d98eb23d37247bc9febfd45aa1b66d3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Select the Android emulator system image by host CPU: `arm64-v8a` on Apple Silicon and `x86_64` elsewhere. `openbot mobile setup` and `openbot mobile avd` previously hardcoded `x86_64`, which has no hardware acceleration path on an Apple Silicon Mac and produces an unusable emulator.

- [#72](https://github.com/trytilde/dispatch/pull/72) [`ce97171`](https://github.com/trytilde/dispatch/commit/ce97171a95681822b4355540fb4f8469fe4969f9) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Bound concurrent Tilde skill and tool reconciliation while preserving input order and deterministic errors.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Build `@tryopenbot/ui` artifacts when the package is installed directly from Git.

- [#82](https://github.com/trytilde/dispatch/pull/82) [`a99315c`](https://github.com/trytilde/dispatch/commit/a99315c1731a87ec7850ec05c240b14459d84c8a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add atomic bulk MCP server function mapping methods and use one request when reconciling an agent's Tilde control-plane toolkit.

- [#59](https://github.com/trytilde/dispatch/pull/59) [`3382853`](https://github.com/trytilde/dispatch/commit/338285340d98eb23d37247bc9febfd45aa1b66d3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Check the Xcode version in `openbot mobile doctor` on macOS, reading the minimum from the installed React Native's CocoaPods helpers so it cannot drift from what `pod install` enforces. React Native 0.86 requires Xcode 16.1; below that, an iOS build fails partway through `pod install` with `Please upgrade XCode` rather than at the toolchain check. Passthrough command failures — `mobile expo`, `mobile logs`, the repository gates — also stop printing the run-log crash notice, because the child process has already reported the error.

- [`f464185`](https://github.com/trytilde/dispatch/commit/f4641858b43bcca8318495756f8e5bc17c8d79a4) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Connect the owner workspace to configured Chat Provider agents in local and deployed modes.

  Make Tilde initialization default to production, discover the global control-plane toolkit, and keep mixed age/KMS secret updates compatible with older SOPS and AWS SSO credentials.

  Provision the shared Tilde Vercel UI channel required by ChatKit workspace idempotently.

- [#59](https://github.com/trytilde/dispatch/pull/59) [`e148241`](https://github.com/trytilde/dispatch/commit/e148241b7520b7cc56a395d9835741c91bcca5f8) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Report compiler search paths that break Xcode module builds in `openbot mobile doctor`. A global `CPPFLAGS` pointing at Homebrew LLVM makes clang find an incompatible C standard library, so an iOS build fails inside the SDK's own modulemap with `found_incompatible_headers__check_search_paths` and a cascade of `could not build module 'Foundation'` that names neither the variable nor the shell. Doctor now names them; it does not change them, because the developer's environment is theirs to own.

- [#135](https://github.com/trytilde/dispatch/pull/135) [`892f44c`](https://github.com/trytilde/dispatch/commit/892f44c9ea8dae7b4776238689d7d7c7817d9def) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep the scoped Code Storage repository authoritative inside trusted exe.dev runtimes.

- [#77](https://github.com/trytilde/dispatch/pull/77) [`d6bee5c`](https://github.com/trytilde/dispatch/commit/d6bee5c23ee5d74d1c0ac3cf899fa052034d30cc) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep newly created bots on the local-runtime tunnel until their complete agent template is ready, reconcile independent Tilde resources concurrently behind a shared request ceiling, and keep managed skill and tool assignments idempotent.

- [#69](https://github.com/trytilde/dispatch/pull/69) [`206e39f`](https://github.com/trytilde/dispatch/commit/206e39f523fa2dd5421ab643d58f02ed9dedb8f3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep agent activity, streamed messages, previews, and unread state updating while another chat is active.

- [`20c5737`](https://github.com/trytilde/dispatch/commit/20c5737cffa4f165f023b3fdd7f7a59aaa26316e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep standalone `openbot dev` agent discovery rooted in the fork repository.

- [#59](https://github.com/trytilde/dispatch/pull/59) [`b16c8e0`](https://github.com/trytilde/dispatch/commit/b16c8e0360a8cf54680537af0591dc917f94d51d) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Report `openbot mobile doctor` failures as diagnostics rather than crashes. A missing tool no longer prints `OpenBot exited unsuccessfully` with a run-log path; the command keeps its non-zero exit code but owns its explanation. Doctor also gains a warning level, warns when the JDK major version is outside the Android Gradle Plugin's supported 17 and 21, names `openbot mobile setup` as the remedy on each failing Android tool check, and checks for CocoaPods on macOS.

- [`bb957cf`](https://github.com/trytilde/dispatch/commit/bb957cfdb8451f61480f0935273f1d9912522222) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep agent lifecycle evaluations checkout-clean when SOPS re-encrypts unchanged secrets.

- [`bdd224c`](https://github.com/trytilde/dispatch/commit/bdd224c65312cabb11348d3931181569ff5947d0) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Accept team-linked human and agent API keys on installation control surfaces, use installation authority for agent avatar reconciliation, and preserve untracked authored files while refreshing exe.dev source.

- [#117](https://github.com/trytilde/dispatch/pull/117) [`4261e8c`](https://github.com/trytilde/dispatch/commit/4261e8c45e93fd360ee0cdf2c1734cdb8eb0577d) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Switch an existing exe.dev checkout to the requested deployment branch before fast-forwarding it.

- [#145](https://github.com/trytilde/dispatch/pull/145) [`47d3725`](https://github.com/trytilde/dispatch/commit/47d372565423995def42543fff97753ab201e66f) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep exe.dev Code Storage reconciliation independent from non-exported environment fields.

- [#61](https://github.com/trytilde/dispatch/pull/61) [`165bfa2`](https://github.com/trytilde/dispatch/commit/165bfa2e2a50184f7899b1e466b3803ad1ed1acc) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Resolve the workspace root when the task runner starts the CLI inside a package, wait for the control service before dependent development traffic, and keep the computer image test independent of the fork's repository name.

- [`0c99101`](https://github.com/trytilde/dispatch/commit/0c99101c84c07441e1bb1eb94a684b7bb56872b1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Install initialized forks, resolve development packages from source, create Vercel image repositories automatically, and manage described secret and environment values through the CLI.

- [#88](https://github.com/trytilde/dispatch/pull/88) [`09f58c4`](https://github.com/trytilde/dispatch/commit/09f58c4f50abb18cc46c18b43245ff862b99eded) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Create agents in the checkout owned by a running local development lifecycle while preserving trusted-sandbox creation for deployed control services.

- [#45](https://github.com/trytilde/dispatch/pull/45) [`b10e4ca`](https://github.com/trytilde/dispatch/commit/b10e4ca458c43bb36783770c68d9ab77bb7c4db8) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep local browser authentication on the Vite origin and reconcile loopback OAuth callbacks during development.

- [#138](https://github.com/trytilde/dispatch/pull/138) [`206f574`](https://github.com/trytilde/dispatch/commit/206f57465eda3b1e5574f1c801e5a2280e67a9df) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Run Memory Catcher as a background agent loop so synthesis does not require conversational participant-routing headers.

- [#140](https://github.com/trytilde/dispatch/pull/140) [`98fe818`](https://github.com/trytilde/dispatch/commit/98fe81802a0c60da06673b49860468fab4af568a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Exclude historic system records from Memory Catcher model messages because its system prompt is supplied through the dedicated instructions field.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Allow cookie-authenticated requests through a host-matched HTTPS development proxy without weakening origin checks.

- [#67](https://github.com/trytilde/dispatch/pull/67) [`8097727`](https://github.com/trytilde/dispatch/commit/80977279b1698672f86155fcaf3281b4cd77a701) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep the transcript loading skeleton, scroll-to-bottom control, and Electron drag regions stable across themes and workspace states.

- [`d163506`](https://github.com/trytilde/dispatch/commit/d1635064bc407213821d0db2a81ed0fce4faff29) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Improve local diagnostics, preserve chat state while loading, and refine the workspace composer, steering queue, rich media, typography, sizing, and resize behaviour.

- [#59](https://github.com/trytilde/dispatch/pull/59) [`d7f61de`](https://github.com/trytilde/dispatch/commit/d7f61deee9b34c3dfa32698bf48d2542f04f33c3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Detect an unbuilt workspace dependency by its runtime export condition rather than the first one listed. A package whose `exports` map starts with `types` and `development` pointing at TypeScript source looked built even when its `dist` was missing, so `openbot mobile expo` skipped the build and Metro failed with `While trying to resolve module @tryopenbot/client-runtime ... specifies a main module field that could not be resolved`.

- [#83](https://github.com/trytilde/dispatch/pull/83) [`1ffa4df`](https://github.com/trytilde/dispatch/commit/1ffa4dfaf81152d7aac6819a1cccd33a58052811) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Restore the floating bottom-right Computer preview in web and desktop workspaces.

- [`14f0014`](https://github.com/trytilde/dispatch/commit/14f0014c23e15d03672af2a4b46411d3b6382a6b) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Force explicit graphical requests through the team-visible Computer specialist, answer self-contained questions without acknowledgements, preserve requested browser URLs, and suppress overlays that block visual work.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Forward the configured Tilde organization when reconciling an OpenBot registration.

- [`ebcc12b`](https://github.com/trytilde/dispatch/commit/ebcc12b9c8d5e0c155bfcda917622c5342189fdc) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Improve mobile navigation, settings, dialogs, search results, and chat composer behavior.

- [#112](https://github.com/trytilde/dispatch/pull/112) [`6cbc0b8`](https://github.com/trytilde/dispatch/commit/6cbc0b8aaa3d0cb83d1e4dc917438f92429019bd) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Make the web workspace mobile-friendly with a slide-out navigation sheet, touch-sized controls, safe-area spacing, and a composer that keeps Enter available for new lines on touch devices.

- [#92](https://github.com/trytilde/dispatch/pull/92) [`1a103b4`](https://github.com/trytilde/dispatch/commit/1a103b4731f62a03a33340a9a805c82b262ed1f1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Improve connector, plugin, routine, conversation-thread, and tool-message behavior across the shared workspace runtime and clients.

- [#142](https://github.com/trytilde/dispatch/pull/142) [`9dd8d0b`](https://github.com/trytilde/dispatch/commit/9dd8d0bbab89ca748f39bf21ada3553093c7a853) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Isolate Memory Catcher inference to the current signed batch so stale retry leases cannot influence memory mutations.

- [#144](https://github.com/trytilde/dispatch/pull/144) [`83d52e1`](https://github.com/trytilde/dispatch/commit/83d52e1468084e41499645b6ca7b036cf623f055) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep Code Storage credentials out of persistent Git remote URLs while preserving unattended reconciliation.

- [#139](https://github.com/trytilde/dispatch/pull/139) [`f884351`](https://github.com/trytilde/dispatch/commit/f8843515b8db211b9602f3a0daf808ee146bdea3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Log bounded, redacted Memory Catcher inference failures so background synthesis failures can be diagnosed without exposing request payloads.

- [`81e7d28`](https://github.com/trytilde/dispatch/commit/81e7d28e5854d2086ffa687f0cbd448bfff8b730) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep only Factory and Pirate Poet in this installation and stop agent reasoning after the first successfully delivered user message.

- [`1e8c974`](https://github.com/trytilde/dispatch/commit/1e8c9744676d92012f8fec41dc52793c896d2608) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Polish the mobile composer and account menu, deduplicate provider cards, resolve trusted icons, cache plugin catalogues, and add end-user routine provider and routine management settings.

- [#59](https://github.com/trytilde/dispatch/pull/59) [`7aebeae`](https://github.com/trytilde/dispatch/commit/7aebeae17fef54d252fcc3360cdd2eb18b5776ff) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Provision the NDK and CMake in `openbot mobile setup`, reading the NDK version React Native pins in its `gradle/libs.versions.toml` rather than restating it, and check the NDK in `openbot mobile doctor`. The Android Gradle Plugin downloads both partway through a build otherwise, and a mismatch surfaces as a failed `configureCMakeDebug` task that names neither the NDK nor the cause.

- [`efbd743`](https://github.com/trytilde/dispatch/commit/efbd7433d6985917d226066e9acca67784992054) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Route every browser `/api` request to the consolidated control service in development deployments.

- [#74](https://github.com/trytilde/dispatch/pull/74) [`b1a2840`](https://github.com/trytilde/dispatch/commit/b1a284054b6b166e1409748d9b92faca4ce86bca) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Discover current managed Cua skills and Vercel credentials after provider resources are reprovisioned.

- [`49d186b`](https://github.com/trytilde/dispatch/commit/49d186be001b50452ff58eff99265eed5e5f0fd1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Update canonical repository, fork, package, and publication URLs after the GitHub repositories moved to `trytilde/dispatch` and `trytilde/our-dispatch`.

- [#59](https://github.com/trytilde/dispatch/pull/59) [`a498e52`](https://github.com/trytilde/dispatch/commit/a498e52b3d63d1b6b43ff26f1a27c33c544bba05) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Resolve the JDK in `openbot mobile doctor` the way Gradle does: `JAVA_HOME` first, `PATH` only as a fallback, with the source named in the output. On a machine with several JDKs installed — a linked Homebrew `openjdk` shadowing a keg-only `openjdk@21`, for instance — the previous check reported the compiler on `PATH` while Gradle built against a different one, so a correctly configured host could still be told its JDK was unsupported. Doctor now also notes when `JAVA_HOME` and `PATH` disagree.

- [#146](https://github.com/trytilde/dispatch/pull/146) [`1477c61`](https://github.com/trytilde/dispatch/commit/1477c61c2005fe91a50817ba980bc7c57605ead6) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Allow bounded Agent Resource Bundle polling while memory bindings finish synchronizing.

- [#64](https://github.com/trytilde/dispatch/pull/64) [`c9e839d`](https://github.com/trytilde/dispatch/commit/c9e839d33c664508ae13c25d48e76428ef09bcce) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Show every public top-level `openbot` command in the interactive launcher.

- [`f9e0006`](https://github.com/trytilde/dispatch/commit/f9e0006633fe4f8c3e2c4edcf75bf8319f9120ac) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Support an explicit `computer-use-only` agent profile without unrelated authored tools or skills, and reliably fast-forward named deployment branches on exe.dev.

- [`49d186b`](https://github.com/trytilde/dispatch/commit/49d186be001b50452ff58eff99265eed5e5f0fd1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Synchronize the maintained Tilde fork with the latest `trytilde/dispatch` runtime and canonical repository URLs.

- [`49d186b`](https://github.com/trytilde/dispatch/commit/49d186be001b50452ff58eff99265eed5e5f0fd1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Consume Tilde-authored AgentRun, delegated-job, and message timestamp fields through typed ChatKit request context instead of message metadata.

- [#78](https://github.com/trytilde/dispatch/pull/78) [`2a4bbfc`](https://github.com/trytilde/dispatch/commit/2a4bbfcd14ffb0643c3f6ddb25c44fdf1aa89e8c) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Wait for an active Computer desktop session before running CUA actions and report readiness consistently through Computer tools.

- [`30da391`](https://github.com/trytilde/dispatch/commit/30da391922877259d216dadad359d78ef91774c4) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Wait for temporary agent credentials to finish clearing before restoring evaluation SOPS metadata.

- [#124](https://github.com/trytilde/dispatch/pull/124) [`bdcfa6d`](https://github.com/trytilde/dispatch/commit/bdcfa6d3bff0fec3780a1fd3bcb274dac1886f3a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Wire the scaffolded propose-only self-extension tool into default agent runtime tools.

- Updated dependencies [[`add92f5`](https://github.com/trytilde/dispatch/commit/add92f582f82ccd227615e87e4ec6e6dd551769a), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449), [`1e67339`](https://github.com/trytilde/dispatch/commit/1e67339f075e71601e1966b32efade7197100b17), [`cd77f24`](https://github.com/trytilde/dispatch/commit/cd77f24613ac272843fe68d7493d3ccefac2a35e), [`db20bc5`](https://github.com/trytilde/dispatch/commit/db20bc531bb246b3962a79e2d7c58a1d6620a0a3), [`2156336`](https://github.com/trytilde/dispatch/commit/2156336d885f78a8b0d485d69e1c92bbd87c7715), [`ed8e843`](https://github.com/trytilde/dispatch/commit/ed8e843b9ccfc104b7b7fd57266b22c32bc44eb1), [`a200646`](https://github.com/trytilde/dispatch/commit/a2006462dc4963669cad3bc04f1192bcb2b4c763), [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449), [`ff913c3`](https://github.com/trytilde/dispatch/commit/ff913c375a8dd607cb45df6844981ea4446ae77c), [`983eb35`](https://github.com/trytilde/dispatch/commit/983eb352c39fee4fabfe45116b4ee9dcda4c5c28), [`3c85b64`](https://github.com/trytilde/dispatch/commit/3c85b6488802a0e3f002311949fe40d42dbe824a), [`720d07c`](https://github.com/trytilde/dispatch/commit/720d07caf0c1259a15839842644adb7d49684904), [`1e8c974`](https://github.com/trytilde/dispatch/commit/1e8c9744676d92012f8fec41dc52793c896d2608), [`b9a66cb`](https://github.com/trytilde/dispatch/commit/b9a66cba146cccfc971589b6149603f4085edb3e), [`9db1d92`](https://github.com/trytilde/dispatch/commit/9db1d9293a184de2f040eed48f859439b2b2f7af), [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449), [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449), [`206e39f`](https://github.com/trytilde/dispatch/commit/206e39f523fa2dd5421ab643d58f02ed9dedb8f3), [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449), [`d0aaada`](https://github.com/trytilde/dispatch/commit/d0aaada9ff5c00faba2063410b0fd42855951bda), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`0ee3944`](https://github.com/trytilde/dispatch/commit/0ee39446580b8022ce26c414dd44cd6cdc07306a), [`6a328b0`](https://github.com/trytilde/dispatch/commit/6a328b0e62e55a3be382c18785e51194d6062914), [`25563d9`](https://github.com/trytilde/dispatch/commit/25563d961711e4745d0817c8ed1e353130ff6e80), [`0a4c682`](https://github.com/trytilde/dispatch/commit/0a4c682b49c7a72b08d34851d7e53d3cbf0f64d0), [`b4bbd3a`](https://github.com/trytilde/dispatch/commit/b4bbd3a405466ff6d7a5883872b8da75dc654b66), [`8e98d8f`](https://github.com/trytilde/dispatch/commit/8e98d8f28ebbe4e0339b2e95641a0d85dc5aed2e), [`eaaed88`](https://github.com/trytilde/dispatch/commit/eaaed88000343b179e664d6ccfa33a45065a23d2), [`8fb0d80`](https://github.com/trytilde/dispatch/commit/8fb0d809f1eef9cac06d569d0ed0a223de4f6dbf), [`07fd4db`](https://github.com/trytilde/dispatch/commit/07fd4dbda7e9cd4bffe61e946c52dce1aff1b32b), [`87986e0`](https://github.com/trytilde/dispatch/commit/87986e09320112b761ae4f8da7aa53c2052c1d99), [`d8c3d20`](https://github.com/trytilde/dispatch/commit/d8c3d2011a8399db4979cab6a2da07c4d7709553), [`848f821`](https://github.com/trytilde/dispatch/commit/848f821b87f161521a3b862379f27c2a7cc398c9), [`380fbc5`](https://github.com/trytilde/dispatch/commit/380fbc56314485d94b1f8b51296fb854e2bb1550), [`6a9f124`](https://github.com/trytilde/dispatch/commit/6a9f124275f9e8230528a78e634d9413d981cf7c), [`b4bbd3a`](https://github.com/trytilde/dispatch/commit/b4bbd3a405466ff6d7a5883872b8da75dc654b66), [`1f70986`](https://github.com/trytilde/dispatch/commit/1f70986751bc83eb87eb110de794bb24ee76318e), [`2b0d90c`](https://github.com/trytilde/dispatch/commit/2b0d90c5ebbc457a2cfe2badafa7ad30dd0cb0e4), [`987ac27`](https://github.com/trytilde/dispatch/commit/987ac2713c7b1389e8c2cea45e7c84ce2de799f3), [`19dc06a`](https://github.com/trytilde/dispatch/commit/19dc06a9b02343fee33f071c7baa3072d6b33570), [`ce97171`](https://github.com/trytilde/dispatch/commit/ce97171a95681822b4355540fb4f8469fe4969f9), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`a99315c`](https://github.com/trytilde/dispatch/commit/a99315c1731a87ec7850ec05c240b14459d84c8a), [`9041781`](https://github.com/trytilde/dispatch/commit/90417814df0f47c2912ca445d4e94c2ebfd3c5da), [`c75b77d`](https://github.com/trytilde/dispatch/commit/c75b77d4c8f1940a5ce787a6e3c03e32b9abd659), [`a79856f`](https://github.com/trytilde/dispatch/commit/a79856fadab1916105edc8a1ce990f373cd9c1e4), [`ee6dc62`](https://github.com/trytilde/dispatch/commit/ee6dc622b6b5078bfa1306b19e0c41057e473b81), [`e8df3ca`](https://github.com/trytilde/dispatch/commit/e8df3cab93505bb092ee426c539175f9525d60f8), [`f73d6b8`](https://github.com/trytilde/dispatch/commit/f73d6b8b5742f7d9f0f5c8534a164c46b9b904a4), [`f464185`](https://github.com/trytilde/dispatch/commit/f4641858b43bcca8318495756f8e5bc17c8d79a4), [`3c03ef1`](https://github.com/trytilde/dispatch/commit/3c03ef1364269165c4075b730cf5d990946e60e8), [`d6f9091`](https://github.com/trytilde/dispatch/commit/d6f90912c7e66b8df710b5aa0013fa764ce55851), [`7864111`](https://github.com/trytilde/dispatch/commit/7864111b64efbd5d2adf177bfaca25ae6fc077c7), [`892f44c`](https://github.com/trytilde/dispatch/commit/892f44c9ea8dae7b4776238689d7d7c7817d9def), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`52cce4c`](https://github.com/trytilde/dispatch/commit/52cce4ccda162f64cbd5ac4e74e6fa784138dce7), [`c7927b4`](https://github.com/trytilde/dispatch/commit/c7927b43a71551b8a4d4428a7528ecf650b399e8), [`a151205`](https://github.com/trytilde/dispatch/commit/a151205fde32938f9342e09b63d6ec155a33aa5b), [`d6bee5c`](https://github.com/trytilde/dispatch/commit/d6bee5c23ee5d74d1c0ac3cf899fa052034d30cc), [`206e39f`](https://github.com/trytilde/dispatch/commit/206e39f523fa2dd5421ab643d58f02ed9dedb8f3), [`ac9209a`](https://github.com/trytilde/dispatch/commit/ac9209a420d3b8f31f311a3e08b554f46b348742), [`20c5737`](https://github.com/trytilde/dispatch/commit/20c5737cffa4f165f023b3fdd7f7a59aaa26316e), [`19a4a0e`](https://github.com/trytilde/dispatch/commit/19a4a0e52b41f5afbdaddaed1029992ed2b4d961), [`bb957cf`](https://github.com/trytilde/dispatch/commit/bb957cfdb8451f61480f0935273f1d9912522222), [`bdd224c`](https://github.com/trytilde/dispatch/commit/bdd224c65312cabb11348d3931181569ff5947d0), [`4261e8c`](https://github.com/trytilde/dispatch/commit/4261e8c45e93fd360ee0cdf2c1734cdb8eb0577d), [`47d3725`](https://github.com/trytilde/dispatch/commit/47d372565423995def42543fff97753ab201e66f), [`165bfa2`](https://github.com/trytilde/dispatch/commit/165bfa2e2a50184f7899b1e466b3803ad1ed1acc), [`0c99101`](https://github.com/trytilde/dispatch/commit/0c99101c84c07441e1bb1eb94a684b7bb56872b1), [`09f58c4`](https://github.com/trytilde/dispatch/commit/09f58c4f50abb18cc46c18b43245ff862b99eded), [`b10e4ca`](https://github.com/trytilde/dispatch/commit/b10e4ca458c43bb36783770c68d9ab77bb7c4db8), [`39e8b62`](https://github.com/trytilde/dispatch/commit/39e8b62d175e52bf644d92989fcb8e7505e1095e), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`8097727`](https://github.com/trytilde/dispatch/commit/80977279b1698672f86155fcaf3281b4cd77a701), [`d163506`](https://github.com/trytilde/dispatch/commit/d1635064bc407213821d0db2a81ed0fce4faff29), [`1ffa4df`](https://github.com/trytilde/dispatch/commit/1ffa4dfaf81152d7aac6819a1cccd33a58052811), [`a6a7913`](https://github.com/trytilde/dispatch/commit/a6a791320bfbd636f92ee658b58a27cb1d20cefc), [`14f0014`](https://github.com/trytilde/dispatch/commit/14f0014c23e15d03672af2a4b46411d3b6382a6b), [`26d0e7a`](https://github.com/trytilde/dispatch/commit/26d0e7abbd7c99decd17fbe961dc62943320720e), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`ebcc12b`](https://github.com/trytilde/dispatch/commit/ebcc12b9c8d5e0c155bfcda917622c5342189fdc), [`6cbc0b8`](https://github.com/trytilde/dispatch/commit/6cbc0b8aaa3d0cb83d1e4dc917438f92429019bd), [`1a103b4`](https://github.com/trytilde/dispatch/commit/1a103b4731f62a03a33340a9a805c82b262ed1f1), [`83d52e1`](https://github.com/trytilde/dispatch/commit/83d52e1468084e41499645b6ca7b036cf623f055), [`d677077`](https://github.com/trytilde/dispatch/commit/d677077954370423a77502f24199bbdacbae76ae), [`1784f6c`](https://github.com/trytilde/dispatch/commit/1784f6cc0b4552eb11b615b82d71e2190e7ba2e6), [`608839d`](https://github.com/trytilde/dispatch/commit/608839db733e8c5b023ca13087ffea0c8970cc83), [`81e7d28`](https://github.com/trytilde/dispatch/commit/81e7d28e5854d2086ffa687f0cbd448bfff8b730), [`a1aecaf`](https://github.com/trytilde/dispatch/commit/a1aecaf7f691a6f4fff4f79905b57171ab4ad506), [`e6a2c5e`](https://github.com/trytilde/dispatch/commit/e6a2c5e0f173687aa87680aa4c28681f04afe19f), [`1e8c974`](https://github.com/trytilde/dispatch/commit/1e8c9744676d92012f8fec41dc52793c896d2608), [`efbd743`](https://github.com/trytilde/dispatch/commit/efbd7433d6985917d226066e9acca67784992054), [`bd417b1`](https://github.com/trytilde/dispatch/commit/bd417b1d7bb0327c031cc4c11a05dfc11f5cb917), [`c5df8df`](https://github.com/trytilde/dispatch/commit/c5df8df5e0244d45c80deba036ce780c94cfc3b8), [`a865749`](https://github.com/trytilde/dispatch/commit/a865749af593eabe061bb33d137338e17ed78216), [`b1a2840`](https://github.com/trytilde/dispatch/commit/b1a284054b6b166e1409748d9b92faca4ce86bca), [`8e98d8f`](https://github.com/trytilde/dispatch/commit/8e98d8f28ebbe4e0339b2e95641a0d85dc5aed2e), [`251c0c0`](https://github.com/trytilde/dispatch/commit/251c0c01cb513e9f55168d69fb6977d8b17d9ad4), [`2eee1d1`](https://github.com/trytilde/dispatch/commit/2eee1d17e18aee13974456382a9a0556ca9c929c), [`49d186b`](https://github.com/trytilde/dispatch/commit/49d186be001b50452ff58eff99265eed5e5f0fd1), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`0799a79`](https://github.com/trytilde/dispatch/commit/0799a79fc8ef3cb2ba43235afa94bab5b3a3a5ef), [`1477c61`](https://github.com/trytilde/dispatch/commit/1477c61c2005fe91a50817ba980bc7c57605ead6), [`c9e839d`](https://github.com/trytilde/dispatch/commit/c9e839d33c664508ae13c25d48e76428ef09bcce), [`f9e0006`](https://github.com/trytilde/dispatch/commit/f9e0006633fe4f8c3e2c4edcf75bf8319f9120ac), [`1e2084f`](https://github.com/trytilde/dispatch/commit/1e2084f0ac32beea9aa9c8293ca092f17af563a0), [`c2b115e`](https://github.com/trytilde/dispatch/commit/c2b115ec173991e6403cbd10fa9d408705b4862a), [`2a4bbfc`](https://github.com/trytilde/dispatch/commit/2a4bbfcd14ffb0643c3f6ddb25c44fdf1aa89e8c), [`1258ab6`](https://github.com/trytilde/dispatch/commit/1258ab624e560ccebbc2ea658d1043b47917c13b)]:
  - @tryopenbot/agent-provider@1.0.0
  - @tryopenbot/agent-service-provider@1.0.0
  - @tryopenbot/auth-provider@1.0.0
  - @tryopenbot/computer-service-provider@1.0.0
  - @tryopenbot/computer-tools@1.0.0
  - @tryopenbot/configuration@1.0.0
  - @tryopenbot/utilities@1.0.0
  - @tryopenbot/platform-integrations@1.0.0
  - @tryopenbot/control-service-provider@1.0.0
  - @tryopenbot/runtime-provider@1.0.0
  - @tryopenbot/control-service@1.0.0
  - @tryopenbot/git-provider@1.0.0
  - @trytilde/sdk@0.2.0
  - @tryopenbot/inference-provider@0.2.0
  - @trytilde/sdk-codex@0.2.0
  - @trytilde/sdk-claude-code@0.2.0
  - @trytilde/sdk-cursor@0.2.0
  - @tryopenbot/connector-tools@0.2.0
  - @trytilde/sdk-opencode@0.2.0
  - @trytilde/sdk-gemini-cli@0.2.0
