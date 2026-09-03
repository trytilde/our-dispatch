# @trytilde/api-client

## 0.2.0

### Minor Changes

- [#120](https://github.com/trytilde/dispatch/pull/120) [`db20bc5`](https://github.com/trytilde/dispatch/commit/db20bc531bb246b3962a79e2d7c58a1d6620a0a3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add automatic memory recall, owner-managed facts, and a least-privilege Memory Catcher synthesizer to OpenBot bots.

- [#87](https://github.com/trytilde/dispatch/pull/87) [`2156336`](https://github.com/trytilde/dispatch/commit/2156336d885f78a8b0d485d69e1c92bbd87c7715) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add consolidated ChatKit search across bots, conversation titles, and messages to the shared client runtime and expose it in the web, Electron, and mobile clients.

- [#107](https://github.com/trytilde/dispatch/pull/107) [`ed8e843`](https://github.com/trytilde/dispatch/commit/ed8e843b9ccfc104b7b7fd57266b22c32bc44eb1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add active-turn-bound ChatKit messaging, provider actions, tool response mode, and MCP access to session communication tools.

- [#106](https://github.com/trytilde/dispatch/pull/106) [`a200646`](https://github.com/trytilde/dispatch/commit/a2006462dc4963669cad3bc04f1192bcb2b4c763) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add canonical ChatKit registration and execution reporting for local Vercel AI SDK tools, including first-class dynamic child correlation, and enable it in generated OpenBot agents.

- [#85](https://github.com/trytilde/dispatch/pull/85) [`eaaed88`](https://github.com/trytilde/dispatch/commit/eaaed88000343b179e664d6ccfa33a45065a23d2) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add generated API support for personal and private-team resource ownership and caller-specific MCP tool federation.

- [`19dc06a`](https://github.com/trytilde/dispatch/commit/19dc06a9b02343fee33f071c7baa3072d6b33570) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Provision each authored agent through Tilde's durable Agent Resource Bundle API with a stable machine-user profile, uploaded avatar, default memory bank, safe credential rotation, and human-owned creation followed by machine reconciliation.

- [#82](https://github.com/trytilde/dispatch/pull/82) [`a99315c`](https://github.com/trytilde/dispatch/commit/a99315c1731a87ec7850ec05c240b14459d84c8a) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add atomic bulk MCP server function mapping methods and use one request when reconciling an agent's Tilde control-plane toolkit.

- [#86](https://github.com/trytilde/dispatch/pull/86) [`7864111`](https://github.com/trytilde/dispatch/commit/7864111b64efbd5d2adf177bfaca25ae6fc077c7) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Consolidate workspace loading, turns, attachments, connector setup, and bot reconciliation through aggregate Tilde API operations.

- [#73](https://github.com/trytilde/dispatch/pull/73) [`a6a7913`](https://github.com/trytilde/dispatch/commit/a6a791320bfbd636f92ee658b58a27cb1d20cefc) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Move the Tilde TypeScript SDK into the OpenBot monorepo under the `@trytilde/sdk*` package names and add Tilde authentication, state, tunnel, plugin, and SDK workflows to `openbot`.

  Migration:

  - Replace `@trytilde/harness-sdk*` imports with the corresponding `@trytilde/sdk*` package.
  - Replace `@trytilde/harness-plugins` and coding-agent wrapper binaries with `openbot plugin`.
  - Replace `tilde auth|state|tunnel` with `openbot auth|state|tunnel`.

- [#96](https://github.com/trytilde/dispatch/pull/96) [`1784f6c`](https://github.com/trytilde/dispatch/commit/1784f6cc0b4552eb11b615b82d71e2190e7ba2e6) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Migrate OpenBot to Tilde's regular ChatKit activity, agent, session, message, search, turn, and realtime-ticket REST routes while preserving the ChatKit realtime contract.

  Migration:

  - Replace `OpenBotClient.getBootstrap` with `OpenBotClient.getActivity`.
  - Read the agent page from the activity response's `activity` field.

- [`e6a2c5e`](https://github.com/trytilde/dispatch/commit/e6a2c5e0f173687aa87680aa4c28681f04afe19f) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add personal Memory source-binding and Wiki grep API operations.

- [#118](https://github.com/trytilde/dispatch/pull/118) [`8e98d8f`](https://github.com/trytilde/dispatch/commit/8e98d8f28ebbe4e0339b2e95641a0d85dc5aed2e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Expose personal memory source bindings, Wiki search, and participant session activity from the current Tilde API contract.

### Patch Changes

- [`49d186b`](https://github.com/trytilde/dispatch/commit/49d186be001b50452ff58eff99265eed5e5f0fd1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Update canonical repository, fork, package, and publication URLs after the GitHub repositories moved to `trytilde/dispatch` and `trytilde/our-dispatch`.
