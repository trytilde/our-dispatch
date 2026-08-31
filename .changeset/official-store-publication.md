---
"openbot": minor
---

Add store publication for the official OpenBot app through EAS. `openbot mobile release build|submit|status|credentials` drives `eas-cli`, requires an explicit `--yes` before spending build minutes or changing a public listing, and refuses to use the official EAS project from any remote other than `trytilde/openbot`. `apps/mobile/app.json` becomes `app.config.ts` so a fork can point at its own EAS project, bundle identifier, and Expo owner through the environment rather than editing a tracked file. Recorded in ADR-0027.
