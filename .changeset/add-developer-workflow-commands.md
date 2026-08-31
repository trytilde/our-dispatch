---
"openbot": minor
---

Add the developer workflow to the `openbot` CLI for humans and sandboxed agents working on the codebase. Repository gates `e2e` and `desktop package` join `check`, `build`, and `test`; a `mobile` command group carries Expo runs with the Android and Node toolchain resolved, an idempotent headless emulator with loopback VNC, SDK setup, AVD creation, screenshots, logs, and doctor; `connect` and `remote` reach fork-configured mac and Linux dev hosts over ssh. Root scripts adopt a verb:target taxonomy (`dev:mobile:*`, `connect`, `dev:remote`, `doctor`).
