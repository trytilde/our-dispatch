---
name: implement-provider
description: Add or refactor an OpenBot provider implementation while preserving narrow control, provisioning, initialization, and deployment boundaries. Use whenever editing a provider package or changing provider-specific build, deploy, initialization, or external resource reconciliation.
---

# Implement an OpenBot provider

Keep provider-specific behavior behind its domain core contract and keep composition outside the adapter. Read the relevant ADRs, the owning package's `src/core.ts` or `src/core/index.ts`, implementation, runtime selection, and focused tests before editing. Do not create a separate `*-provider-core` package.

## Workflow

1. Identify the concrete consumer. A provider operation is valid only when used by the control service, initialization/startup provisioning, external resource reconciliation, or a check/build/deploy lifecycle. Remove unused and speculative contract methods. Do not expose an internal provider interface through RPC unless a user-facing service boundary requires it.
2. Read the matching provider package, configuration composition, and tests. Preserve `ProviderCallContext`, `ProviderError`, cancellation, deadlines, request IDs, and idempotency where the contract defines them. If the change alters provider construction or runtime assumptions in `configuration/index.ts`, inspect `configuration/templates/agent/` too. Update the fork-owned agent template when newly scaffolded agents need different environment variables, tools, prompts, or endpoint wiring.
3. Add the smallest provider-specific implementation. Keep selection in composition code. Before adding vendor helpers, inspect `@tryopenbot/platform-integrations`: shared platform clients, authentication, request/error normalization, account lookup, deployment commands, and other cross-domain vendor operations belong under `src/<platform>/<responsibility>.ts`. Domain-specific API calls and record mapping stay in the adapter.
4. Implement only the initialization or lifecycle capabilities the provider supports. Every hook must be idempotent: repeated calls reconcile stable resources and never create duplicates. Keep vendor-specific get/create/update/delete sequences and configuration persistence inside the adapter; CLI code only schedules hooks. An inference provider may provision accounts or credentials, but providers must not supply model factories, prompts, AI SDK tools, or arbitrary vendor functions to authored agents. Code under `configuration/agent/`, including `subagents/`, must integrate its SDKs directly and must not import provider packages. Put shared non-provider runtime utilities in a purpose-specific package.
5. Add focused contract and artifact tests, then run the provider package checks before broader repository gates.

Provider metadata is limited to vendor-specific facts that cannot be
normalized into the provider's core contract, and only the concrete adapter
may interpret it. IDs, lifecycle relationships, routing, deployment state,
models, budgets, credentials, and fields shared across providers belong in
typed provider/platform contracts. Do not use metadata to avoid changing
`src/core.ts`, generated Tilde contracts, configuration, or deployment output
types.

## Provider layout

- Define every domain provider contract interface, such as `AgentProvider`, `ComputerProvider`, `SkillProvider`, or `ToolProvider`, in `src/core.ts`. When the contract needs supporting core modules, use `src/core/index.ts` as its entrypoint instead.
- Re-export the core contract from the package root. Never define a provider contract interface in `src/index.ts`, a concrete adapter file, or a provider-specific directory. Adapter configuration and SDK-specific types stay with their adapter.
- A small implementation may live at `src/<provider>.ts`.
- When an implementation has multiple responsibilities or owns files used at runtime, use `src/<provider>/index.ts`, cohesive sibling modules, and `src/<provider>/assets/`.
- Export the public implementation from `<provider>/index.ts`, then re-export it from the package root.
- Prefer a file per provider. Split by responsibility, not by arbitrary line count.
- Do not add provider descriptors or generic `createProvider(type)` selectors. The fork explicitly imports and constructs concrete implementations under `Configuration({ providers: { ... } })` in `configuration/index.ts`.
- Keep composition and scaffolding aligned. A provider change in `configuration/index.ts` may require a matching change under `configuration/templates/agent/`; the primary agent and existing `configuration/agent/subagents/<id>/` remain owner-authored and require an explicit migration when their runtime wiring must change.
- Inspect agent templates because their direct integrations may require matching environment or endpoint changes, not because they should consume the provider. Composio and other agent-specific integrations belong directly in agent and template code.
- Do not add `health()` or `verify()` to provider interfaces or implementations unless an explicit domain requirement calls for that exact operation. Keep service health endpoints and deployment smoke checks at their owning service/runtime boundary.

## Shared platforms

- Providers that use the same external platform reference one concrete `Platform` instance through `platforms`; they do not duplicate platform initialization metadata.
- Put shared Tilde behavior under `packages/platform-integrations/src/tilde/` and shared Vercel behavior under `packages/platform-integrations/src/vercel/`, split by cohesive responsibility such as `errors.ts`, `fetch.ts`, `deployment.ts`, or `registry.ts`.
- Move common vendor helpers into the platform package when implementing or updating a provider. Do not make one domain provider the utility dependency of another domain provider.
- Keep domain contracts, domain error translation, entity mapping, prompts specific to one provider role, and lifecycle behavior specific to one artifact in the owning provider package.
- Add focused platform contract tests for shared helpers and focused provider tests proving each adapter still maps platform results and failures to its domain contract.

## Provider-owned assets

- Store TypeScript, JavaScript, JSON, service units, plists, shell files, and every other generated-file source under `assets/` as Handlebars templates with the target extension followed by `.hbs`, such as `entry.ts.hbs` or `vercel.json.hbs`. Do not embed whole files in TypeScript string literals.
- Resolve templates relative to `import.meta.url` and render them through `@tryopenbot/utilities`. Build and deploy methods must render or bundle every required template into their ignored artifact; do not materialize provider assets with `copyFile()` even when a template is currently static.
- Put assets shared completely by sibling providers under `src/base/assets/`; add provider-specific asset directories only when their contents or control flow actually diverge.
- Use strict templates so missing values fail. Escape values for the target format before rendering. Use ordinary Handlebars expressions for text that needs HTML escaping and triple braces only for deliberately pre-encoded target-language fragments such as `JSON.stringify(...)` output.
- Do not create ad hoc `replaceAll()` renderers, multiline whole-file strings, or alternate template engines.
- Keep runtime persistence, database contents, lifecycle bundle bytes, and user-supplied file contents byte-preserving. They are data, not generated-file templates.
- Exclude executable TypeScript templates under `assets/` from the provider package typecheck when placeholders make them intentionally incomplete.
- Test that materialized files exist and contain the expected structure. Do not snapshot secrets or deployment credentials.

## Build and deploy providers

- `check()` validates prerequisites without producing the release.
- `build()` creates software artifacts and returns their paths through deployment outputs.
- `plan()`, optional `configure()`, and `deploy()` consume named outputs and the single mutable `context.environment` map loaded from `.env` plus decrypted secrets. Providers without `Deployable` are skipped by deployment coordination. All hooks must be safe to call repeatedly; test the second call does not create another remote resource.
- Persist values at the owning provider with `persistEnvironment`, `persistSecret`, `unsetEnvironment`, and `unsetSecret`. `DeploymentResult` contains only named handoff outputs; never put environment or secret mutations in it.
- Final runtime and ordinary agent-Computer installers must still exclude control-plane credentials. The trusted development sandbox is the explicit exception and receives the complete fork environment plus encrypted secrets and its private age-key file. Never print secret values or write them into public artifacts.
- Container images compile their packaged services in a multi-stage build; never copy a host-precompiled `dist` bundle into an image.
- Computer providers expose the capability-protected computer-service transport to the later agent-service deployment. Agent-authored computer tools call that typed service, not Microsandbox or Vercel Sandbox directly; computer-service validates the agent ID, selects `/workspace/<agent-id>` as the relative default, and scopes background jobs. Agents intentionally share the computer process identity and filesystem.

## Vercel providers

- Do not track a root `vercel.json`. Store provider-specific project configuration at `src/vercel/assets/vercel.json.hbs`; the Vercel deploy lifecycle renders it in the ignored artifact root immediately before deployment.
- Store Function sources, `.vc-config.json`, and Build Output API `config.json` as Handlebars assets. The build method renders or bundles them into `.vercel/output`.
- Treat `.vercel/output/config.json` as the routing authority for `vercel deploy --prebuilt`; `vercel.json` is project configuration, not a substitute for Build Output configuration.
- Preserve independently built control and agent-service artifacts and run agent function builds concurrently.

## Verification

Run the focused platform and provider tests and typechecks. Audit the diff for duplicated Tilde/Vercel helpers, cross-domain provider utility imports, provider contract interfaces outside `src/core.ts` or `src/core/index.ts`, embedded whole-file templates, non-Handlebars generation, raw provider-asset copies, stale flat-provider imports, secrets, and unrelated generated output. Run `pnpm check` and `pnpm build` when the change affects deployment artifacts or shared contracts.
Also audit metadata: every metadata key must be provider-specific, name its sole
adapter owner, and remain invisible to core OpenBot behavior and renderers.
