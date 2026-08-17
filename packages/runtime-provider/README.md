# @tryopenbot/runtime-provider

Shared provider build, initialization, persistence, and phased deployment contracts. It coordinates artifacts first, deploys ordinary providers next, deploys the trusted development sandbox, and deploys the control runtime last.

## Public API

### Functions

- `buildProviders(participants, options)` checks and builds every participant that exposes `buildable`, in registration order, and returns accumulated `DeploymentOutputs`.
- `deployProviders(participants, options)` plans all deployable participants, runs optional configuration, then deploys provider, sandbox, and runtime roles in that order.
- `persistEnvironment`, `persistSecret`, `unsetEnvironment`, and `unsetSecret` let the provider that owns a resource update repository configuration and the shared in-memory environment.

### Classes

- `DeploymentOutputs` stores named handoff outputs in memory. `merge`, `get`, `require`, `outputs`, and `result` are its public operations; conflicting or invalid names fail.

### Critical interfaces

- `Buildable` defines `check()` and `build()` for software artifacts, plus optional development `watchPaths()`.
- `Deployable` defines read-only `plan()`, optional `configure()`, and `deploy()`.
- `DeployableProvider` lets a domain provider opt into `buildable` and/or `deployable`; absent lifecycles are skipped.
- `ProviderInitialization` and `ProviderInitializationQuestion` describe GUI-agnostic onboarding questions, optional first-run defaults, and value destinations. Persisted answers take precedence over defaults when init is rerun.
- `Platform` represents an external platform shared by domain providers. `collectProviderInitializations(providers)` combines provider-owned questions with shared `platforms`, rejecting conflicting definitions and returning each stable initialization ID once.
- `DeploymentParticipant` assigns a stable ID and optional `provider`, `sandbox`, or `runtime` role.
- `DeploymentContext`, `DeploymentResult`, and `DeploymentRunOptions` carry the required `devMode`, repository paths, the mutable process environment and repository-configured subset, named outputs, persistence, reporting, and dry-run state. The configured subset is one combined `.env` and secrets map; it only prevents inherited shell variables from being deployed accidentally.

Every lifecycle hook receives the same `DeploymentContext`. Development is a local mode: remote
adapters may no-op after checks, while providers such as Tilde can still reconcile external resources.
Lifecycle coordination preserves the original error as its cause and appends the concrete adapter name
and provider domain. Wrapper participants provide explicit implementation identity so attribution does
not degrade to the wrapper object.

Secret values must never be written to deployment events. Providers receive values from `configuration/.env` and decrypted `configuration/secrets.enc.yaml` in one map. Final service installers remain responsible for excluding control-plane credentials.
