# 0017: Sandbox live runtime and background SDLC reconciliation

## Status

Accepted — 2026-08-18

## Context

Agents were previously moved between the local-runtime tunnel and their deployed endpoints by an
explicit owner action (a Deploy step in the workspace UI, or a factory-agent skill that committed,
pushed, and ran `openbot deploy`). That made the software lifecycle a decision an agent had to be
aware of and get right, and it split the owner experience into build/test/deploy modes.

Grok Bot demonstrates the target experience: creating and tweaking an agent is one continuous chat,
and instruction changes take effect immediately. OpenBot agents are authored TypeScript, so a
lifecycle still exists — but agents should not be the ones driving it.

## Decision

- A background orchestrator (`openbot orchestrate`) owns the lifecycle. It serves agents from the
  trusted development sandbox through the Tilde local-runtime tunnel with hot reload and watches
  the checkout for edits.
- The first edit flips **every** agent to the tunnel (whole-repo, never per-agent: changes to
  shared files can affect any agent). After edits settle (30 seconds without file changes), the
  orchestrator verifies the project, commits and pushes the tree to the `openbot/sandbox-edits`
  branch through the Tilde git reverse proxy, redeploys agent services, and flips agents back to
  their deployed endpoints. A failed stage leaves agents on the tunnel and retries after the next
  settle.
- Agents are lifecycle-unaware. Factory skills no longer test or deploy; every scaffolded subagent
  receives a `self-edit` skill and computer tools that run in the development sandbox, so any agent
  can edit its own instructions, skills, and tools — the orchestrator makes the edits live.
- The workspace UI has no build/test/deploy modes. Creating an agent scaffolds and registers it
  via the repository CLI inside the development sandbox (`POST /api/agents`) and opens a chat with
  the agent itself.

## Consequences

- The development sandbox needs to be awake only while agents are editing — which is exactly when
  it is awake, because agent tools execute in it. When the pipeline lands, agents serve from the
  deploy provider and the sandbox may sleep.
- Every agent's tools run in the trusted sandbox, so every agent operates inside the trust
  boundary that previously applied only to the factory agent.
- `openbot/sandbox-edits` accumulates automated commits; merging them into the default branch is
  an explicit owner (or agent, on request) action via pull request.

<FOLLOW UP>
Automate the rest of the SDLC around the sandbox-edits branch: the orchestrator (or an agent
acting on owner intent) should open pull requests from `openbot/sandbox-edits`, keep them updated,
and merge them once checks pass, so the default branch converges with the live tree without manual
git work. Also supervise `openbot orchestrate` inside the development sandbox (start on sandbox
boot, restart on crash, reconnect the tunnel) instead of requiring a manual start.
</FOLLOW UP>
