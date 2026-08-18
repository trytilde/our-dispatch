---
name: create-or-update-agent
description: Create or modify the full primary OpenBot agent or one of its full subagents under configuration/agent, including its ChatKit endpoint, instructions, instrumentation, tools, skills, library code, and sandbox workspace seed. Use whenever adding an agent, changing an agent's filesystem layout or entrypoint, or updating agent build and deployment discovery.
---

# Create Or Update Agent

## Read the contract

Read `docs/adrs/0011-eve-compatible-agent-layout.md`, `docs/agents.md`, the target agent directory, and the agent-service provider discovery and build code. Preserve the Eve-shaped authored layout without claiming Eve runtime compatibility.

## Preserve the canonical tree

```text
configuration/
├── instrumentation.ts
├── templates/agent/**/*.hbs
└── agent/
    ├── agent.ts
    ├── instructions.ts
    ├── instrumentation.ts
    ├── lib/
    ├── tools/
    ├── skills/
    ├── sandbox/workspace/**
    └── subagents/<id>/
        ├── agent.ts
        ├── instructions.ts
        ├── instrumentation.ts
        ├── lib/
        ├── tools/
        ├── skills/
        └── sandbox/workspace/**
```

- The primary path has the stable ID `factory`. Derive each subagent ID from its directory name using lowercase kebab-case matching `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`.
- To create a subagent interactively, run `pnpm openbot new-agent` and enter its display name. From an agent or other non-interactive shell, run `pnpm openbot new-agent "<display name>"`. The CLI loads `configuration/templates/agent/**/*.hbs`, derives the ID, strips each `.hbs` suffix, materializes the complete full tree below `configuration/agent/subagents/`, then invokes idempotent development provisioning for every authored agent. Customize the generated files afterward. Do not hand-copy another agent directory or duplicate remote provisioning in the command.
- Treat `configuration/templates/agent/` as fork-owned defaults for future agents. Change it when all newly created agents need different SDK imports, environment variables, tools, skills, instructions, or workspace seeds. Template edits never rewrite existing agents.
- Never import provider packages or `configuration/index.ts` from authored agents. Integrate model, MCP, skills, Composio, and other vendor SDKs directly in agent code so provider abstractions do not constrain agent development.
- Require `agent.ts` and `instructions.ts`.
- Default-export the Tilde `chatKitEndpoint(...)` request handler from `agent.ts`. Import `instructions.ts` explicitly and pass it into the endpoint's system prompt.
- Default-export TypeScript instructions from `instructions.ts`. Do not add `instructions.md`.
- Keep reusable import-only TypeScript in `lib/`.
- Default-export one Vercel AI SDK tool from each file in `tools/`.
- Require the scaffolded computer tools `await_shell.ts`, `bash.ts`, `copy_from_computer.ts`, `copy_to_computer.ts`, `read_file.ts`, `write_file.ts`, `glob.ts`, `grep.ts`, and `screenshot.ts`. Import them explicitly in `agent.ts` under matching tool names.
- Keep each authored computer-tool file as a thin default export from `@tryopenbot/computer-tools`, passing the path-derived agent ID as a fixed option. Shared implementations and Zod schemas belong to that non-provider runtime utility package, not in each agent and not in the proto package. Never call Microsandbox, Vercel Sandbox, `fetch`, or an untyped computer endpoint from an agent tool.
- Authenticate the typed client with the SOPS-installed `OPENBOT_COMPUTER_SERVICE_API_KEY`. Do not generate, derive, return, log, or persist a second agent-local computer credential.
- Store specification-conformant skill Markdown files or skill folders under `skills/`.
- Preserve the scaffolded `skills/create-agent/SKILL.md`; it teaches runtime agents to use the non-interactive `new-agent` command from a writable source checkout and to leave deployment explicit.
- Keep skills and sandbox workspace seeds inside their owning agent directory. Never create, read, or migrate content to global `configuration/skills/` or `configuration/sandbox/` directories; those paths are unsupported.
- Do not add channels, connections, hooks, schedules, or nested subagents. Every direct subagent remains a full independently built agent with its own instrumentation, tools, skills, and workspace seed.
- Do not directory-load arbitrary tools or skills. Computer tools are the required exception and are explicitly imported by `agent.ts`.

## Instrument startup

Use `defineInstrumentation({ setup })` from `@tryopenbot/configuration/instrumentation`. Keep `configuration/instrumentation.ts` installation-wide and `instrumentation.ts` in either full agent directory agent-specific. Both are optional at runtime; an empty `setup` function is valid.

Run global instrumentation first, agent instrumentation second, and import `agent.ts` only afterward. Supply the path-derived `agentName`. Instrumentation is a server startup hook, not an agent tool or request hook.

## Preserve build and deployment behavior

Treat each `agent.ts` as an independently buildable agent-service entrypoint. Keep local development's combined server and production's separate agent artifacts aligned. Vercel builds must remain concurrent across agents.

All agents share one OpenBot Computer, filesystem, and process identity. If `sandbox/workspace/**` contains files, deployment seeds them once into `/workspace/<agent-id>`. Commands and relative paths default there, but agents can use absolute paths, inspect sibling directories, and administer the shared machine. Treat the agent directory as an organizational default, never as a security boundary.

Keep the authored directory name `sandbox/` and Eve-compatible tool filenames only because OpenBot follows Eve's project layout where possible. Use Computer for APIs, environment variables, classes, and prose about the runtime. Computer-service owns agent-ID validation, default-directory selection, and background-job ownership; callers must not send a username or treat the ID as authorization for filesystem paths.

Create `/workspace/<agent-id>` only when the authored `sandbox/workspace/**` is populated, and seed it only once. Never overwrite an existing deployed directory during an ordinary agent deployment. State clearly when changing seed files that already-deployed agents will not receive those changes without explicit future reconciliation or computer replacement. Reject symlinks in agent source and workspace seeds.

Scaffold `sandbox/workspace/.profile`. Bash tools run `bash -lc` with `HOME=/workspace/<agent-id>`, so this is the deterministic startup file for every agent Bash command. Let it source an optional `.bashrc`; keep secrets out of both files. Treat profile edits like every other one-time workspace seed change.

## Initialize examples

Keep `openbot init` seeding the default Handlebars files into `configuration/templates/agent/` without overwriting fork edits, then using them to generate the full primary Factory agent. `openbot new-agent` uses the same template for full subagents. The initial agent includes:

- `agent.ts` importing `instructions.ts`
- an empty global and agent instrumentation hook
- all standard computer tools; factory-only skills (create-agent, test-agent, deploy-agent, develop-openbot) live in `configuration/templates/factory/` and render into the primary agent only
- a sandbox workspace seed with `.profile`

Generate source files from the fork-owned Handlebars template through `@tryopenbot/utilities`; do not embed whole generated files in TypeScript strings. The CLI's packaged assets only seed a missing template during init.

## Verify

Run focused agent-service provider discovery, build, computer-service, and initialization tests when implementation changes are in scope. Check that every agent is discoverable by directory, imports its instructions and required computer tools, and preserves the supported tree. Do not claim skills or arbitrary tools load automatically.
