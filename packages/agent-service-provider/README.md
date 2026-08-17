# @tryopenbot/agent-service-provider

Build and deployment providers for independently compiled agent entrypoints. It discovers Eve-shaped agent folders, runs instrumentation hooks, builds one fast function per agent for Vercel, or federates all agents in one local Hono service.

## Public API

### Functions

- `createAgentServiceApp(repositoryRoot, options?)` creates the development/local Hono app and mounts discovered `agent.ts` endpoints.
- `discoverAgents(repositoryRoot)` validates the primary `configuration/agent/agent.ts` and full `configuration/agent/subagents/<id>/agent.ts` entrypoints.
- `discoverAgentWorkspaces(repositoryRoot)` reads each agent's `sandbox/workspace/**` seed files for computer deployment.

### Classes

- `LocalAgentServiceProvider` implements the build and deploy lifecycle for one local Hono server and accepts `LocalAgentServiceProviderOptions`.
- `VercelAgentServiceProvider` builds agents concurrently into separate Vercel Functions and accepts `VercelAgentServiceProviderOptions`.

Both service providers leave development startup to OpenBot's watched Hono process. The Vercel
adapter performs its check but skips artifact creation, project configuration, and remote deployment
when `DeploymentContext.devMode` is `true`.

### Critical interfaces

- `AgentServiceProvider` combines `Buildable`, `Deployable`, and `InitializableProvider`.

Authored instrumentation helpers and types live in
`@tryopenbot/configuration/instrumentation`.

Each agent must default-export `chatKitEndpoint(...)` from `agent.ts`. Global instrumentation runs before optional agent-local instrumentation and before the endpoint import. Each agent must explicitly contain `bash.ts`, `await_shell.ts`, `read_file.ts`, `write_file.ts`, `copy_to_computer.ts`, `copy_from_computer.ts`, `glob.ts`, `grep.ts`, and `screenshot.ts`. Those Zod-schema Vercel AI SDK tools are imported by `agent.ts`, use the typed computer-service transport, and hide their fixed agent ID from model input; arbitrary authored tools and skills are not directory-loaded.
