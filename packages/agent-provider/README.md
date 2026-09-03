# @tryopenbot/agent-provider

Provisioning and reconciliation boundary for the complete external footprint of
an authored agent. It is used by development and deployment lifecycles, not by
authored agent code and not as a chat API.

`AgentProvider` exposes an idempotent `Deployable` lifecycle plus aggregate removal. The Tilde
implementation discovers authored agents; creates or repairs ChatKit agents;
 synchronizes authored skills and registry membership; and reconciles the dynamic
MCP server, optional agent-owned memory bank, Tilde control-plane tools,
deployment-platform MCP connections, and stored agent reach. Fork composition may
narrow those resources per authored agent—for example, a Computer specialist can
disable every remote tool and skill surface while retaining a fixed non-dynamic MCP
identity for process-local CUA tools, its endpoint, team authorization, and explicit
delegation permissions. Setting `enableNonSystemMappedMcpTools` to `false` also
reconciles away stale configured functions without affecting process-local tools or
Tilde's system human-handoff helper. The authored agent's exact-name selector keeps
that system helper out of its model tool set. Repeated deployments and retries after
partial failure converge
without duplicate resources or unnecessary updates. It exposes no vendor CRUD
to the CLI. Owner conversation traffic uses Tilde's REST/SSE contract through
the control service's allowlisted same-origin bridge.

## Public API

- `AgentProvider`: deployment and removal contract for aggregate authored-agent resource reconciliation.
- `AgentProviderError` and `AgentProviderErrorCode`: normalized provider failure surface.
- `TildeAgentProvider`, `TildeAgentProviderConfig`, `TildeAgentProviderOptions`, and
  `TildeAgentResourcePolicy`: typed Tilde implementation, connection configuration, and optional
  per-agent resource/permission policy.
- `tildeAgentProviderInitialization`: provider-specific initialization metadata collected with the shared Tilde platform.

Reconciliation now submits one typed Tilde Agent Resource Bundle and polls its
durable status. Tilde owns the agent, dynamic MCP server, control-plane toolkit,
exact managed/custom skill registry, memory bank, credential rotation, and
cleanup. A reported `memory bindings are still synchronizing` checkpoint remains
pollable within the existing bounded provisioning deadline; every other reported
error fails immediately. Ordinary OpenBot bots default automatic memory to `none`.
`OPENBOT_AUTOMATIC_MEMORY_MODE` and the per-agent
`AGENT_<ID>_AUTOMATIC_MEMORY_MODE` override select an explicit mode;
`personal_plus_agent` alone provisions one agent-owned bank. The synthesis-only
Memory Catcher deploys with mode `none` and no bank, preventing recursive
synthesis. OpenBot claims endpoint secrets once and
uploads a deterministic canonical avatar to the stable machine-user profile,
then retains its ChatKit realtime channel plus credential-bearing
deployment-platform integrations.

`OPENBOT_PERSONAL_TOOL_FEDERATION_MODE` configures each reconciled MCP server as
`none` (default), `selected`, or `all`. Tilde still resolves the verified speaker
and brokers personal credentials per request; OpenBot persists no user identity,
account selection, or delegated capability in repository configuration.
