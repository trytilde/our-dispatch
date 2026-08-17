---
name: run-openbot
description: Initialize, validate, run, build, deploy, or diagnose an OpenBot fork locally or on Vercel. Use for first-run configuration, development startup, provider build checks, local service deployment, Vercel Build Output deployment, and service health proof.
---

# Run OpenBot

1. Require Node 24 and pnpm 10, then run `pnpm install`.
2. If `configuration/` contains only `.gitkeep`, run the interactive `pnpm openbot init`. Fork values belong only in `configuration/.env` and `configuration/secrets.enc.yaml`; never create or load a root `.env` or root SOPS document.
3. Confirm `configuration/index.ts` explicitly constructs every provider role. Agent entrypoints read their runtime environment directly and must not import a second provider composition module. Init defaults agent, chat, skill, and tool providers to Tilde without asking the owner to select domain providers.
4. Run `OPENBOT_NO_DESKTOP=1 pnpm openbot dev` for a headless proof, or `pnpm openbot dev` when Electron is available. The CLI owns the control-service process; desktop only connects to it and never starts it.
5. Build without mutation using `pnpm openbot deploy --skip-deploy --service all`. Use `--service agents` or `--service control` for one artifact.
6. Use `pnpm openbot deploy --yes` only when the user authorizes real deployment. Local providers install separate systemd user services on Linux or launchd agents on macOS. Vercel providers deploy independent prebuilt agent and control projects; the idempotent agent provider reconciles endpoints before the agent service consumes newly issued credentials, and the control runtime deploys last.
7. Probe control `/healthz`, agent-service `/healthz`, an unsigned agent endpoint expecting authentication failure, and the web SPA. Never print decrypted secrets or deployment environment files.

The desktop package requires `OPENBOT_CONTROL_ORIGIN` outside CLI development, defaulting to the CLI development origin `http://127.0.0.1:4100`. It is always a client.
