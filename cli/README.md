# openbot

The React Ink repository CLI for OpenBot initialization, development supervision, encrypted secret maintenance, service execution, and provider-coordinated deployment. Commands are parsed with `arg`; command entrypoints live under `src/commands/`.

Provider lifecycle failures identify both the concrete implementation and provider domain. CLI failures always print the complete redacted stack and cause chain below the concise error message; the same stack is included in JSON error output and the private run log.

## Install

```bash
npm install --global openbot
openbot --help
```

The CLI operates on the OpenBot repository in the current working directory. For a new installation, run `openbot init` from a completely empty destination directory; it verifies canonical OpenBot, creates an owned GitHub repository, clones the verified revision, and writes configuration. Running `openbot init` again from that initialized repository revisits the active platform and provider questions with stored values pre-populated. It does not recreate the repository or replace the existing SOPS ownership configuration. The CLI can also run without a global install using `npx openbot`.

## Commands

- For a new installation, `openbot init` rejects any non-empty destination before prompts or network mutation, verifies Git and authenticated GitHub CLI/SSH access, then accepts either a bare repository name for the authenticated account or `owner/name` for an authorized organization. It creates either a public fork or independent private mirror. After cloning it creates `configuration/.env`, `configuration/index.ts`, SOPS recipients and encrypted secrets, seeds `configuration/templates/agent/`, then scaffolds the Hello World agent from that template. It removes the exact upstream `configuration/.gitignore` sentinel, generates the described `COMPUTER_SERVICE_API_KEY`, and creates a named Vercel AI Gateway key stored in SOPS as `AI_GATEWAY_API_KEY`.
- In an already initialized OpenBot repository, `openbot init` decrypts the current values, uses them as prompt defaults, updates only active platform/provider destinations, preserves unrelated environment and secret entries, re-encrypts with the existing SOPS recipients, seeds the agent template only when missing, and runs `vp install` again. User-specific owner lookup metadata lives at `~/.openbot/config.json` under `sops`; interactive commands ask to recover missing values, while non-interactive commands stop and explain that interactive init is required.
- `openbot init --non-interactive --json` runs the same path from a JSON object on standard input. This is the supported automation and AI-agent interface: secrets do not appear in process arguments, missing core answers fail before repository creation, and success or failure is machine-readable JSON.
- `openbot init --help` prints the complete JSON Schema for that stdin object. It includes field names, human-readable descriptions, allowed values, conditional required fields, validation patterns, secret markers, and questions contributed dynamically by the selected runtime providers.
- `openbot new-agent` asks for an agent name, derives its kebab-case ID, and renders the fork-owned `configuration/templates/agent/**/*.hbs` tree under `configuration/agent/subagents/<id>/` without overwriting an existing agent. Every subagent gets the full instrumentation, tools, skills, and `sandbox/workspace` tree. Agents use `openbot new-agent "Research Agent" --json` for a machine-readable result.
- `openbot dev` checks all configured runtime providers, builds and starts the local Microsandbox Computer, then reconciles each authored agent's Tilde Vercel AI SDK endpoint, dynamic MCP server, and skill registry. Vercel service adapters skip remote work in this mode; Tilde enables local-running endpoints. The command supervises the combined control/agent HMR server, web, optional Electron process, and a Computer image watcher that rebuilds and replaces Microsandbox after Computer source or Containerfile changes. It persists non-secret `AGENT_<ID>_*` resource IDs in `configuration/.env` and newly issued endpoint credentials in SOPS. Use the Tilde tunnel when ChatKit must reach the local agent routes.
- `openbot deploy` builds selected providers, optionally stops with `--skip-deploy`, or plans and deploys providers with the runtime last.
- `openbot secrets set NAME --description TEXT` and `openbot secrets unset NAME` maintain described `configuration/secrets.enc.yaml` entries without putting plaintext values in command arguments. SOPS encrypts only each entry's `value`; its `description` stays readable. Agents pipe values with `--stdin`; descriptions are mandatory.
- `openbot env set NAME VALUE --description TEXT` and `openbot env unset NAME` maintain `configuration/.env`. Descriptions are mandatory and appear as plaintext comments above quoted values.
- `openbot check`, `openbot build`, and `openbot test` delegate to the matching repository scripts.

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
