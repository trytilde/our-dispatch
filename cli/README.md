# openbot

The React Ink CLI for OpenBot. It operates an installation — initialization, development supervision, encrypted secret maintenance, service execution, provider-coordinated deployment — and it carries the developer workflow for the codebase itself: repository gates, the Expo mobile toolchain, and remote development hosts. One command surface serves operators, fork developers, and sandboxed agents (ADR-0018). Commands are parsed with `arg`; command entrypoints live under `src/commands/`.

Provider lifecycle failures identify both the concrete implementation and provider domain. CLI failures always print the complete redacted stack and cause chain below the concise error message; the same stack is included in JSON error output and the private run log.

## Install

```bash
npm install --global openbot
openbot --help
```

The CLI operates on the OpenBot repository in the current working directory. For a new installation, run `openbot init` from a completely empty destination directory; it verifies canonical OpenBot, creates an owned GitHub repository, clones the verified revision, and writes configuration. Running `openbot init` again from that initialized repository revisits the active platform and provider questions with stored values pre-populated. It does not recreate the repository or replace the existing SOPS ownership configuration. The CLI can also run without a global install using `npx openbot`.

## Commands

- For a new installation, `openbot init` rejects any non-empty destination before prompts or network mutation, verifies Git and authenticated GitHub CLI/SSH access, then accepts either a bare repository name for the authenticated account or `owner/name` for an authorized organization. It creates either a public fork or independent private mirror. After cloning it creates `configuration/.env`, `configuration/index.ts`, SOPS recipients and encrypted secrets, asks whether inference should use Vercel AI Gateway or a ChatGPT subscription, seeds the selected provider's source into `configuration/templates/agent/`, then scaffolds the Factory agent from that template. Gateway setup stores `AI_GATEWAY_API_KEY`; Codex setup always uses device-code login and stores its opaque auth cache as encrypted `CODEX_AUTH_JSON`. For Vercel agent services, deployment also packages the Linux Codex executable and enables Vercel Large Functions.
- In an already initialized OpenBot repository, `openbot init` decrypts the current values, uses them as prompt defaults, updates only active platform/provider destinations, preserves unrelated environment and secret entries, re-encrypts with the existing SOPS recipients, seeds the agent template only when missing, and runs `vp install` again. User-specific owner lookup metadata lives at `~/.openbot/config.json` under `sops`; interactive commands ask to recover missing values, while non-interactive commands stop and explain that interactive init is required.
- `openbot init --non-interactive --json` runs the same path from a JSON object on standard input. This is the supported automation and AI-agent interface for Vercel inference: secrets do not appear in process arguments, missing core answers fail before repository creation, and success or failure is machine-readable JSON. ChatGPT subscription setup intentionally requires interactive device-code authentication.
- `openbot init --help` prints the complete JSON Schema for that stdin object. It includes field names, human-readable descriptions, allowed values, conditional required fields, validation patterns, secret markers, and questions contributed dynamically by the selected runtime providers.
- `openbot new-agent` asks for an agent name, derives its kebab-case ID, and renders the fork-owned `configuration/templates/agent/**/*.hbs` tree under `configuration/agent/subagents/<id>/` without overwriting an existing agent. Every subagent gets the full instrumentation, tools, skills, and `sandbox/workspace` tree. Agents use `openbot new-agent "Research Agent" --json` for a machine-readable result.
- `openbot dev` checks all configured runtime providers, builds and starts the local Microsandbox Computer, then reconciles each authored agent's Tilde Vercel AI SDK endpoint, dynamic MCP server, and skill registry. Vercel service adapters skip remote work in this mode; Tilde enables local-running endpoints. The command supervises the combined control/agent HMR server, web, optional Electron process, and a Computer image watcher that rebuilds and replaces Microsandbox after Computer source or Containerfile changes. It persists non-secret `AGENT_<ID>_*` resource IDs in `configuration/.env` and newly issued endpoint credentials in SOPS. Use the Tilde tunnel when ChatKit must reach the local agent routes.
- `openbot deploy` builds selected providers, optionally stops with `--skip-deploy`, or plans and deploys providers with the runtime last.
- `openbot secrets set NAME --description TEXT` and `openbot secrets unset NAME` maintain described `configuration/secrets.enc.yaml` entries without putting plaintext values in command arguments. SOPS encrypts only each entry's `value`; its `description` stays readable. Agents pipe values with `--stdin`; descriptions are mandatory.
- `openbot env set NAME VALUE --description TEXT` and `openbot env unset NAME` maintain `configuration/.env`. Descriptions are mandatory and appear as plaintext comments above quoted values.
- `openbot check`, `openbot build`, `openbot test`, and `openbot e2e` delegate to the matching repository scripts, which remain the single definition of what each gate runs. `openbot desktop package` packages the Electron app. Extra arguments pass through.
- `openbot mobile <subcommand>` owns the Expo developer workflow and resolves `ANDROID_SDK_ROOT`, `ANDROID_HOME`, and a real Node binary before spawning anything, because Gradle shells out to `node` while evaluating settings and fails on a version-manager shim:
  - `mobile expo <args...>` passes through to the Expo CLI of the workspace app that depends on `expo`; override the location with `OPENBOT_MOBILE_DIR`.
  - `mobile emulator [--avd NAME] [--display N] [--vnc-port PORT] [--timeout MS]` boots the Android emulator and is idempotent, reusing a running Xvfb, emulator, or x11vnc. On Linux it runs headless behind Xvfb with x11vnc bound to loopback only; on macOS the emulator gets a real window.
  - `mobile setup` provisions the Android SDK idempotently — command line tools, licenses, platform and system-image packages — and reports root-only system packages instead of installing them.
  - `mobile avd [--name NAME] [--image PKG] [--device PROFILE]` creates the virtual device the emulator boots.
  - `mobile screenshot [--out FILE]` captures the device screen and prints the PNG path.
  - `mobile logs [logcat args]` streams the `ReactNativeJS` log channel.
  - `mobile doctor` verifies the toolchain and exits non-zero when a required tool is missing.
- `openbot desktop dev [--headless] [--display N] [--vnc-port PORT]` builds and launches the Electron shell. On a machine with a display it opens a window; on a display-less host it renders to a virtual screen published over loopback VNC on port 5901, a different display and port than the Android emulator so both run at once. `openbot desktop package` packages the app for the host platform.
- `openbot desktop release <build|publish|manifest|status>` publishes signed desktop builds to the updates bucket. `build` packages, signs, and notarizes; `publish` uploads this platform's artifacts and its release entry; `manifest` rebuilds `version.json` from the entries already in the bucket; `status` prints the resolved target. `publish` and `manifest` require `--yes` because both change a public feed, and all of them refuse the official bucket from a remote other than `trytilde/openbot`. See ADR-0028.
- `openbot connect <host> [--print] [--no-vnc] [--no-desktop] [--no-metro] [--no-adb]` opens the ssh tunnel that carries a remote development host's emulator screen, Electron screen, Metro bundler, and adb to this machine's loopback. Everything on a remote binds loopback, so the tunnel is the only path in; on a mac remote the same VNC port reaches macOS Screen Sharing.
- `openbot remote <host> <emulator|dev|android|ios|build|desktop|desktop-package|doctor>` runs a development task on a configured host over ssh. `ios` requires a mac host, and `desktop-package` produces artifacts for the remote's platform because Electron Builder targets the host it runs on.
- Development hosts are fork-owned configuration in `configuration/dev-hosts.json`, never package code. Any command also accepts a raw `user@host`:

```json
{
  "hosts": {
    "build": { "ssh": "root@198.51.100.7", "platform": "linux", "path": "~/openbot" },
    "mini": { "ssh": "me@mac-mini.local", "platform": "mac", "path": "~/openbot" }
  }
}
```

Developer commands require a repository checkout and fail with a clear error outside one. Operator commands such as `init` keep working in an empty directory.

## Public API

This package is an application and declares no importable package exports. Its internal command functions are implementation details; invoke the installed `openbot` executable, `npx openbot`, or the repository-local `pnpm openbot` script.

## Non-interactive initialization

Run from the completely empty destination directory and pipe answers on standard input:

```bash
openbot init --non-interactive --json < openbot-answers.json
```

For a private Vercel installation using AWS KMS, the answer object is:

```json
{
  "repository-name": "my-openbot",
  "repository-visibility": "private",
  "owner-identity": "aws-kms",
  "aws-kms-key-arn": "arn:aws:kms:us-east-1:123456789012:alias/openbot-sops",
  "aws-profile": "admin",
  "runtime": "vercel",
  "inference": "vercel",
  "vercel-token": "secret",
  "vercel-control-project": "my-openbot-control",
  "vercel-agent-project": "my-openbot-agents",
  "tilde-api-key": "secret",
  "tilde-org-id": "org-id",
  "tilde-team-id": "team-id",
  "vercel-ai-gateway-api-key-name": "My OpenBot agents"
}
```

`aws-profile` is optional and uses the default AWS credential chain when omitted. Other owner identity values are `gcp-kms`, `azure-key-vault`, `vault-transit`, `onepassword`, and `native-age`. Provider questions use their provider-defined question IDs, so custom providers remain automatable through the same input object. Missing-answer errors identify the exact stable ID required.

Other agent-safe mutations follow the same stdout JSON and nonzero-exit convention:

```bash
openbot new-agent "Research Agent" --json
printf '%s' "$SECRET_VALUE" | openbot secrets set API_TOKEN --stdin --json
openbot secrets unset API_TOKEN --json
openbot deploy --dry-run --json
```
