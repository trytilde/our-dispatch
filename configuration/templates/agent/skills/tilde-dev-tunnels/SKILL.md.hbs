---
name: tilde-dev-tunnels
description: Wire a locally running agent endpoint to Tilde with Dev Tunnels — register the local endpoint, then guide the human through the tunnel CLI steps.
---

# Tilde Dev Tunnels

Your `tilde_*` tools are team-scoped: never pass `org_id` or `team_id` arguments. The control plane registers the local endpoint; starting the tunnel is a local CLI step only the human (or a local coding agent) can run.

## Register the local endpoint

`tilde_register_chatkit_agent` with `display_name`, `endpoint_url` set to the local route path (for example `api/hello-world`), and `local_running_endpoint: true`. Give the returned API key and webhook signing key to the human for secure server-side storage; never print them into source, logs, or chat.

## Local CLI steps for the human

```bash
pnpm add -D @trytilde/cli
pnpm exec tilde auth login
pnpm exec tilde tunnel -- pnpm dev
```

Replace `pnpm dev` with the app's normal dev command; `pnpm exec tilde auth set-team` fixes a wrong workspace. The CLI passes the chosen port as `PORT` and `TUNNEL_PORT`, and the process must stay running while Tilde delivers ChatKit messages, webhooks, and tool invocations.

Warn the user: the tunnel exposes every route served by the dev process to the public internet — disable or protect unrelated routes. Signed Harness SDK wrappers such as `chatKitEndpoint` reject requests without a valid Tilde signature, but that protects only the wrapped endpoint.
