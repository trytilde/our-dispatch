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
| `inference-provider` | Initialize inference accounts, check credentials before builds, and seed SDK-specific files into the default agent template. It exposes no request-time model factory. |
| `computer-service-provider` | Build and deploy the Computer service image, provision Computers, install agent workspaces, and prepare the trusted development Computer. |
| `control-service-provider` | Check, build, configure, and deploy the control-service artifact. |
| `agent-service-provider` | Discover authored agents and check, build, configure, and deploy their service artifacts. |
| `git-provider` | Reconcile hosted git access through a Tilde-brokered GitHub App, a managed local bare repository, or Code Storage with a transient organization key and persisted repository-only JWT. |
| `runtime-provider` | Shared initialization, build, and phased deployment contracts and coordination. |
| `platform-integrations` | Shared Tilde, Vercel, and other vendor plumbing used by multiple provider packages. It is not a domain provider. |

Provider contracts live in `src/core.ts` or `src/core/` in their owning package. Concrete adapters live beside the contract. A contract should contain only operations used by the boundaries above. Remove speculative methods instead of preserving a generic provider API.

Every lifecycle method is idempotent. `check`, `build`, `plan`, `configure`, and `deploy` may be called repeatedly. Implementations must reconcile stable identities and update mutable fields without creating duplicates. CLI code only schedules hooks. Each provider owns its vendor-specific get/create/update/delete sequence and persists its own environment or encrypted secrets through `runtime-provider` helpers. `DeploymentResult` is reserved for named handoff outputs.

Authored-agent reconciliation discovers agents once and supplies one Agent Provider lifecycle with the agent ID and absolute source path. The Tilde implementation reconciles the endpoint first, then authored skills and exact registry membership, then MCP and tool resources. A partially completed run is safe to repeat.

The built-in Tilde adapters use the typed API client directly. They identify resources by persisted IDs and stable OpenBot names, create missing resources, compare mutable fields, and update only drift. Authored `SKILL.md` files are keyed by repository-relative source path; removed files are removed from the agent-owned remote set and registry membership is exact. OpenBot does not import or export a Tilde state file during normal lifecycles. An operator may use the Tilde CLI manually to export a team's state and import it into another team for one-time setup or environment migration; OpenBot then resumes idempotent API reconciliation against that imported state.

Every Tilde agent receives a dynamic MCP server and a team-scoped Tilde control-plane toolkit. The primary factory agent additionally receives the brokered GitHub toolkit reconciled by the git provider; no raw GitHub token ever enters the repository or a Computer — sandboxes authenticate git through the Tilde reverse proxy. When the selected service deployment platform is Vercel, the Agent Provider's internal tools reconciler also manages Vercel's proxied MCP connection using the configured Vercel token. Development agent endpoints use Tilde local-runtime tunnel mode; production endpoints use their public service origin. Authored local tools execute inside that agent service, so they share its tunnel instead of registering a second custom HTTP endpoint.

## Authored agents do not use providers

Code under `configuration/agent/`, including `subagents/<id>/`, must not import provider packages or `configuration/index.ts`. Providers do not contribute live model objects, prompts, AI SDK tools, arbitrary vendor methods, or generic plugin functions to a running agent. An inference provider may contribute source files while init seeds `configuration/templates/agent/`; those files immediately become fork-owned and import the vendor SDK directly.

Integrate the desired SDK directly in the authored agent. For example, an agent may use OpenAI, Anthropic, Tilde, Composio, or a custom API without first extending a provider interface. This keeps agent development unconstrained by OpenBot's control-plane abstractions.

Shared utilities that are not providers may still be imported. Instrumentation lives in `@tryopenbot/configuration/instrumentation`. The standard typed Computer tools live in `@tryopenbot/computer-tools`; they call the Computer service rather than a Computer provider.

When all future agents need the same integration, update `configuration/templates/agent/`. Template changes affect newly scaffolded agents only, so migrate the primary and existing directories under `configuration/agent/subagents/` explicitly when required.

## Composition and platforms

The fork constructs concrete providers in `configuration/index.ts`. Do not add provider descriptors, string selectors, or a second runtime-provider composition file. UI code selects behavior through the control service, not by branching on provider names.

Several providers may share one platform object. Tilde agent, skill-registry, and MCP reconciliation share the Agent Provider's single `TildePlatform`. Shared authentication, request helpers, error inspection, or account lookup belongs under `packages/platform-integrations/src/tilde/`; domain mapping stays in the provider adapter. Owner chat is not a provider: the control service preserves Tilde's native REST/SSE shapes through its allowlisted bridge.

Initialization questions are collected once per shared platform. Provider-specific questions remain with the provider or lifecycle that owns the resulting resource.

The default `VercelInferenceProvider` shares the installation's `VercelPlatform`. Init asks for the AI Gateway key name, creates the key only when `AI_GATEWAY_API_KEY` is absent, and persists that canonical secret through SOPS. Its template contribution passes a `creator/model` string directly to AI SDK so the built-in default provider routes through AI Gateway.

`CodexInferenceProvider` is available with local and Vercel OpenBot runtimes. It always authenticates through `codex login --device-auth` in an isolated `CODEX_HOME` configured for file credentials. It persists the complete opaque auth document as `CODEX_AUTH_JSON` through SOPS, then uses Codex app-server's account read with refresh during init, development, and non-dry-run deployment checks. Non-interactive deployment never starts a nested login; invalid credentials stop with instructions to run interactive init. Its default-agent contribution uses `ai-sdk-provider-codex-cli` app-server mode and `gpt-5.6-sol`. OpenBot's AI SDK tool definitions are adapted to the package's local MCP tool representation because Codex executes its own tool loop. For Vercel, the inference build runs after the agent-service build, copies the Linux x64 Codex executable into every prebuilt Node function, and persists `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`; the native binary makes Vercel Large Functions a deployment requirement. The provider contract still never crosses into request-time model selection.

## Adding or changing a provider

1. Identify the real control, lifecycle, or provisioning consumer.
2. Add the narrow operation to the owning domain contract only if that consumer needs it.
3. Put reusable vendor plumbing in `platform-integrations`; keep domain mapping in the adapter.
4. Construct the provider explicitly in `configuration/index.ts`.
5. For inference providers, contribute the minimal vendor SDK source needed by the default agent template. For other integrations, inspect `configuration/templates/agent/` and update direct agent/template code when needed. Never route authored-agent runtime calls through a provider object.
6. Add focused contract and lifecycle tests.

Custom fork-owned providers may live under `configuration/providers/`, but they follow the same limits. If a function is useful only to one authored agent, put it in that agent instead.

## Code Storage setup and GitHub sync

`CodeStorageGitProvider` uses the organization PKCS8 API key only during interactive initialization.
It creates or finds the configured repository, optionally links it to GitHub at creation, and mints
a repository-only credential with `git:read`, `git:write`, and force-push rejection. Initialization
persists that JWT through SOPS and discards the organization key. Deployment rotates only the
untracked Git remote URL and pushes the named current branch.

Code Storage exposes two different identifiers. Store the tenant hostname slug, such as `tilde`,
as `CODE_STORAGE_ORGANIZATION`; store the opaque `org_...` identifier copied with the API key as
`CODE_STORAGE_ORGANIZATION_ID`. The former routes API/Git traffic and the latter is the JWT `iss`.

For continuous private GitHub sync, configure the Code Storage GitHub App integration first:

1. Create a GitHub App with Metadata read, Contents read/write, and Workflows read/write when agent
   changes may touch `.github/workflows/`.
2. Subscribe it to Push and Create events and set its webhook URL to
   `https://<code-storage-org>.code.storage/webhooks/github`.
3. Install the App on the selected repository and save its App ID, private key, and webhook secret
   in the Code Storage Integrations dashboard.
4. Run `openbot init`, select exe.dev and GitHub App sync, then enter the organization key only in
   the setup-only prompt. Rotate or revoke that organization key after setup.

Public sync is a one-time import and does not forward later pushes. GitHub App sync is continuous
and treats GitHub as the upstream source of truth.
