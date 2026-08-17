# @tryopenbot/web

The React 19 and Vite owner interface for OpenBot. It uses TanStack Router and is served by the control service locally or by the runtime provider's static CDN artifact on Vercel.

## Public API

This package is a browser application and declares no importable package exports. Its generated route tree is not a public API and must not be hand-edited. Owner chat uses Tilde's native REST resource shapes and SSE events through the same-origin `/api/chat/*` bridge; Computer service remains internal and must not be called by the browser.
