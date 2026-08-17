# ADR-0005: UX-first application reset

> Deployment artifact ownership was refined by ADR-0008 and ADR-0010.

## In brief

- Design the user experience first, then add the control API it requires.
- Keep the deployed application healthy while functionality is rebuilt.
- Keep protocol-native HTTP surfaces in Hono and avoid speculative owner RPC contracts.
- Remove the setup-code gate and legacy universal provider packages.
- Vercel CDN serves static files. Hono serves the same build everywhere else.

## Context

The application had accumulated server, RPC, provider, deployment, and setup behavior from several stacked implementation layers. That made provider abstractions drive the product surface before the user experience and owner-facing API were settled.

## Decision

Reset the application layer to a static UX shell and a bare Hono server. The server exposes `/healthz` and protocol-native Hono routes only when the UX requires them. The owner workspace consumes Tilde ChatKit through an allowlisted same-origin `/api/chat/*` REST/SSE bridge rather than introducing a second generated owner contract. The internal Computer service retains its independent generated ConnectRPC contract.

Build the web app once into `apps/web/dist`. The Vercel control provider copies that output into its prebuilt `.vercel/output/static` artifact so production static assets use the CDN. Keep static-file and SPA fallback handling in Hono as the portable default for local and non-Vercel Node.js hosts. Vercel routing configuration must not duplicate the application route table.

Delete the legacy `providers` and `provider-sdk` packages. Preserve the domain packages without wiring them into `apps/control-service`. Remove setup-code generation, unlock endpoints, browser setup screens, and production setup-secret provisioning.

Delete the unused legacy `contracts` package once the domain service protos are
the only consumers, and delete the unused control database package while the
reset application owns no persisted control state. Persistence must be
introduced from a concrete UX/API requirement rather than retained speculatively.

```mermaid
flowchart LR
  U["Web UI"] --> V["Vercel CDN"]
  U --> S["Hono static fallback"]
  U --> H["Hono control service"]
  H --> T["Tilde REST and SSE"]
  H --> P["domain lifecycles, only when required"]
```

## Consequences

- Vercel and local Hono runs serve a healthy but intentionally disconnected product shell.
- Vercel accelerates exact static files; Hono remains the portable SPA fallback and API router.
- New functionality starts with a visible UX and an explicit control contract.
- Existing lower-level packages can be evaluated independently in later changes.
- Removed application behavior can be recovered from Git history if needed.

## Updates

- 2026-08-13T12:09:51+02:00: Removed the unused legacy contracts and control database packages; active protobuf generation now covers only control and computer service protos.
- 2026-08-16T15:08:39+02:00: Removed the owner-facing control proto and Connect federation after the workspace adopted Tilde's native REST/SSE contract. Protobuf generation now covers only the internal Computer service.
