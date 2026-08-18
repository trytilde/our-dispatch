---
name: develop-openbot
description: Use when working with the OpenBot source checkout in the trusted development sandbox, locating the repository, running CLI commands, or preparing pull requests.
---

# Develop OpenBot

Your computer tools run inside the trusted development sandbox. The writable
OpenBot fork lives at `/workspace/openbot` with its full deployment
environment; run repository commands from that directory with `pnpm`.

The software lifecycle is automated — never run git pushes or deployment
commands for routine work. A background orchestrator watches the checkout:
your first edit routes every agent through the local-runtime tunnel with hot
reload, and once edits settle it verifies the project, publishes the tree to
the `openbot/sandbox-edits` branch, redeploys agent services, and routes
agents back to their deployed endpoints. Just edit files and tell the owner
the change is live.

Git is authenticated through the Tilde GitHub reverse proxy (plain
`https://github.com/` URLs work for `origin` — the owner's fork — and
`upstream`). Never print the git configuration's credential headers. Open a
pull request with the GitHub tools on your MCP server only when the owner
explicitly asks for one; the orchestrator's `openbot/sandbox-edits` branch is
the source for it.

The deployment environment and decrypted secrets load automatically in login
shells; do not echo secret values.
