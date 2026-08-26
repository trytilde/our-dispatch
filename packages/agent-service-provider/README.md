# @tryopenbot/agent-service-provider

Build and deployment providers for independently compiled agent entrypoints. It discovers Eve-shaped agent folders, runs instrumentation hooks, and can combine the agent functions with the web and control API in one deployable OpenBot runtime.

## Public API

### Functions

- `createAgentServiceApp(repositoryRoot, options?)` creates the development/local Hono app and mounts discovered `agent.ts` endpoints. Its optional `refreshEnvironment` callback runs before a newly scaffolded agent is loaded through the late-discovery route.
- `discoverAgents(repositoryRoot)` validates the primary `configuration/agent/agent.ts` and full `configuration/agent/subagents/<id>/agent.ts` entrypoints.
- `discoverAgentWorkspaces(repositoryRoot)` reads each agent's `sandbox/workspace/**` seed files for computer deployment.

### Classes

- `LocalAgentServiceProvider` implements the build and deploy lifecycle for one local Hono server and accepts `LocalAgentServiceProviderOptions`.
- `VercelAgentServiceProvider` builds agents concurrently into separate Vercel Functions and accepts `VercelAgentServiceProviderOptions`.
- `LocalRuntimeServiceProvider` builds and installs one local process containing the control API and all agent routes.
- `VercelRuntimeServiceProvider` publishes the static web app, one control Function, and independently bundled per-agent Functions as one atomic Vercel deployment.

Compose the same runtime-provider instance as both `controlService` and `agentService`. Lifecycle coordination recognizes that shared identity and checks, builds, configures, and deploys it once. Agent endpoints keep separate Vercel Function directories even though releases and rollbacks are atomic with control and web.

Both service providers leave development startup to OpenBot's watched Hono process. The Vercel
adapter performs its check but skips artifact creation, project configuration, and remote deployment
when `DeploymentContext.devMode` is `true`.

### Critical interfaces

- `AgentServiceProvider` combines `Buildable`, `Deployable`, and `InitializableProvider`.

Authored instrumentation helpers and types live in
`@tryopenbot/configuration/instrumentation`.

Each agent must default-export `chatKitEndpoint(...)` from `agent.ts`. Global instrumentation runs before optional agent-local instrumentation and before the endpoint import. Each agent must explicitly contain `bash.ts`, `await_shell.ts`, `read_file.ts`, `write_file.ts`, `copy_to_computer.ts`, `copy_from_computer.ts`, `glob.ts`, `grep.ts`, and `screenshot.ts`. Those Zod-schema Vercel AI SDK tools are imported by `agent.ts`, use the typed computer-service transport, and hide their fixed agent ID from model input; arbitrary authored tools and skills are not directory-loaded.
