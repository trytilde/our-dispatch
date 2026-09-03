# @trytilde/sdk-vercel-ai-node

## 1.0.0

### Minor Changes

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add agent-owned context compaction with durable ChatKit lifecycle reporting and restart-safe handoff summaries.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add strongly typed AgentMail ChatKit context and Signals handlers.

- [#120](https://github.com/trytilde/dispatch/pull/120) [`db20bc5`](https://github.com/trytilde/dispatch/commit/db20bc531bb246b3962a79e2d7c58a1d6620a0a3) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add automatic memory recall, owner-managed facts, and a least-privilege Memory Catcher synthesizer to OpenBot bots.

- [#109](https://github.com/trytilde/dispatch/pull/109) [`97b6c20`](https://github.com/trytilde/dispatch/commit/97b6c20aa1fa181667752a2e198c787354c64a12) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Expose canonical receiving-agent metadata through `ChatKitEndpointContext.agent`.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Attribute ChatKit speakers and scope MCP connections to a session.

  Inbound ChatKit messages now carry a structured `identity` block, so an agent in a
  multi-party session can tell participants apart. `convertToAiSdkMessage` prefixes the
  first text part of an attributed message with the speaker's label, leaving the agent's
  own assistant messages untouched. The label is re-sanitized before it is concatenated
  into model-visible text, because a display name is chosen by whoever sent the message.

  Request bodies now also carry `session` provenance. Use `sessionProvenanceInstruction`
  to add a system-prompt line when a reply is delivered back to the platform the
  conversation started on, so an agent answering an email does not write as if it were in
  a chat window.

  `createMCPClient` accepts a `chatkit: { sessionId, permissions }` option that scopes the
  connection to one ChatKit session. Tilde offers session-scoped tools, delegation among
  them, only on a scoped connection, and rejects a connection naming a session the caller
  may not use rather than silently omitting those tools.

- [#107](https://github.com/trytilde/dispatch/pull/107) [`ed8e843`](https://github.com/trytilde/dispatch/commit/ed8e843b9ccfc104b7b7fd57266b22c32bc44eb1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add active-turn-bound ChatKit messaging, provider actions, tool response mode, and MCP access to session communication tools.

- [#106](https://github.com/trytilde/dispatch/pull/106) [`a200646`](https://github.com/trytilde/dispatch/commit/a2006462dc4963669cad3bc04f1192bcb2b4c763) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add canonical ChatKit registration and execution reporting for local Vercel AI SDK tools, including first-class dynamic child correlation, and enable it in generated OpenBot agents.

- [#125](https://github.com/trytilde/dispatch/pull/125) [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add a durable AgentRun host with continuation limits, budget enforcement, restart recovery, and side-effect receipts.

- [#123](https://github.com/trytilde/dispatch/pull/123) [`25563d9`](https://github.com/trytilde/dispatch/commit/25563d961711e4745d0817c8ed1e353130ff6e80) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add AI-credit reservation and receipt APIs, meter managed project-OIDC model calls with durable AgentRun effect recovery, release authoritative BYOK receipts, and exclude direct-key and subscription-backed inference.

- [`c76c1ec`](https://github.com/trytilde/dispatch/commit/c76c1ecad1786c02a129d49af0598c913f0d71cb) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add strongly typed Linq ChatKit provider context and event-specific Signal handlers.

- [#122](https://github.com/trytilde/dispatch/pull/122) [`b4bbd3a`](https://github.com/trytilde/dispatch/commit/b4bbd3a405466ff6d7a5883872b8da75dc654b66) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Add opt-in speaker-bound personal tool federation for shared ChatKit agents.

- [#105](https://github.com/trytilde/dispatch/pull/105) [`3e834fe`](https://github.com/trytilde/dispatch/commit/3e834fe854a994e2e408fb6a2ae8262b1d6e2524) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Remove `chatkit.permissions` from `createMCPClient`. What an agent may reach is
  now recorded on the agent in Tilde and enforced there, so the client no longer
  declares it. A permission sent from the client was a claim by whoever held the
  credentials rather than a decision by whoever administers the team, and two
  clients connecting as the same agent could have declared different reach.

  Nothing needs to replace it in client code: the session-scoped tools an agent is
  offered are already filtered to what its record permits, so an agent without a
  delegation grant simply is not shown the delegation tools. Change what an agent
  may reach on its page in Tilde.

- [#129](https://github.com/trytilde/dispatch/pull/129) [`d677077`](https://github.com/trytilde/dispatch/commit/d677077954370423a77502f24199bbdacbae76ae) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Meter Memory Catcher synthesis through durable hosted inference billing.

- [`49d186b`](https://github.com/trytilde/dispatch/commit/49d186be001b50452ff58eff99265eed5e5f0fd1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Consume Tilde-authored AgentRun, delegated-job, and message timestamp fields through typed ChatKit request context instead of message metadata.

### Patch Changes

- [`1e8c974`](https://github.com/trytilde/dispatch/commit/1e8c9744676d92012f8fec41dc52793c896d2608) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Centralize graphical browser and desktop work in a CUA-only Computer specialist, with per-agent resource policies and delegated display provenance so callers keep their existing screen and browser profile.

- [#143](https://github.com/trytilde/dispatch/pull/143) [`39e8b62`](https://github.com/trytilde/dispatch/commit/39e8b62d175e52bf644d92989fcb8e7505e1095e) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Send typed memory fields and lease-bound synthesis commands without internal metadata protocols.

- [`14f0014`](https://github.com/trytilde/dispatch/commit/14f0014c23e15d03672af2a4b46411d3b6382a6b) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Force explicit graphical requests through the team-visible Computer specialist, answer self-contained questions without acknowledgements, preserve requested browser URLs, and suppress overlays that block visual work.

- [`49d186b`](https://github.com/trytilde/dispatch/commit/49d186be001b50452ff58eff99265eed5e5f0fd1) Thanks [@danielblignaut](https://github.com/danielblignaut)! - Update canonical repository, fork, package, and publication URLs after the GitHub repositories moved to `trytilde/dispatch` and `trytilde/our-dispatch`.

- Updated dependencies [[`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449), [`db20bc5`](https://github.com/trytilde/dispatch/commit/db20bc531bb246b3962a79e2d7c58a1d6620a0a3), [`2156336`](https://github.com/trytilde/dispatch/commit/2156336d885f78a8b0d485d69e1c92bbd87c7715), [`ed8e843`](https://github.com/trytilde/dispatch/commit/ed8e843b9ccfc104b7b7fd57266b22c32bc44eb1), [`a200646`](https://github.com/trytilde/dispatch/commit/a2006462dc4963669cad3bc04f1192bcb2b4c763), [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449), [`3c85b64`](https://github.com/trytilde/dispatch/commit/3c85b6488802a0e3f002311949fe40d42dbe824a), [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449), [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449), [`5b0c812`](https://github.com/trytilde/dispatch/commit/5b0c81228af72d9461534285698deb2732646449), [`25563d9`](https://github.com/trytilde/dispatch/commit/25563d961711e4745d0817c8ed1e353130ff6e80), [`b4bbd3a`](https://github.com/trytilde/dispatch/commit/b4bbd3a405466ff6d7a5883872b8da75dc654b66), [`eaaed88`](https://github.com/trytilde/dispatch/commit/eaaed88000343b179e664d6ccfa33a45065a23d2), [`848f821`](https://github.com/trytilde/dispatch/commit/848f821b87f161521a3b862379f27c2a7cc398c9), [`19dc06a`](https://github.com/trytilde/dispatch/commit/19dc06a9b02343fee33f071c7baa3072d6b33570), [`a99315c`](https://github.com/trytilde/dispatch/commit/a99315c1731a87ec7850ec05c240b14459d84c8a), [`ee6dc62`](https://github.com/trytilde/dispatch/commit/ee6dc622b6b5078bfa1306b19e0c41057e473b81), [`7864111`](https://github.com/trytilde/dispatch/commit/7864111b64efbd5d2adf177bfaca25ae6fc077c7), [`a151205`](https://github.com/trytilde/dispatch/commit/a151205fde32938f9342e09b63d6ec155a33aa5b), [`39e8b62`](https://github.com/trytilde/dispatch/commit/39e8b62d175e52bf644d92989fcb8e7505e1095e), [`d677077`](https://github.com/trytilde/dispatch/commit/d677077954370423a77502f24199bbdacbae76ae), [`1784f6c`](https://github.com/trytilde/dispatch/commit/1784f6cc0b4552eb11b615b82d71e2190e7ba2e6), [`e6a2c5e`](https://github.com/trytilde/dispatch/commit/e6a2c5e0f173687aa87680aa4c28681f04afe19f), [`8e98d8f`](https://github.com/trytilde/dispatch/commit/8e98d8f28ebbe4e0339b2e95641a0d85dc5aed2e), [`49d186b`](https://github.com/trytilde/dispatch/commit/49d186be001b50452ff58eff99265eed5e5f0fd1)]:
  - @trytilde/sdk@0.2.0
