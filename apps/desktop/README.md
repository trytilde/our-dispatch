# @tryopenbot/desktop

The Electron desktop shell for the OpenBot web UI and local control service. Privileged Node.js behavior remains in Electron main/preload code behind a narrow bridge; the renderer stays browser-compatible.

## Public API

This package is an Electron application and declares no importable package exports. It loads the same-origin web surface, proxies control routes to `CONTROL_ORIGIN` or the CLI development default at `http://127.0.0.1:4100`, and exposes only the preload bridge required by that UI. It never starts control service; `openbot dev` or a separate deployment owns that process.
