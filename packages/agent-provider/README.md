# @tryopenbot/agent-provider

Provisioning and reconciliation boundary for the complete external footprint of
an authored agent. It is used by development and deployment lifecycles, not by
authored agent code and not as a chat API.

`AgentProvider` exposes only an idempotent `Deployable` lifecycle. The Tilde
implementation discovers authored agents; creates or repairs ChatKit agents;
synchronizes authored skills and registry membership; adds the OpenBot computer-use overlay and a managed-or-bundled canonical Cua skill without removing user-owned skills; and reconciles the
dynamic MCP server, Tilde control-plane tools, and deployment-platform MCP
connections. Repeated deployments and retries after partial failure converge
without duplicate resources or unnecessary updates. It exposes no vendor CRUD
to the CLI. Owner conversation traffic uses Tilde's REST/SSE contract through
the control service's allowlisted same-origin bridge.

## Public API

- `AgentProvider`: deployment-only contract for aggregate authored-agent resource reconciliation.
- `AgentProviderError` and `AgentProviderErrorCode`: normalized provider failure surface.
- `TildeAgentProvider` and `TildeAgentProviderConfig`: typed Tilde implementation and configuration.
- `tildeAgentProviderInitialization`: provider-specific initialization metadata collected with the shared Tilde platform.

Reconciliation guarantees per agent: the Tilde control-plane toolkit is enabled and every one of its functions is mapped onto the agent's runtime MCP server, and authored skills sync into the agent's Tilde skill registry with team-unique names namespaced as `<agent-id>-<skill-name>`.
