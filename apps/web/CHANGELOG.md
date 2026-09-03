# @tryopenbot/web

## 1.0.0

### Minor Changes

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a standalone `AgentAvatar` entry with component-scoped styles for applications that do not use the complete OpenBot interface.

- [`1e67339`](https://github.com/trytilde/dispatch/commit/1e67339f075e71601e1966b32efade7197100b17) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add guarded, idempotent agent deletion and an end-to-end agent lifecycle production evaluation.

- [`cd77f24`](https://github.com/trytilde/dispatch/commit/cd77f24613ac272843fe68d7493d3ccefac2a35e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add agent-centric chat workspaces with rich streamed messages and isolated live Computer desktops per agent.

- [#120](https://github.com/trytilde/dispatch/pull/120) [`db20bc5`](https://github.com/trytilde/dispatch/commit/db20bc531bb246b3962a79e2d7c58a1d6620a0a3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add automatic memory recall, owner-managed facts, and a least-privilege Memory Catcher synthesizer to OpenBot bots.

- [#87](https://github.com/trytilde/dispatch/pull/87) [`2156336`](https://github.com/trytilde/dispatch/commit/2156336d885f78a8b0d485d69e1c92bbd87c7715) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add consolidated ChatKit search across bots, conversation titles, and messages to the shared client runtime and expose it in the web, Electron, and mobile clients.

- [#71](https://github.com/trytilde/dispatch/pull/71) [`983eb35`](https://github.com/trytilde/dispatch/commit/983eb352c39fee4fabfe45116b4ee9dcda4c5c28) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add optional local and Vercel-hosted ChatGPT subscription inference with Codex device-code authentication, provider-owned agent templates and deployment assets, AI SDK 7 support, resumable staged init selectors that immediately configure the selected provider while offering every built-in alternative, checkout-scoped gitignored user configuration, and correct separation of provider-managed and team-owned Tilde registry membership.

- [#115](https://github.com/trytilde/dispatch/pull/115) [`3c85b64`](https://github.com/trytilde/dispatch/commit/3c85b6488802a0e3f002311949fe40d42dbe824a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add Codex, Claude Code, and Cursor hook adapters that record searchable ChatKit messages and canonical tool executions while `openbot plugin` installs Tilde MCP servers and skills.

- [`720d07c`](https://github.com/trytilde/dispatch/commit/720d07caf0c1259a15839842644adb7d49684904) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add the internal computer provider boundary, Microsandbox and Vercel implementations, a capability-protected computer service, and a shared multi-stage OCI image build and deployment lifecycle.

- [#66](https://github.com/trytilde/dispatch/pull/66) [`b9a66cb`](https://github.com/trytilde/dispatch/commit/b9a66cba146cccfc971589b6149603f4085edb3e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Make Cua Driver the Computer's programmatic GUI backend, expose its runtime catalog as direct local tools, and reconcile canonical and OpenBot computer-use skills for every agent.

- [`9db1d92`](https://github.com/trytilde/dispatch/commit/9db1d9293a184de2f040eed48f859439b2b2f7af) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add domain-owned agent provider APIs and a provider-neutral control service protocol for Tilde agents and sessions.

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

- [#47](https://github.com/trytilde/dispatch/pull/47) [`0ee3944`](https://github.com/trytilde/dispatch/commit/0ee39446580b8022ce26c414dd44cd6cdc07306a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a shared Zustand client runtime and grouped UI contracts, migrate web and Electron authentication and chat onto it, and add the first Expo mobile client with control-service selection, native authentication, sidebar, and conversation workflows.

- [#57](https://github.com/trytilde/dispatch/pull/57) [`6a328b0`](https://github.com/trytilde/dispatch/commit/6a328b0e62e55a3be382c18785e51194d6062914) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Replace the Hello World primary agent with the Factory agent and give it an end-to-end build/test/deploy loop. A new `@tryopenbot/git-provider` derives the fork repository from the checkout's origin remote, brokers a GitHub App credential through Tilde, and reconciles GitHub REST and git-over-HTTPS reverse-proxy profiles; the trusted development sandbox attaches its seeded source tree to the owner's fork through that proxy so the factory agent has an authenticated git client without holding a token. The factory agent's computer tools target the development sandbox, its skills cover creating, locally testing (Tilde local-runtime tunnel), and deploying agents, and the primary agent additionally receives the brokered GitHub toolkit on its MCP server. A background orchestrator (`openbot orchestrate`) owns the lifecycle: edits route every agent through the local-runtime tunnel with hot reload, and settled edits are verified, published to the openbot/sandbox-edits branch, and redeployed automatically. Every subagent can edit its own source in the development sandbox, and the web workspace's New Agent entry scaffolds, registers, and opens a chat with the agent itself.

- [#118](https://github.com/trytilde/dispatch/pull/118) [`8e98d8f`](https://github.com/trytilde/dispatch/commit/8e98d8f28ebbe4e0339b2e95641a0d85dc5aed2e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Show participant joins and leaves as lightweight session activity while keeping them out of the message transcript.

- [#70](https://github.com/trytilde/dispatch/pull/70) [`8fb0d80`](https://github.com/trytilde/dispatch/commit/8fb0d809f1eef9cac06d569d0ed0a223de4f6dbf) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add the initial settings catalogue for browsing and assigning tools and skills to bots.

- [`07fd4db`](https://github.com/trytilde/dispatch/commit/07fd4dbda7e9cd4bffe61e946c52dce1aff1b32b) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add `openbot eval` to measure production answers, delegated Computer work, and self-cleaning routine lifecycles with machine-readable latency and tool-call results.

- [#81](https://github.com/trytilde/dispatch/pull/81) [`87986e0`](https://github.com/trytilde/dispatch/commit/87986e09320112b761ae4f8da7aa53c2052c1d99) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add routines and signals: per-agent routines with schedule and provider-event
  triggers in a new agent details pane, backed by owner routes that project Tilde
  ChatKit routines and signal rules through metadata-stamped grouping, plus signal
  provider connection management inline and at Settings → Signals.

- [`380fbc5`](https://github.com/trytilde/dispatch/commit/380fbc56314485d94b1f8b51296fb854e2bb1550) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Represent shared Tilde and Vercel access as concrete platform implementations, centralize their common request and deployment helpers, initialize each once across its dependent providers, and allow init to revisit existing provider configuration with stored prompt defaults. Load fork-owned TypeScript configuration through the standalone CLI's TypeScript loader so generated `.js` specifiers resolve their `.ts` sources.

- [`6a9f124`](https://github.com/trytilde/dispatch/commit/6a9f124275f9e8230528a78e634d9413d981cf7c) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add domain-owned skills provider APIs, typed Tilde skill management, verified package assets, and owner control methods.

- [`2b0d90c`](https://github.com/trytilde/dispatch/commit/2b0d90c5ebbc457a2cfe2badafa7ad30dd0cb0e4) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add team-scoped Tilde sign-in, browser sessions, and secure desktop token refresh for OpenBot installations.

- [`987ac27`](https://github.com/trytilde/dispatch/commit/987ac2713c7b1389e8c2cea45e7c84ce2de799f3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a domain-owned tools provider API and Tilde Harness SDK implementation for agent tool execution.

- [`19dc06a`](https://github.com/trytilde/dispatch/commit/19dc06a9b02343fee33f071c7baa3072d6b33570) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Provision each authored agent through Tilde's durable Agent Resource Bundle API with a stable machine-user profile, uploaded avatar, default memory bank, safe credential rotation, and human-owned creation followed by machine reconciliation.

- [#59](https://github.com/trytilde/dispatch/pull/59) [`390b872`](https://github.com/trytilde/dispatch/commit/390b8729491e99362aecf000721f1e706fee8df0) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Carry the OpenBot mark across every client. Electron takes `apps/desktop/build/icon.png` as a rounded 1024px artwork, which electron-builder renders into the macOS `.icns` and the Linux icon set, replacing the unrelated placeholder mark it shipped with. The web app gains a favicon of the same drawing.

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

- [`f464185`](https://github.com/trytilde/dispatch/commit/f4641858b43bcca8318495756f8e5bc17c8d79a4) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Connect the owner workspace to configured Chat Provider agents in local and deployed modes.

  Make Tilde initialization default to production, discover the global control-plane toolkit, and keep mixed age/KMS secret updates compatible with older SOPS and AWS SSO credentials.

  Provision the shared Tilde Vercel UI channel required by ChatKit workspace idempotently.

- [`3c03ef1`](https://github.com/trytilde/dispatch/commit/3c03ef1364269165c4075b730cf5d990946e60e8) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a consolidated OpenBot runtime deployment, direct secure ChatKit workspace streaming, persisted unified routines, and bulk tool assignment.

- [`d6f9091`](https://github.com/trytilde/dispatch/commit/d6f90912c7e66b8df710b5aa0013fa764ce55851) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Consolidate provider contracts into their owning packages and add isolated agent workspaces plus a trusted, SOPS-capable development sandbox deployment.

- [#86](https://github.com/trytilde/dispatch/pull/86) [`7864111`](https://github.com/trytilde/dispatch/commit/7864111b64efbd5d2adf177bfaca25ae6fc077c7) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Consolidate workspace loading, turns, attachments, connector setup, and bot reconciliation through aggregate Tilde API operations.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a persistent exe.dev single-VM runtime with Code Storage deployment, host Computer desktops, and explicit reconciliation recovery controls.

- [#76](https://github.com/trytilde/dispatch/pull/76) [`52cce4c`](https://github.com/trytilde/dispatch/commit/52cce4ccda162f64cbd5ac4e74e6fa784138dce7) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Expose the authenticated owner's display name, avatar, organization, and workspace through the shared session contract.

- [`c7927b4`](https://github.com/trytilde/dispatch/commit/c7927b43a71551b8a4d4428a7528ecf650b399e8) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add the complete reusable OpenBot workspace component system, exact light palette, motion curves, agent identity artwork, continuous chat composition, rich message content, activity surface, and Computer pane to `@tryopenbot/ui`.

- [#73](https://github.com/trytilde/dispatch/pull/73) [`a6a7913`](https://github.com/trytilde/dispatch/commit/a6a791320bfbd636f92ee658b58a27cb1d20cefc) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Move the Tilde TypeScript SDK into the OpenBot monorepo under the `@trytilde/sdk*` package names and add Tilde authentication, state, tunnel, plugin, and SDK workflows to `openbot`.

  Migration:

  - Replace `@trytilde/harness-sdk*` imports with the corresponding `@trytilde/sdk*` package.
  - Replace `@trytilde/harness-plugins` and coding-agent wrapper binaries with `openbot plugin`.
  - Replace `tilde auth|state|tunnel` with `openbot auth|state|tunnel`.

- [`26d0e7a`](https://github.com/trytilde/dispatch/commit/26d0e7abbd7c99decd17fbe961dc62943320720e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add one fork-owned `configuration/` tree for directly authored Vercel AI SDK-compatible agent endpoints, agent-scoped skills and workspace seeds, and provider integrations, with an interactive terminal CLI for setup and operation. Concrete implementations are grouped under `Configuration({ providers: { ... } })`; repository resources use canonical file locations instead of configurable paths. OpenBot discovers committed agent modules without generating or publishing TypeScript at runtime.

- [#92](https://github.com/trytilde/dispatch/pull/92) [`1a103b4`](https://github.com/trytilde/dispatch/commit/1a103b4731f62a03a33340a9a805c82b262ed1f1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Improve connector, plugin, routine, conversation-thread, and tool-message behavior across the shared workspace runtime and clients.

- [#129](https://github.com/trytilde/dispatch/pull/129) [`d677077`](https://github.com/trytilde/dispatch/commit/d677077954370423a77502f24199bbdacbae76ae) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Meter Memory Catcher synthesis through durable hosted inference billing.

- [#96](https://github.com/trytilde/dispatch/pull/96) [`1784f6c`](https://github.com/trytilde/dispatch/commit/1784f6cc0b4552eb11b615b82d71e2190e7ba2e6) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Migrate OpenBot to Tilde's regular ChatKit activity, agent, session, message, search, turn, and realtime-ticket REST routes while preserving the ChatKit realtime contract.

  Migration:

  - Replace `OpenBotClient.getBootstrap` with `OpenBotClient.getActivity`.
  - Read the agent page from the activity response's `activity` field.

- [#63](https://github.com/trytilde/dispatch/pull/63) [`608839d`](https://github.com/trytilde/dispatch/commit/608839db733e8c5b023ca13087ffea0c8970cc83) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add shared queued-turn controls and native owner-client parity for onboarding, rich chat, attachments, and Computer takeover.

- [`bd417b1`](https://github.com/trytilde/dispatch/commit/bd417b1d7bb0327c031cc4c11a05dfc11f5cb917) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Publish all OpenBot workspace packages publicly with runnable JavaScript artifacts and declarations, and provide `openbot` as an installable standalone CLI.

  Refresh selected AWS profile credentials through AWS CLI before SOPS operations so IAM Identity Center sessions work during initialization and later secret access.

  Support AI agents and automation with non-interactive initialization through stable JSON answers on stdin and machine-readable JSON results.

  Migration:

  - Replace the internal package name `@tryopenbot/cli` with the public `openbot` package.
  - Invoke the installed CLI with `openbot <command>` or `npx openbot <command>`.

- [`c5df8df`](https://github.com/trytilde/dispatch/commit/c5df8df5e0244d45c80deba036ce780c94cfc3b8) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Reconcile authored agents, skills, tools, services, and Computers through idempotent provider lifecycles in development and deployment.

- [`a865749`](https://github.com/trytilde/dispatch/commit/a865749af593eabe061bb33d137338e17ed78216) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Refine the owner workspace into a continuous per-agent chat with the reference light palette, patterned agent avatars, message replies, file composition, and Tilde connector authorization cards.

- [#58](https://github.com/trytilde/dispatch/pull/58) [`73ef020`](https://github.com/trytilde/dispatch/commit/73ef0208822f6db96a5b77a1c365cb2516ef6a0e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Remove the unreachable conversation outline and background tasks panels, and route the web authentication gate through the shared client runtime instead of its own session fetch. `AsyncTasksPanel`, `ConversationOutlinePanel`, and their types are no longer exported from `@tryopenbot/ui`. The gate now bootstraps the runtime, which also fixes the runtime never being initialized, and the onboarding no longer persists a result nothing read.

- [#110](https://github.com/trytilde/dispatch/pull/110) [`251c0c0`](https://github.com/trytilde/dispatch/commit/251c0c01cb513e9f55168d69fb6977d8b17d9ad4) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Remove the paused Expo mobile client, Android/iOS tooling, EAS publication workflow, and `openbot mobile` command group from main. The complete implementation remains preserved on the `codex/mobile-archive` DO NOT MERGE branch.

  Migration:

  - Stop invoking `openbot mobile`, mobile root scripts, Metro/adb tunnels, or `mobile-v*` releases.
  - Use the web workspace or Electron desktop client while the product foundation is stabilized.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Replace the owner-chat transport with typed ChatKit workspace and realtime contracts, including per-user read state and explicit queue and turn lifecycle events.

- [`0799a79`](https://github.com/trytilde/dispatch/commit/0799a79fc8ef3cb2ba43235afa94bab5b3a3a5ef) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Reset the application to a setup-free UX shell, an empty owner control contract, and a bare Hono server that remains healthy on Vercel.

- [#68](https://github.com/trytilde/dispatch/pull/68) [`c2b115e`](https://github.com/trytilde/dispatch/commit/c2b115ec173991e6403cbd10fa9d408705b4862a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Replace the Computer's Openbox desktop with a focused XFCE session and permanent Files and browser launchers.

- [#58](https://github.com/trytilde/dispatch/pull/58) [`1258ab6`](https://github.com/trytilde/dispatch/commit/1258ab624e560ccebbc2ea658d1043b47917c13b) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Rebuild the workspace UI on vendored shadcn/ui, Beautiful UI, and AI Elements sources: semantic design tokens with light/dark class-based theming, the generated agent avatar engine, sidebar rows with an account menu and command palette actions, persisted client workspace switching with an automatic loopback development workspace, composer shortcuts and attachment thumbnails, queue-authoritative message submission and steering with deployment-enforced Tilde queue policies, causally ordered late replies, direct screenshot media rendering without tool-result JSON, segmented assistant transcript rendering with prose-only bubbles and merged tool runs, and a first-run onboarding flow. OpenBot-authored surfaces carry the `ob-` class prefix and OpenBot's own copy.

### Patch Changes

- [#147](https://github.com/trytilde/dispatch/pull/147) [`add92f5`](https://github.com/trytilde/dispatch/commit/add92f582f82ccd227615e87e4ec6e6dd551769a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Recognize Tilde's service-unavailable prefix on the retryable memory-binding checkpoint.

- [#106](https://github.com/trytilde/dispatch/pull/106) [`a200646`](https://github.com/trytilde/dispatch/commit/a2006462dc4963669cad3bc04f1192bcb2b4c763) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add canonical ChatKit registration and execution reporting for local Vercel AI SDK tools, including first-class dynamic child correlation, and enable it in generated OpenBot agents.

- [`1e8c974`](https://github.com/trytilde/dispatch/commit/1e8c9744676d92012f8fec41dc52793c896d2608) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Centralize graphical browser and desktop work in a CUA-only Computer specialist, with per-agent resource policies and delegated display provenance so callers keep their existing screen and browser profile.

- [#72](https://github.com/trytilde/dispatch/pull/72) [`ce97171`](https://github.com/trytilde/dispatch/commit/ce97171a95681822b4355540fb4f8469fe4969f9) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Bound concurrent Tilde skill and tool reconciliation while preserving input order and deterministic errors.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Build `@tryopenbot/ui` artifacts when the package is installed directly from Git.

- [#82](https://github.com/trytilde/dispatch/pull/82) [`a99315c`](https://github.com/trytilde/dispatch/commit/a99315c1731a87ec7850ec05c240b14459d84c8a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add atomic bulk MCP server function mapping methods and use one request when reconciling an agent's Tilde control-plane toolkit.

- [#135](https://github.com/trytilde/dispatch/pull/135) [`892f44c`](https://github.com/trytilde/dispatch/commit/892f44c9ea8dae7b4776238689d7d7c7817d9def) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep the scoped Code Storage repository authoritative inside trusted exe.dev runtimes.

- [#77](https://github.com/trytilde/dispatch/pull/77) [`d6bee5c`](https://github.com/trytilde/dispatch/commit/d6bee5c23ee5d74d1c0ac3cf899fa052034d30cc) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep newly created bots on the local-runtime tunnel until their complete agent template is ready, reconcile independent Tilde resources concurrently behind a shared request ceiling, and keep managed skill and tool assignments idempotent.

- [#69](https://github.com/trytilde/dispatch/pull/69) [`206e39f`](https://github.com/trytilde/dispatch/commit/206e39f523fa2dd5421ab643d58f02ed9dedb8f3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep agent activity, streamed messages, previews, and unread state updating while another chat is active.

- [`20c5737`](https://github.com/trytilde/dispatch/commit/20c5737cffa4f165f023b3fdd7f7a59aaa26316e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep standalone `openbot dev` agent discovery rooted in the fork repository.

- [`bb957cf`](https://github.com/trytilde/dispatch/commit/bb957cfdb8451f61480f0935273f1d9912522222) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep agent lifecycle evaluations checkout-clean when SOPS re-encrypts unchanged secrets.

- [`bdd224c`](https://github.com/trytilde/dispatch/commit/bdd224c65312cabb11348d3931181569ff5947d0) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Accept team-linked human and agent API keys on installation control surfaces, use installation authority for agent avatar reconciliation, and preserve untracked authored files while refreshing exe.dev source.

- [#117](https://github.com/trytilde/dispatch/pull/117) [`4261e8c`](https://github.com/trytilde/dispatch/commit/4261e8c45e93fd360ee0cdf2c1734cdb8eb0577d) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Switch an existing exe.dev checkout to the requested deployment branch before fast-forwarding it.

- [#145](https://github.com/trytilde/dispatch/pull/145) [`47d3725`](https://github.com/trytilde/dispatch/commit/47d372565423995def42543fff97753ab201e66f) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep exe.dev Code Storage reconciliation independent from non-exported environment fields.

- [`0c99101`](https://github.com/trytilde/dispatch/commit/0c99101c84c07441e1bb1eb94a684b7bb56872b1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Install initialized forks, resolve development packages from source, create Vercel image repositories automatically, and manage described secret and environment values through the CLI.

- [#45](https://github.com/trytilde/dispatch/pull/45) [`b10e4ca`](https://github.com/trytilde/dispatch/commit/b10e4ca458c43bb36783770c68d9ab77bb7c4db8) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep local browser authentication on the Vite origin and reconcile loopback OAuth callbacks during development.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Allow cookie-authenticated requests through a host-matched HTTPS development proxy without weakening origin checks.

- [#67](https://github.com/trytilde/dispatch/pull/67) [`8097727`](https://github.com/trytilde/dispatch/commit/80977279b1698672f86155fcaf3281b4cd77a701) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep the transcript loading skeleton, scroll-to-bottom control, and Electron drag regions stable across themes and workspace states.

- [`d163506`](https://github.com/trytilde/dispatch/commit/d1635064bc407213821d0db2a81ed0fce4faff29) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Improve local diagnostics, preserve chat state while loading, and refine the workspace composer, steering queue, rich media, typography, sizing, and resize behaviour.

- [#83](https://github.com/trytilde/dispatch/pull/83) [`1ffa4df`](https://github.com/trytilde/dispatch/commit/1ffa4dfaf81152d7aac6819a1cccd33a58052811) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Restore the floating bottom-right Computer preview in web and desktop workspaces.

- [`14f0014`](https://github.com/trytilde/dispatch/commit/14f0014c23e15d03672af2a4b46411d3b6382a6b) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Force explicit graphical requests through the team-visible Computer specialist, answer self-contained questions without acknowledgements, preserve requested browser URLs, and suppress overlays that block visual work.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Forward the configured Tilde organization when reconciling an OpenBot registration.

- [`ebcc12b`](https://github.com/trytilde/dispatch/commit/ebcc12b9c8d5e0c155bfcda917622c5342189fdc) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Improve mobile navigation, settings, dialogs, search results, and chat composer behavior.

- [#112](https://github.com/trytilde/dispatch/pull/112) [`6cbc0b8`](https://github.com/trytilde/dispatch/commit/6cbc0b8aaa3d0cb83d1e4dc917438f92429019bd) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Make the web workspace mobile-friendly with a slide-out navigation sheet, touch-sized controls, safe-area spacing, and a composer that keeps Enter available for new lines on touch devices.

- [#144](https://github.com/trytilde/dispatch/pull/144) [`83d52e1`](https://github.com/trytilde/dispatch/commit/83d52e1468084e41499645b6ca7b036cf623f055) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep Code Storage credentials out of persistent Git remote URLs while preserving unattended reconciliation.

- [`81e7d28`](https://github.com/trytilde/dispatch/commit/81e7d28e5854d2086ffa687f0cbd448bfff8b730) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Keep only Factory and Pirate Poet in this installation and stop agent reasoning after the first successfully delivered user message.

- [#59](https://github.com/trytilde/dispatch/pull/59) [`4659f2b`](https://github.com/trytilde/dispatch/commit/4659f2b5101bee5766557368d4877a45f0b2bc11) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Move onboarding state into `@tryopenbot/client-runtime`. Completion and the resulting agent description are persisted, survive reload, and decide whether a client shows first-run at all, so per ADR-0017 they are runtime state rather than renderer state. The runtime owns the contract, validation, and read/write, and the platform supplies key/value storage — `localStorage` on web, and the same interface accepts Expo SecureStore or the Electron bridge unchanged. `OnboardingResult` now has one definition, re-exported by `@tryopenbot/ui` so callers keep a single type.

- [`1e8c974`](https://github.com/trytilde/dispatch/commit/1e8c9744676d92012f8fec41dc52793c896d2608) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Polish the mobile composer and account menu, deduplicate provider cards, resolve trusted icons, cache plugin catalogues, and add end-user routine provider and routine management settings.

- [`efbd743`](https://github.com/trytilde/dispatch/commit/efbd7433d6985917d226066e9acca67784992054) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Route every browser `/api` request to the consolidated control service in development deployments.

- [#74](https://github.com/trytilde/dispatch/pull/74) [`b1a2840`](https://github.com/trytilde/dispatch/commit/b1a284054b6b166e1409748d9b92faca4ce86bca) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Discover current managed Cua skills and Vercel credentials after provider resources are reprovisioned.

- [#146](https://github.com/trytilde/dispatch/pull/146) [`1477c61`](https://github.com/trytilde/dispatch/commit/1477c61c2005fe91a50817ba980bc7c57605ead6) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Allow bounded Agent Resource Bundle polling while memory bindings finish synchronizing.

- [#64](https://github.com/trytilde/dispatch/pull/64) [`c9e839d`](https://github.com/trytilde/dispatch/commit/c9e839d33c664508ae13c25d48e76428ef09bcce) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Show every public top-level `openbot` command in the interactive launcher.

- [`f9e0006`](https://github.com/trytilde/dispatch/commit/f9e0006633fe4f8c3e2c4edcf75bf8319f9120ac) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Support an explicit `computer-use-only` agent profile without unrelated authored tools or skills, and reliably fast-forward named deployment branches on exe.dev.

- [#78](https://github.com/trytilde/dispatch/pull/78) [`2a4bbfc`](https://github.com/trytilde/dispatch/commit/2a4bbfcd14ffb0643c3f6ddb25c44fdf1aa89e8c) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Wait for an active Computer desktop session before running CUA actions and report readiness consistently through Computer tools.

- Updated dependencies [[`add92f5`](https://github.com/trytilde/dispatch/commit/add92f582f82ccd227615e87e4ec6e6dd551769a), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`1e67339`](https://github.com/trytilde/dispatch/commit/1e67339f075e71601e1966b32efade7197100b17), [`cd77f24`](https://github.com/trytilde/dispatch/commit/cd77f24613ac272843fe68d7493d3ccefac2a35e), [`db20bc5`](https://github.com/trytilde/dispatch/commit/db20bc531bb246b3962a79e2d7c58a1d6620a0a3), [`2156336`](https://github.com/trytilde/dispatch/commit/2156336d885f78a8b0d485d69e1c92bbd87c7715), [`a200646`](https://github.com/trytilde/dispatch/commit/a2006462dc4963669cad3bc04f1192bcb2b4c763), [`983eb35`](https://github.com/trytilde/dispatch/commit/983eb352c39fee4fabfe45116b4ee9dcda4c5c28), [`3c85b64`](https://github.com/trytilde/dispatch/commit/3c85b6488802a0e3f002311949fe40d42dbe824a), [`720d07c`](https://github.com/trytilde/dispatch/commit/720d07caf0c1259a15839842644adb7d49684904), [`1e8c974`](https://github.com/trytilde/dispatch/commit/1e8c9744676d92012f8fec41dc52793c896d2608), [`b9a66cb`](https://github.com/trytilde/dispatch/commit/b9a66cba146cccfc971589b6149603f4085edb3e), [`9db1d92`](https://github.com/trytilde/dispatch/commit/9db1d9293a184de2f040eed48f859439b2b2f7af), [`206e39f`](https://github.com/trytilde/dispatch/commit/206e39f523fa2dd5421ab643d58f02ed9dedb8f3), [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449), [`d0aaada`](https://github.com/trytilde/dispatch/commit/d0aaada9ff5c00faba2063410b0fd42855951bda), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`0ee3944`](https://github.com/trytilde/dispatch/commit/0ee39446580b8022ce26c414dd44cd6cdc07306a), [`6a328b0`](https://github.com/trytilde/dispatch/commit/6a328b0e62e55a3be382c18785e51194d6062914), [`0a4c682`](https://github.com/trytilde/dispatch/commit/0a4c682b49c7a72b08d34851d7e53d3cbf0f64d0), [`b4bbd3a`](https://github.com/trytilde/dispatch/commit/b4bbd3a405466ff6d7a5883872b8da75dc654b66), [`8e98d8f`](https://github.com/trytilde/dispatch/commit/8e98d8f28ebbe4e0339b2e95641a0d85dc5aed2e), [`8fb0d80`](https://github.com/trytilde/dispatch/commit/8fb0d809f1eef9cac06d569d0ed0a223de4f6dbf), [`07fd4db`](https://github.com/trytilde/dispatch/commit/07fd4dbda7e9cd4bffe61e946c52dce1aff1b32b), [`45f27e4`](https://github.com/trytilde/dispatch/commit/45f27e4ffc4b694bb2582e88f23e18119b8a9826), [`87986e0`](https://github.com/trytilde/dispatch/commit/87986e09320112b761ae4f8da7aa53c2052c1d99), [`380fbc5`](https://github.com/trytilde/dispatch/commit/380fbc56314485d94b1f8b51296fb854e2bb1550), [`6a9f124`](https://github.com/trytilde/dispatch/commit/6a9f124275f9e8230528a78e634d9413d981cf7c), [`2b0d90c`](https://github.com/trytilde/dispatch/commit/2b0d90c5ebbc457a2cfe2badafa7ad30dd0cb0e4), [`987ac27`](https://github.com/trytilde/dispatch/commit/987ac2713c7b1389e8c2cea45e7c84ce2de799f3), [`19dc06a`](https://github.com/trytilde/dispatch/commit/19dc06a9b02343fee33f071c7baa3072d6b33570), [`ce97171`](https://github.com/trytilde/dispatch/commit/ce97171a95681822b4355540fb4f8469fe4969f9), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`a99315c`](https://github.com/trytilde/dispatch/commit/a99315c1731a87ec7850ec05c240b14459d84c8a), [`c75b77d`](https://github.com/trytilde/dispatch/commit/c75b77d4c8f1940a5ce787a6e3c03e32b9abd659), [`a79856f`](https://github.com/trytilde/dispatch/commit/a79856fadab1916105edc8a1ce990f373cd9c1e4), [`ee6dc62`](https://github.com/trytilde/dispatch/commit/ee6dc622b6b5078bfa1306b19e0c41057e473b81), [`e8df3ca`](https://github.com/trytilde/dispatch/commit/e8df3cab93505bb092ee426c539175f9525d60f8), [`f73d6b8`](https://github.com/trytilde/dispatch/commit/f73d6b8b5742f7d9f0f5c8534a164c46b9b904a4), [`3c03ef1`](https://github.com/trytilde/dispatch/commit/3c03ef1364269165c4075b730cf5d990946e60e8), [`d6f9091`](https://github.com/trytilde/dispatch/commit/d6f90912c7e66b8df710b5aa0013fa764ce55851), [`7864111`](https://github.com/trytilde/dispatch/commit/7864111b64efbd5d2adf177bfaca25ae6fc077c7), [`892f44c`](https://github.com/trytilde/dispatch/commit/892f44c9ea8dae7b4776238689d7d7c7817d9def), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`52cce4c`](https://github.com/trytilde/dispatch/commit/52cce4ccda162f64cbd5ac4e74e6fa784138dce7), [`c7927b4`](https://github.com/trytilde/dispatch/commit/c7927b43a71551b8a4d4428a7528ecf650b399e8), [`d6bee5c`](https://github.com/trytilde/dispatch/commit/d6bee5c23ee5d74d1c0ac3cf899fa052034d30cc), [`206e39f`](https://github.com/trytilde/dispatch/commit/206e39f523fa2dd5421ab643d58f02ed9dedb8f3), [`20c5737`](https://github.com/trytilde/dispatch/commit/20c5737cffa4f165f023b3fdd7f7a59aaa26316e), [`bb957cf`](https://github.com/trytilde/dispatch/commit/bb957cfdb8451f61480f0935273f1d9912522222), [`bdd224c`](https://github.com/trytilde/dispatch/commit/bdd224c65312cabb11348d3931181569ff5947d0), [`4261e8c`](https://github.com/trytilde/dispatch/commit/4261e8c45e93fd360ee0cdf2c1734cdb8eb0577d), [`47d3725`](https://github.com/trytilde/dispatch/commit/47d372565423995def42543fff97753ab201e66f), [`165bfa2`](https://github.com/trytilde/dispatch/commit/165bfa2e2a50184f7899b1e466b3803ad1ed1acc), [`0c99101`](https://github.com/trytilde/dispatch/commit/0c99101c84c07441e1bb1eb94a684b7bb56872b1), [`b10e4ca`](https://github.com/trytilde/dispatch/commit/b10e4ca458c43bb36783770c68d9ab77bb7c4db8), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`8097727`](https://github.com/trytilde/dispatch/commit/80977279b1698672f86155fcaf3281b4cd77a701), [`d163506`](https://github.com/trytilde/dispatch/commit/d1635064bc407213821d0db2a81ed0fce4faff29), [`1ffa4df`](https://github.com/trytilde/dispatch/commit/1ffa4dfaf81152d7aac6819a1cccd33a58052811), [`a6a7913`](https://github.com/trytilde/dispatch/commit/a6a791320bfbd636f92ee658b58a27cb1d20cefc), [`14f0014`](https://github.com/trytilde/dispatch/commit/14f0014c23e15d03672af2a4b46411d3b6382a6b), [`26d0e7a`](https://github.com/trytilde/dispatch/commit/26d0e7abbd7c99decd17fbe961dc62943320720e), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`ebcc12b`](https://github.com/trytilde/dispatch/commit/ebcc12b9c8d5e0c155bfcda917622c5342189fdc), [`6cbc0b8`](https://github.com/trytilde/dispatch/commit/6cbc0b8aaa3d0cb83d1e4dc917438f92429019bd), [`1a103b4`](https://github.com/trytilde/dispatch/commit/1a103b4731f62a03a33340a9a805c82b262ed1f1), [`83d52e1`](https://github.com/trytilde/dispatch/commit/83d52e1468084e41499645b6ca7b036cf623f055), [`d677077`](https://github.com/trytilde/dispatch/commit/d677077954370423a77502f24199bbdacbae76ae), [`1784f6c`](https://github.com/trytilde/dispatch/commit/1784f6cc0b4552eb11b615b82d71e2190e7ba2e6), [`608839d`](https://github.com/trytilde/dispatch/commit/608839db733e8c5b023ca13087ffea0c8970cc83), [`81e7d28`](https://github.com/trytilde/dispatch/commit/81e7d28e5854d2086ffa687f0cbd448bfff8b730), [`4659f2b`](https://github.com/trytilde/dispatch/commit/4659f2b5101bee5766557368d4877a45f0b2bc11), [`1e8c974`](https://github.com/trytilde/dispatch/commit/1e8c9744676d92012f8fec41dc52793c896d2608), [`efbd743`](https://github.com/trytilde/dispatch/commit/efbd7433d6985917d226066e9acca67784992054), [`bd417b1`](https://github.com/trytilde/dispatch/commit/bd417b1d7bb0327c031cc4c11a05dfc11f5cb917), [`c5df8df`](https://github.com/trytilde/dispatch/commit/c5df8df5e0244d45c80deba036ce780c94cfc3b8), [`a865749`](https://github.com/trytilde/dispatch/commit/a865749af593eabe061bb33d137338e17ed78216), [`b1a2840`](https://github.com/trytilde/dispatch/commit/b1a284054b6b166e1409748d9b92faca4ce86bca), [`73ef020`](https://github.com/trytilde/dispatch/commit/73ef0208822f6db96a5b77a1c365cb2516ef6a0e), [`251c0c0`](https://github.com/trytilde/dispatch/commit/251c0c01cb513e9f55168d69fb6977d8b17d9ad4), [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb), [`1477c61`](https://github.com/trytilde/dispatch/commit/1477c61c2005fe91a50817ba980bc7c57605ead6), [`c9e839d`](https://github.com/trytilde/dispatch/commit/c9e839d33c664508ae13c25d48e76428ef09bcce), [`f9e0006`](https://github.com/trytilde/dispatch/commit/f9e0006633fe4f8c3e2c4edcf75bf8319f9120ac), [`c2b115e`](https://github.com/trytilde/dispatch/commit/c2b115ec173991e6403cbd10fa9d408705b4862a), [`2a4bbfc`](https://github.com/trytilde/dispatch/commit/2a4bbfcd14ffb0643c3f6ddb25c44fdf1aa89e8c), [`1258ab6`](https://github.com/trytilde/dispatch/commit/1258ab624e560ccebbc2ea658d1043b47917c13b)]:
  - @tryopenbot/client-runtime@1.0.0
  - @tryopenbot/ui@1.0.0
