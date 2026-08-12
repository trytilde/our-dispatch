# Agents

Each `configuration/agents/<id>.ts` is a Web-standard route module that exports `POST(request)`. Build the handler with Tilde `chatKitEndpoint` and return a Vercel AI SDK response, matching the official TryTilde examples. The filename is the agent ID; optional `displayName`, `description`, and `registration` exports provide reconciliation metadata without wrapping execution in an OpenBot SDK. OpenBot mounts every discovered module at the configured `/api/agents/<id>` prefix.

```bash
pnpm openbot agent create --id analyst --name "Analyst"
```

Review and commit the generated file. For creation from a running installation, use `--publish` or `POST /api/agent-publications`: the source-control provider creates a branch and pull request. Merge triggers the normal Vercel deployment; deployment reconciliation creates or updates the Tilde agent and stores its endpoint credentials in `EnvProvider`.

Reconciliation is idempotent and lease-protected. Deleting a file marks its registration orphaned. Only `pnpm openbot sync --prune --yes` disables removed remote agents.
