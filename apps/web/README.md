# @tryopenbot/web

The React 19 and Vite owner interface for OpenBot. It uses TanStack Router and is served by the control service locally or by the runtime provider's static CDN artifact on Vercel.

## Public API

This package is a browser application and declares no importable package exports. Its generated route tree is not a public API and must not be hand-edited. Owner chat uses Tilde's native REST resource shapes through the same-origin `/api/chat/*` bridge. ChatKit workspace events connect directly to Tilde's WebSocket using a short-lived ticket obtained through the authenticated control route; Computer service remains internal and must not be called by the browser.

The development server proxies `/healthz`, `/api/chat`, `/api/tilde`, `/api/computer`, and `/auth` to the local control service with forwarded-origin headers enabled, so the control service can keep browser-facing OAuth callbacks on the Vite origin and keep the installation API key out of browser code.
