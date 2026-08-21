# Repository configuration

The upstream repository initially tracks only `configuration/.gitignore`, with every configuration entry ignored. Run the standalone `openbot init` command from a completely empty destination directory; it creates and clones the owner repository before configuration begins. After initialization succeeds, init removes that exact sentinel so the fork can commit its generated configuration. Commit the sentinel deletion with the generated files. Git preserves that committed deletion during ordinary merges while upstream leaves the sentinel unchanged; if upstream ever changes it, resolve the delete/modify conflict in favor of the fork's configuration. Init creates `configuration/index.ts` as the single fork-owned composition root and `configuration/templates/agent/` as the fork-owned source for future agents. The selected inference provider seeds its SDK-specific source into that template once; the copied files are then fork-owned. `index.ts` names and constructs every provider role explicitly. Agent entrypoints read their runtime environment directly instead of importing provider composition. Provider packages do not select implementations from string IDs. `Configuration()` only type-checks provider selection. Tracked source must not contain credentials.

OpenBot never loads root `.env`, `.env.local`, or a root SOPS document. Fork-owned values live only in `configuration/.env` and `configuration/secrets.enc.yaml`. User-specific SOPS lookup metadata lives in `~/.openbot/config.json` under `sops` and must not be checked into a fork. Contributors and CI use their process environment for repository-maintenance credentials.

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

`openbot new-agent` renders the fork-owned agent template, preserves relative
paths, and removes each `.hbs` suffix. Init seeds the default template only when
the directory is missing, so later init runs preserve owner changes. Template
edits affect future agents only. When provider composition changes in
`configuration/index.ts`, inspect the template for matching environment
variables, tools, prompts, and endpoint wiring; migrate existing agents
explicitly when required.

The Vercel Sandbox computer provider does not ask for a registry. Deployment
creates the control and agent Vercel projects first, then authenticates Docker
with the deployment token and creates `openbot-computer` in the agent project's
built-in Vercel Container Registry on first push. The local Microsandbox
provider tags its local image from the Git remote, such as
`trytilde/openbot-computer:<content-tag>`.

Run `pnpm openbot check` after every configuration change. Provider build checks also run automatically before `pnpm openbot deploy` creates or deploys an artifact.
