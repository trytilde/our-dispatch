# Providers

Providers adapt OpenBot itself to external systems. Keep a provider only when at least one of these owns the call:

- the control service, on behalf of the desktop or web app;
- initialization or startup provisioning;
- a `check`, `build`, `plan`, `configure`, or `deploy` lifecycle;
- reconciliation of external resources required before OpenBot starts.

Anything else belongs in the code that actually uses it.

## Current boundaries

| Package | Responsibility |
| --- | --- |
| `agent-provider` | Reconcile each authored agent's complete external footprint through one idempotent `Deployable`: endpoint, skills, exact registry membership, dynamic MCP server, Tilde control-plane tools, and deployment-platform MCP integrations. |
| `inference-provider` | Initialize inference accounts and provision credentials such as a Vercel AI Gateway API key. It exposes no model factory to authored agents. |
| `computer-provider` | Build and deploy the Computer image, provision Computers, install agent workspaces, and prepare the trusted development Computer. |
| `control-service-provider` | Check, build, configure, and deploy the control-service artifact. |
| `agent-service-provider` | Discover authored agents and check, build, configure, and deploy their service artifacts. |
| `runtime-provider` | Shared initialization, build, and phased deployment contracts and coordination. |
| `platform-integrations` | Shared Tilde, Vercel, and other vendor plumbing used by multiple provider packages. It is not a domain provider. |

Provider contracts live in `src/core.ts` or `src/core/` in their owning package. Concrete adapters live beside the contract. A contract should contain only operations used by the boundaries above. Remove speculative methods instead of preserving a generic provider API.

Every lifecycle method is idempotent. `check`, `build`, `plan`, `configure`, and `deploy` may be called repeatedly. Implementations must reconcile stable identities and update mutable fields without creating duplicates. CLI code only schedules hooks. Each provider owns its vendor-specific get/create/update/delete sequence and persists its own environment or encrypted secrets through `runtime-provider` helpers. `DeploymentResult` is reserved for named handoff outputs.

Authored-agent reconciliation discovers agents once and supplies one Agent Provider lifecycle with the agent ID and absolute source path. The Tilde implementation reconciles the endpoint first, then authored skills and exact registry membership, then MCP and tool resources. A partially completed run is safe to repeat.

The built-in Tilde adapters use the typed API client directly. They identify resources by persisted IDs and stable OpenBot names, create missing resources, compare mutable fields, and update only drift. Authored `SKILL.md` files are keyed by repository-relative source path; removed files are removed from the agent-owned remote set and registry membership is exact. OpenBot does not import or export a Tilde state file during normal lifecycles. An operator may use the Tilde CLI manually to export a team's state and import it into another team for one-time setup or environment migration; OpenBot then resumes idempotent API reconciliation against that imported state.

Every Tilde agent receives a dynamic MCP server and a team-scoped Tilde control-plane toolkit. When the selected service deployment platform is Vercel, the Agent Provider's internal tools reconciler also manages Vercel's proxied MCP connection using the configured Vercel token. Development agent endpoints use Tilde local-runtime tunnel mode; production endpoints use their public service origin. Authored local tools execute inside that agent service, so they share its tunnel instead of registering a second custom HTTP endpoint.

## Authored agents do not use providers

Code under `configuration/agent/`, including `subagents/<id>/`, must not import provider packages or `configuration/index.ts`. Providers do not contribute model objects, prompts, AI SDK tools, arbitrary vendor methods, or generic plugin functions to an agent.

Integrate the desired SDK directly in the authored agent. For example, an agent may use OpenAI, Anthropic, Tilde, Composio, or a custom API without first extending a provider interface. This keeps agent development unconstrained by OpenBot's control-plane abstractions.

Shared utilities that are not providers may still be imported. Instrumentation lives in `@tryopenbot/configuration/instrumentation`. The standard typed Computer tools live in `@tryopenbot/computer-tools`; they call the Computer service rather than a Computer provider.

When all future agents need the same integration, update `configuration/templates/agent/`. Template changes affect newly scaffolded agents only, so migrate the primary and existing directories under `configuration/agent/subagents/` explicitly when required.

## Composition and platforms

The fork constructs concrete providers in `configuration/index.ts`. Do not add provider descriptors, string selectors, or a second runtime-provider composition file. UI code selects behavior through the control service, not by branching on provider names.

Several providers may share one platform object. Tilde agent, skill-registry, and MCP reconciliation share the Agent Provider's single `TildePlatform`. Shared authentication, request helpers, error inspection, or account lookup belongs under `packages/platform-integrations/src/tilde/`; domain mapping stays in the provider adapter. Owner chat is not a provider: the control service preserves Tilde's native REST/SSE shapes through its allowlisted bridge.

Initialization questions are collected once per shared platform. Provider-specific questions remain with the provider or lifecycle that owns the resulting resource.

The default `VercelInferenceProvider` shares the installation's `VercelPlatform`. Init asks for the AI Gateway key name, creates the key only when `AI_GATEWAY_API_KEY` is absent, and persists that canonical secret through SOPS. Agent code passes a `creator/model` string directly to AI SDK so its built-in default provider routes through AI Gateway and reads the canonical key. The provider never crosses into request-time model selection.

## Adding or changing a provider

1. Identify the real control, lifecycle, or provisioning consumer.
2. Add the narrow operation to the owning domain contract only if that consumer needs it.
3. Put reusable vendor plumbing in `platform-integrations`; keep domain mapping in the adapter.
4. Construct the provider explicitly in `configuration/index.ts`.
5. Inspect `configuration/templates/agent/`, but do not route authored-agent runtime behavior through the provider. Update direct agent/template integrations when needed.
6. Add focused contract and lifecycle tests.

Custom fork-owned providers may live under `configuration/providers/`, but they follow the same limits. If a function is useful only to one authored agent, put it in that agent instead.
