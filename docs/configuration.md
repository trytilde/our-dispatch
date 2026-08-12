# Repository configuration

`openbot.config.ts` is the single configuration entrypoint. `defineConfig()` validates provider IDs, repository-relative paths, the public agent route prefix, and pull-request publishing policy. It must not contain credentials.

The build generator statically discovers agent modules, provider plugins, skills, sandbox assets, and the bootstrap script. This makes the same fork work from source and from a Vercel function bundle. Symlinks, escaping paths, duplicate IDs, oversized files, and malformed skill metadata fail generation or startup.

Built-ins use `openai`, `tilde-agents`, `tilde-chatkit`, `tilde-skills`, automatic local/Vercel sandbox selection, the environment provider, and GitHub publishing. Select a custom provider ID in configuration only after registering it under `configuration/providers/`.

Run `pnpm openbot check` after every configuration change. `pnpm openbot doctor` also checks the selected providers without exposing secret values.
