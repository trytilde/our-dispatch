# Agents

The primary agent lives at `configuration/agent/` and uses the stable ID `factory`. `openbot new-agent` creates full additional agents at `configuration/agent/subagents/<id>/`, where the directory name is the ID. Every agent has the same supported files, lifecycle, endpoint, instrumentation, skills, tools, and workspace seed. A subagent cannot contain another `subagents/` directory.

`agent.ts` must default-export the request handler returned by Tilde `chatKitEndpoint(...)`; OpenBot mounts it at `/api/agents/<id>`. `instructions.ts` default-exports the system instructions and is explicitly imported by `agent.ts`.

The supported authored tree is `agent.ts`, `instructions.ts`, optional `instrumentation.ts`, `lib/`, `tools/`, `skills/`, and `sandbox/workspace/**`. Configuration-wide `configuration/instrumentation.ts` runs before every agent-local instrumentation hook and before importing the endpoint. Tools must default-export a Vercel AI SDK tool and are explicitly imported by `agent.ts`; skills conform to the agent skill specification but are not loaded automatically yet. Channels, connections, hooks, schedules, and nested subagents are unsupported.

The directory remains named `sandbox/` only to follow Eve's project layout where practical. OpenBot calls the runtime an OpenBot Computer everywhere else. Every agent contains explicit `await_shell`, `bash`, file, search, and screenshot tool files. Each is a thin default export from `@tryopenbot/computer-tools` with the path-derived agent ID fixed outside the model-visible input schema; agents never call a sandbox provider SDK or untyped endpoint directly. Every agent also carries `tools/configure_connector.ts`, a thin default export from `@tryopenbot/connector-tools` that emits the in-chat connector account picker (ADR-0027), plus the eight `tilde-*` platform skills under `skills/`.

Authored agents must not import OpenBot provider packages or `configuration/index.ts`. Integrate model, MCP, skill, Composio, and other vendor SDKs directly in `agent.ts`, `tools/`, or `lib/`. When an integration should be standard for new agents, update `configuration/templates/agent/`; edit existing agents explicitly.

Personal tool federation is opt-in. Set
`OPENBOT_PERSONAL_TOOL_FEDERATION_MODE=all` to let each verified ChatKit
speaker bring every active personal account to a shared agent, or `selected`
to enforce the MCP server's provider/tool allowlist. The default is `none`.
Generated agents use `context.mcp.connect(...)`; Tilde resolves accounts
and brokers credentials per request, while user IDs and opaque capabilities
remain outside model arguments and portable agent configuration.

All agents share one OpenBot Computer, filesystem, and process identity. If an agent's authored `sandbox/workspace/**` contains files, deployment seeds them once into `/workspace/<id>`. The computer service uses the fixed agent ID to choose that default directory, but it is not a security boundary: agents can use absolute paths, see sibling directories, and administer the shared machine. Changes to authored seed files do not update an already deployed agent directory.

Run `pnpm openbot new-agent` and enter the display name to scaffold a complete subagent safely; then edit its ordinary source files in the fork. The command loads every `configuration/templates/agent/**/*.hbs` file, preserves its relative path, removes the `.hbs` suffix, and renders strict agent values. Init seeds that fork-owned template when it is missing and uses it for the primary Factory agent; factory-only skills render from `configuration/templates/factory/**/*.hbs` into the primary agent alone. Later init runs preserve template changes, and template edits affect only future agents. This command only changes the authored filesystem before invoking normal idempotent development reconciliation.

`openbot dev` performs the remote lifecycle reconciliation before starting services. For each authored directory it creates or updates the Tilde Vercel AI SDK endpoint in local-running mode, creates an agent-specific dynamic MCP server and skill registry, writes their non-secret IDs to `configuration/.env` as `AGENT_<ID>_*`, and stores newly issued endpoint credentials in encrypted configuration. Generated agents read their own agent, MCP-server, and registry variables. Run development through the Tilde tunnel when ChatKit must call the local endpoint.

The `computer-use-only` specialist keeps an agent-specific Tilde MCP server but disables dynamic discovery, remote function mappings, the control-plane toolkit, external reconciliation, and its skill registry. Its endpoint adds only local `createCuaTools` functions to that MCP client and passes only those exact names to the model.

Reconciliation is idempotent: existing resources are reused and updated rather than duplicated. Run `openbot delete-agent <id> --yes` to remove a subagent. The command first asks the agent provider to delete and confirm the Tilde Agent Resource Bundle, ChatKit workspace channel, and credential-bearing external integrations; it then removes stored endpoint IDs, secrets, and authored source. Repeating the command after partial or complete cleanup is safe. The primary Factory agent cannot be deleted.
