# @tryopenbot/control-service

The portable Hono control application. It serves health, exposes an allowlisted same-origin Tilde ChatKit REST bridge under `/api/chat/*`, exchanges an HttpOnly browser session for a single-use registered-Origin ticket or an authenticated native bearer for an Origin-free native ticket, and serves the built web UI with SPA fallback both locally and in a Vercel Function. Client Runtime uses that ticket to connect directly to Tilde's team WebSocket.

## Public API

- `app` is the configured Web-standard Hono application exported for local and provider-generated entrypoints.
- `createApp(options)` constructs the portable control application with its configured authentication, Computer preview, ChatKit proxy, background agent-creation executor, and web-root behavior.
- `registerOwnerAuth(app, provider, options)` installs browser PKCE login, callback, session, and logout routes. Development options preserve a validated loopback browser origin through the Vite proxy.
- `requireOwner(provider, options)` returns the owner-authentication middleware used to protect browser-facing control routes.
- `registerTildeChatProxy(app, options)` preserves Tilde ChatKit request, response, and attachment semantics and exchanges the owner bearer through Tilde Identity's OpenBot realtime-ticket endpoint for the short-lived credential needed by the direct Mission Control WebSocket.
- `registerComputerPreview(app, provider, options)` exposes the narrow owner preview redirect without making Computer service browser-accessible.
- `registerConnectorRoutes(app, options)` serves owner-authenticated connector (Tilde tool-provider) configuration under `/api/connectors/*` — provider catalog, enabled accounts, and new-account creation that encrypts credentials server-side and starts brokered OAuth — plus the public `/connectors/authorized` OAuth return page that bounces desktop and mobile flows to the `openbot://` deep link.

The package default application also exposes `GET /healthz`. There is no owner-facing ConnectRPC surface or pairing-code setup route.

Owner-authenticated `POST /api/agents` starts `openbot new-agent` inside the trusted development
Computer as a background job. `GET /api/agents/setup/:jobId` reports that job without exposing the
Computer API key or shell output to the browser. When Tilde is configured, the status route also
establishes the new ChatKit Agent Resource Bundle with the deployment API key delegated by the
signed-in human, so later machine-only deployments preserve that individual lifecycle owner.
