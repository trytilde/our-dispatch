# @tryopenbot/control-service

The portable Hono control application. It serves health, exposes an allowlisted same-origin Tilde ChatKit REST/SSE bridge under `/api/chat/*`, and serves the built web UI with SPA fallback both locally and in a Vercel Function.

## Public API

- `app` is the configured Web-standard Hono application exported for local and provider-generated entrypoints.
- `registerTildeChatProxy(app, options)` preserves Tilde ChatKit request, response, attachment, and streaming semantics while keeping server credentials out of the browser.
- `registerComputerPreview(app, provider, options)` exposes the narrow owner preview redirect without making Computer service browser-accessible.

The package default application also exposes `GET /healthz`. There is no owner-facing ConnectRPC surface or pairing-code setup route.
