# Repository configuration

The upstream repository initially tracks only `configuration/.gitignore`, with every configuration entry ignored. Run the standalone `openbot init` command from a completely empty destination directory; it creates and clones the owner repository before configuration begins. After initialization succeeds, init removes that exact sentinel so the fork can commit its generated configuration. Commit the sentinel deletion with the generated files. Git preserves that committed deletion during ordinary merges while upstream leaves the sentinel unchanged; if upstream ever changes it, resolve the delete/modify conflict in favor of the fork's configuration. A provider failure after clone leaves a resumable checkout. Init creates `configuration/index.ts` as the single fork-owned composition root and `configuration/templates/agent/` as the fork-owned source for future agents. The selected inference provider seeds its SDK-specific source into that template. On later interactive init runs, every provider domain with multiple built-ins is shown as a React Ink selector with the configured implementation preselected and all alternatives available. Selection is staged: init asks and provisions the selected provider immediately before presenting another provider domain. Init may rewrite a recognized canonical built-in composition, but it preserves custom or owner-edited composition. An inference switch migrates the future template and existing agents only while the affected files exactly match the previous provider scaffold. `index.ts` names and constructs every provider role explicitly. Agent entrypoints read their runtime environment directly instead of importing provider composition. Provider packages do not select implementations from string IDs. `Configuration()` only type-checks provider selection. Tracked source must not contain credentials.

OpenBot never loads root `.env`, `.env.local`, or a root SOPS document. Fork-owned values live only in `configuration/.env` and `configuration/secrets.enc.yaml`. User-specific SOPS lookup metadata lives in the gitignored root `local-user-config.json` under `sops`, so each checkout selects the correct owner authority. Interactive commands configure the file inline when it is absent. Contributors and CI use their process environment for repository-maintenance credentials.

```json
{
  "version": 1,
  "sops": {
    "ownerIdentity": {
      "kind": "aws-profile",
      "profile": "my-admin-profile"
    }
  }
}
```

```ts
import { Configuration } from "@tryopenbot/configuration";
import { TildeAgentProvider } from "@tryopenbot/agent-provider";
import { VercelAgentServiceProvider } from "@tryopenbot/agent-service-provider";
import { VercelControlServiceProvider } from "@tryopenbot/control-service-provider";
import { VercelSandboxComputerProvider } from "@tryopenbot/computer-service-provider";
import { VercelInferenceProvider } from "@tryopenbot/inference-provider";
import { TildePlatform, VercelPlatform } from "@tryopenbot/platform-integrations";

const tilde = new TildePlatform({
  apiKey: process.env.TILDE_API_KEY!,
  baseUrl: process.env.TILDE_BASE_URL ?? "https://api.trytilde.ai",
  orgId: process.env.TILDE_ORG_ID!,
  teamId: process.env.TILDE_TEAM_ID!,
});
const vercel = new VercelPlatform();

export default Configuration({
  providers: {
    controlService: new VercelControlServiceProvider({ platform: vercel }),
    agentService: new VercelAgentServiceProvider({ platform: vercel }),
    agent: new TildeAgentProvider(tilde),
    computer: new VercelSandboxComputerProvider({ platform: vercel }),
    inference: new VercelInferenceProvider(vercel),
  },
});
```

This composition is for OpenBot control, provisioning, and deployment. Agent files do not import it or any provider package. Put model, MCP, skill, Composio, and other vendor SDK wiring directly in the agent and in `configuration/templates/agent/` when it should be a future default.

Repository resources always use their canonical file locations:

- primary agent: `configuration/agent/`, served below `/api/agents/factory`
- subagents: `configuration/agent/subagents/<id>/`, served below `/api/agents/<id>`
- future-agent template: `configuration/templates/agent/**/*.hbs`
- global agent instrumentation: `configuration/instrumentation.ts`
- agent skills: each primary or subagent directory's `skills/`
- custom provider source: `configuration/providers/`
- agent workspace seed: each primary or subagent directory's `sandbox/workspace/`

These locations are conventions, not configuration options. Global `configuration/skills/` and `configuration/sandbox/` directories are not supported. File discovery makes the same fork work from source and from a Vercel function bundle. Symlinks, escaping paths, duplicate IDs, oversized files, and malformed skill metadata fail generation or startup.

Custom provider implementations live under `configuration/providers/` and must be explicitly imported and instantiated in `configuration/index.ts`.

The built-in `exe-dev` composition shares one `ExeDevPlatform` between
`ExeDevRuntimeServiceProvider` and `ExeDevComputerProvider`, and selects
`CodeStorageGitProvider`. Its initialization stores VM identity and sizing as environment values,
accepts the Code Storage organization key only as transient setup input, and persists the generated
repository-only JWT as a SOPS secret. The remote VM receives the decrypted fork configuration
because this mode deliberately promotes the trusted development lifecycle to an always-on runtime.

`openbot new-agent` renders the fork-owned agent template, preserves relative
paths, and removes each `.hbs` suffix. Init seeds the default template when it
is missing. When an init selector changes inference providers, init can replace
the previous provider scaffold across the future template and existing agents,
but only after byte-for-byte ownership checks pass for every affected file.
Otherwise it stops before changing composition and requires an explicit
migration. Ordinary template edits affect future agents only. When provider
composition changes outside init, inspect the template for matching environment
variables, tools, prompts, and endpoint wiring; migrate existing agents
explicitly when required.

The Vercel Sandbox computer provider does not ask for a registry. Deployment
creates the control and agent Vercel projects first, then authenticates Docker
with the deployment token and creates `openbot-computer` in the agent project's
built-in Vercel Container Registry on first push. The local Microsandbox
provider tags its local image from the Git remote, such as
`trytilde/openbot-computer:<content-tag>`.

Run `pnpm openbot check` after every configuration change. Provider build checks also run automatically before `pnpm openbot deploy` creates or deploys an artifact.
