# @tryopenbot/platform-integrations

Canonical installation-level integrations for platforms shared by multiple OpenBot domain providers.

## Public API

- `TildePlatform` implements `Platform` for the Tilde credential, organization, team, and API origin shared by Tilde agent, skills, and tools providers. Initialization persists `https://api.trytilde.ai` as the default origin so an unrelated host override cannot retarget a configured repository. `tildePlatform` is the default shared instance.
- `VercelPlatform` implements `Platform` for the Vercel credential and optional team scope shared by Vercel control-service, agent-service, and computer providers. `vercelPlatform` is the default shared instance.
- `tilde/errors` and `tilde/fetch` normalize Tilde client failures and compose provider cancellation into platform requests.
- `vercel/deployment` owns project lookup/creation, account scoping, runtime environment installation, and deployment URL parsing. `vercel/registry` owns Container Registry account resolution.

Domain providers retain their role-specific initialization questions, entity mapping, and domain error translation. They reference platform instances through `platforms`; renderers collect each platform once by stable ID.
