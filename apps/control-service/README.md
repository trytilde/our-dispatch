# @tryopenbot/control-service

The portable Hono control application. It serves health, exposes raw allowlisted same-origin Tilde bridges under `/api/chat/*` and `/api/tilde/*`, exchanges an HttpOnly browser session for a single-use registered-Origin ticket or an authenticated native bearer for an Origin-free native ticket, and serves the built web UI with SPA fallback both locally and in a Vercel Function. Client Runtime uses that ticket to connect directly to Tilde's team WebSocket and projects Tilde-owned settings resources without domain facades in this service.

## Public API

- `app` is the configured Web-standard Hono application exported for local and provider-generated entrypoints.
- `createApp(options)` constructs the portable control application with its configured authentication, Computer preview, ChatKit proxy, background agent-creation executor, and web-root behavior.
- `registerOwnerAuth(app, provider, options)` installs browser PKCE login, callback, session, and logout routes. Development options preserve a validated loopback browser origin through the Vite proxy.
- `requireOwner(provider, options)` returns the owner-authentication middleware used to protect browser-facing control routes.
- `registerTildeChatProxy(app, options)` preserves Tilde ChatKit request, response, and attachment semantics for an exact Client Runtime operation allowlist and exposes only the short-lived ChatKit realtime ticket needed for a direct browser WebSocket.
- `registerTildeProxy(app, options)` preserves request and response bodies for a strict allowlist of Tilde-owned settings operations while keeping the installation API key out of clients.
- `registerComputerPreview(app, provider, options)` exposes the narrow owner preview redirect without making Computer service browser-accessible.
- `registerConnectorAuthorizedRoute(app)` serves only the public OAuth completion page that bounces desktop and mobile flows to the `openbot://` deep link. Connector resources and setup use native Tilde APIs through `registerTildeProxy`.

The package default application also exposes `GET /healthz`. There is no owner-facing ConnectRPC surface or pairing-code setup route.

Owner-authenticated `POST /api/agents` starts `openbot new-agent` inside the trusted development
Computer as a background job. `GET /api/agents/setup/:jobId` reports that job without exposing the
Computer API key or shell output to the browser. When Tilde is configured, the status route also
establishes the new ChatKit Agent Resource Bundle with the deployment API key delegated by the
signed-in human, so later machine-only deployments preserve that individual lifecycle owner.
