---
name: vercel
description: Deploy, configure, inspect, or troubleshoot OpenBot on Vercel, including Vercel Functions, provider-owned Vercel assets, and project environment variables. Use for preview or production deployments, Vercel configuration changes, deployment failures, environment setup, or changes involving cli/src/commands/deploy.ts or the Vercel service providers.
---

# Operate OpenBot on Vercel

Use OpenBot's coordinated deployment workflow. It owns the coupled Vercel, Tilde, environment, and Sandbox setup that a generic `vercel deploy` cannot reproduce.

## Inspect before acting

1. Read `README.md` under **Deploy**, `package.json`, `cli/src/commands/deploy.ts`, the relevant `packages/*-service-provider/src/vercel/` implementation, and its `assets/` directory.
2. Check `git status --short --branch` and whether `.vercel/project.json` exists. Read linked-project metadata only when needed; do not edit `.vercel/` by hand.
3. Read the installed CLI and SDK versions from `package.json`. Consult the current official Vercel docs before changing an API or configuration shape; do not rely on remembered signatures.
4. Never print, grep into chat, or pass secrets on the command line. Treat `.env.local`, `.openbot-deploy/secrets.enc.env`, Vercel tokens, Tilde credentials, and setup codes as secret material.

## Deploy

Default to a preview unless the user explicitly requests production. A deployment is an external write: do not deploy merely to diagnose or review.

### Production

1. Validate the intended diff with `pnpm check` and `pnpm build`; run focused or end-to-end tests proportional to the change.
2. Preview the orchestrated operation with:

   ```bash
   pnpm deploy:prod -- --dry-run --json
   ```

3. When production deployment is explicitly authorized, run:

   ```bash
   pnpm deploy:prod -- --yes
   ```

4. Require the runtime health smoke to pass. Report the production origin and redacted resource identifiers only.

The deployment coordinator prepares the Vercel project and stable origin, allows other deployment owners to configure against that origin, releases the runtime once, and performs the health smoke. Preserve that phase ordering.

### Preview

Use the deployment coordinator and Vercel service provider with a preview target so the provider builds the prebuilt artifact and materializes its project configuration. Do not add a repository-root `vercel.json` or bypass the service provider with a raw source deployment. Use the linked project and explicit team scope already established for the checkout. Do not reconcile production Tilde resources or overwrite production environment variables for a preview. Inspect the resulting deployment and verify the changed user flow when credentials and authorization permit.

## Preserve OpenBot's Vercel contract

- Keep Vercel entrypoints and configuration as `*.hbs` files in their owning provider's `vercel/assets/` directory. Render them through `@tryopenbot/utilities`; the deploy lifecycle materializes `vercel.json` in the ignored artifact root.
- Keep `.vercel/output/config.json` aligned with the generated functions and static assets; it owns routing for prebuilt deployments.
- Keep `/rpc/*`, `/healthz`, and SPA behavior aligned with `apps/control-service` and `apps/web`.
- Keep provider secrets in the control-plane environment provider; never copy them into a Sandbox.
- Keep generated setup codes, deployment state, and decrypted temporary files ignored and mode-restricted.
- Treat Marketplace provisioning, environment changes, production promotion, rollback, and resource deletion as external mutations. Obtain the authority required by the user's request and verify the exact target first.

## Diagnose with evidence

Trace the complete boundary: browser or client request -> `server.ts` -> server route -> provider -> persisted state or external service -> response. Check build output, deployment status/logs, environment-variable names (never values), and the actual deployed route. Do not infer production health from a successful local build.

## Current references

- Vercel agent resources: https://vercel.com/docs/agent-resources
- Project configuration: https://vercel.com/docs/project-configuration
- Functions: https://vercel.com/docs/functions
- Environment variables: https://vercel.com/docs/environment-variables
- Vercel Sandbox: https://vercel.com/docs/vercel-sandbox
