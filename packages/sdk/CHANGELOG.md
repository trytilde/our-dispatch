# @trytilde/sdk

## 0.2.0

### Minor Changes

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add agent-owned context compaction with durable ChatKit lifecycle reporting and restart-safe handoff summaries.

- [#120](https://github.com/trytilde/dispatch/pull/120) [`db20bc5`](https://github.com/trytilde/dispatch/commit/db20bc531bb246b3962a79e2d7c58a1d6620a0a3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add automatic memory recall, owner-managed facts, and a least-privilege Memory Catcher synthesizer to OpenBot bots.

- [#87](https://github.com/trytilde/dispatch/pull/87) [`2156336`](https://github.com/trytilde/dispatch/commit/2156336d885f78a8b0d485d69e1c92bbd87c7715) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add consolidated ChatKit search across bots, conversation titles, and messages to the shared client runtime and expose it in the web, Electron, and mobile clients.

- [#107](https://github.com/trytilde/dispatch/pull/107) [`ed8e843`](https://github.com/trytilde/dispatch/commit/ed8e843b9ccfc104b7b7fd57266b22c32bc44eb1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add active-turn-bound ChatKit messaging, provider actions, tool response mode, and MCP access to session communication tools.

- [#106](https://github.com/trytilde/dispatch/pull/106) [`a200646`](https://github.com/trytilde/dispatch/commit/a2006462dc4963669cad3bc04f1192bcb2b4c763) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add canonical ChatKit registration and execution reporting for local Vercel AI SDK tools, including first-class dynamic child correlation, and enable it in generated OpenBot agents.

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add session-bound goal and task management APIs and default agent tools for durable work tracking.

- [#115](https://github.com/trytilde/dispatch/pull/115) [`3c85b64`](https://github.com/trytilde/dispatch/commit/3c85b6488802a0e3f002311949fe40d42dbe824a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add Codex, Claude Code, and Cursor hook adapters that record searchable ChatKit messages and canonical tool executions while `openbot plugin` installs Tilde MCP servers and skills.

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add high-level durable background-agent job helpers and a default authored tool for delegating, inspecting, steering, stopping, resuming, and collecting child work.

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a durable AgentRun host with continuation limits, budget enforcement, restart recovery, and side-effect receipts.

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Expose durable goals, tasks, background jobs, and routines through the shared web/Electron Work pane and teach default agents when to plan, delegate, steer, and schedule recurring work.

- [#123](https://github.com/trytilde/dispatch/pull/123) [`25563d9`](https://github.com/trytilde/dispatch/commit/25563d961711e4745d0817c8ed1e353130ff6e80) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add AI-credit reservation and receipt APIs, meter managed project-OIDC model calls with durable AgentRun effect recovery, release authoritative BYOK receipts, and exclude direct-key and subscription-backed inference.

- [#122](https://github.com/trytilde/dispatch/pull/122) [`b4bbd3a`](https://github.com/trytilde/dispatch/commit/b4bbd3a405466ff6d7a5883872b8da75dc654b66) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add high-level multiplayer ChatKit room, roster, invitation, departure, and bounded group orchestration helpers.

- [#85](https://github.com/trytilde/dispatch/pull/85) [`eaaed88`](https://github.com/trytilde/dispatch/commit/eaaed88000343b179e664d6ccfa33a45065a23d2) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add generated API support for personal and private-team resource ownership and caller-specific MCP tool federation.

- [#121](https://github.com/trytilde/dispatch/pull/121) [`848f821`](https://github.com/trytilde/dispatch/commit/848f821b87f161521a3b862379f27c2a7cc398c9) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add durable human-reviewed self-extension proposals and a propose-only default agent tool.

- [`19dc06a`](https://github.com/trytilde/dispatch/commit/19dc06a9b02343fee33f071c7baa3072d6b33570) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Provision each authored agent through Tilde's durable Agent Resource Bundle API with a stable machine-user profile, uploaded avatar, default memory bank, safe credential rotation, and human-owned creation followed by machine reconciliation.

- [#82](https://github.com/trytilde/dispatch/pull/82) [`a99315c`](https://github.com/trytilde/dispatch/commit/a99315c1731a87ec7850ec05c240b14459d84c8a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add atomic bulk MCP server function mapping methods and use one request when reconciling an agent's Tilde control-plane toolkit.

- [#116](https://github.com/trytilde/dispatch/pull/116) [`ee6dc62`](https://github.com/trytilde/dispatch/commit/ee6dc622b6b5078bfa1306b19e0c41057e473b81) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add OpenCode and Gemini CLI adapters that record searchable ChatKit messages and canonical tool executions while `openbot plugin` installs their native audit integrations.

- [#86](https://github.com/trytilde/dispatch/pull/86) [`7864111`](https://github.com/trytilde/dispatch/commit/7864111b64efbd5d2adf177bfaca25ae6fc077c7) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Consolidate workspace loading, turns, attachments, connector setup, and bot reconciliation through aggregate Tilde API operations.

- [#143](https://github.com/trytilde/dispatch/pull/143) [`39e8b62`](https://github.com/trytilde/dispatch/commit/39e8b62d175e52bf644d92989fcb8e7505e1095e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Send typed memory fields and lease-bound synthesis commands without internal metadata protocols.

- [#129](https://github.com/trytilde/dispatch/pull/129) [`d677077`](https://github.com/trytilde/dispatch/commit/d677077954370423a77502f24199bbdacbae76ae) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Meter Memory Catcher synthesis through durable hosted inference billing.

- [#96](https://github.com/trytilde/dispatch/pull/96) [`1784f6c`](https://github.com/trytilde/dispatch/commit/1784f6cc0b4552eb11b615b82d71e2190e7ba2e6) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Migrate OpenBot to Tilde's regular ChatKit activity, agent, session, message, search, turn, and realtime-ticket REST routes while preserving the ChatKit realtime contract.

  Migration:

  - Replace `OpenBotClient.getBootstrap` with `OpenBotClient.getActivity`.
  - Read the agent page from the activity response's `activity` field.

- [`e6a2c5e`](https://github.com/trytilde/dispatch/commit/e6a2c5e0f173687aa87680aa4c28681f04afe19f) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add personal Memory source-binding and Wiki grep API operations.

- [#118](https://github.com/trytilde/dispatch/pull/118) [`8e98d8f`](https://github.com/trytilde/dispatch/commit/8e98d8f28ebbe4e0339b2e95641a0d85dc5aed2e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Expose personal memory source bindings, Wiki search, and participant session activity from the current Tilde API contract.

### Patch Changes

- [#149](https://github.com/trytilde/dispatch/pull/149) [`a151205`](https://github.com/trytilde/dispatch/commit/a151205fde32938f9342e09b63d6ec155a33aa5b) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Treat a missing active `AgentRun` as an empty result so a new run can be created.

- [`49d186b`](https://github.com/trytilde/dispatch/commit/49d186be001b50452ff58eff99265eed5e5f0fd1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Update canonical repository, fork, package, and publication URLs after the GitHub repositories moved to `trytilde/dispatch` and `trytilde/our-dispatch`.

- Updated dependencies [[`db20bc5`](https://github.com/trytilde/dispatch/commit/db20bc531bb246b3962a79e2d7c58a1d6620a0a3), [`2156336`](https://github.com/trytilde/dispatch/commit/2156336d885f78a8b0d485d69e1c92bbd87c7715), [`ed8e843`](https://github.com/trytilde/dispatch/commit/ed8e843b9ccfc104b7b7fd57266b22c32bc44eb1), [`a200646`](https://github.com/trytilde/dispatch/commit/a2006462dc4963669cad3bc04f1192bcb2b4c763), [`eaaed88`](https://github.com/trytilde/dispatch/commit/eaaed88000343b179e664d6ccfa33a45065a23d2), [`19dc06a`](https://github.com/trytilde/dispatch/commit/19dc06a9b02343fee33f071c7baa3072d6b33570), [`a99315c`](https://github.com/trytilde/dispatch/commit/a99315c1731a87ec7850ec05c240b14459d84c8a), [`7864111`](https://github.com/trytilde/dispatch/commit/7864111b64efbd5d2adf177bfaca25ae6fc077c7), [`a6a7913`](https://github.com/trytilde/dispatch/commit/a6a791320bfbd636f92ee658b58a27cb1d20cefc), [`1784f6c`](https://github.com/trytilde/dispatch/commit/1784f6cc0b4552eb11b615b82d71e2190e7ba2e6), [`e6a2c5e`](https://github.com/trytilde/dispatch/commit/e6a2c5e0f173687aa87680aa4c28681f04afe19f), [`8e98d8f`](https://github.com/trytilde/dispatch/commit/8e98d8f28ebbe4e0339b2e95641a0d85dc5aed2e), [`49d186b`](https://github.com/trytilde/dispatch/commit/49d186be001b50452ff58eff99265eed5e5f0fd1)]:
  - @trytilde/api-client@0.2.0
