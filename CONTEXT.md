# OpenBot

OpenBot is an agent workspace that combines conversation with an isolated computer. This glossary names its product and ownership boundaries consistently.

## Language

**OpenBot Installation**:
A single deployed or locally running OpenBot instance with its own setup and control state.
_Avoid_: deployment, instance, or account when the installation is meant

**OpenBot Workspace**:
The user-facing place where an owner chats with bots and uses their computer.
_Avoid_: Tilde workspace

**Owner**:
The person responsible for configuring and operating an **OpenBot Installation**.
_Avoid_: admin, user, or customer when ownership is meant

**Installation Resource**:
The OAuth protected-resource identity assigned to one **OpenBot Installation**. Its exact URI is
the required access-token audience for that installation.
_Avoid_: client ID or scope when the protected installation is meant

**Owner Principal**:
The verified subject, **Installation Resource**, client, scopes, roles, and entitlements available
to an owner-facing control handler after authentication and authorization.
_Avoid_: treating a decoded token or session cookie alone as authorization

**Tilde Organization**:
The Tilde ownership and billing boundary selected during setup.

**Tilde Team**:
The Tilde workspace and runtime isolation boundary selected by an OpenBot installation. Tilde resources may be `team`, personal `user`, or private `user_team`; OpenBot's authored-agent lifecycle continues to reconcile team resources unless it explicitly opts into a personal API.

**Tilde Resource Ownership**:
A tagged authorization boundary. `team` carries organization and team, `user` carries organization and owner without a team, and `user_team` carries organization, execution team, and owner. Child records inherit their root's ownership.
_Avoid_: workspace

**Tilde Agent**:
The registered runtime resource in a **Tilde Team** that implements a bot.
_Avoid_: bot when the registered runtime resource is meant

**Bot**:
The owner-facing name for a **Tilde Agent** available for conversation through OpenBot.
_Avoid_: agent in owner-facing UI and copy

**ChatKit Session**:
A Tilde-owned conversation between an owner and a **Tilde Agent**.
_Avoid_: local chat, thread

**Context Compaction**:
An agent-owned replacement of older model input with a durable handoff summary
and recent complete conversation tail; it never deletes or rewrites the
canonical **ChatKit Session** transcript.
_Avoid_: ChatKit summarization

**OpenBot Computer**:
The isolated, resumable computer an agent can use for files, commands, browser work, and desktop interaction.
_Avoid_: host, server

**Control State**:
OpenBot-owned installation, onboarding, computer lease, deployment progress, repository reconciliation mappings, and source-publication progress.
_Avoid_: agent state, chat state

_Avoid_: credentials, runtime state

**Client Runtime**:
The framework-neutral layer in `packages/client-runtime` that owns every UI contract, remote
snapshot, and live-state reconciliation shared by the web and desktop clients. Required for
major UX surfaces and state interactions; presentation-only component state is excluded.
_Avoid_: frontend state library, shared components, or server SDK

## Relationships

- An **Owner** authenticates through OIDC without a pairing-code gate.
- Each **OpenBot Installation** has one **Installation Resource** and accepts only access tokens
  with that exact audience.
- Tilde login may provide SSO across installations, but each installation keeps independent access
  tokens and host-only cookies.
- An **OpenBot Installation** presents one **OpenBot Workspace**.
- An **OpenBot Installation** connects to one **Tilde Organization** and **Tilde Team**.
- A **Tilde Team** owns one or more **Tilde Agents**, presented to owners as **Bots**. Ordinary sessions are team-owned; private ChatKit sessions use `user_team` ownership.
- An **OpenBot Installation** controls at most one active **OpenBot Computer**.
- **Control State** belongs to OpenBot; agent and conversation state belongs to the **Tilde Team**.
- Every OpenBot client reaches an **OpenBot Workspace** through the **Client Runtime**; renderers own
  presentation only.
- Tilde provider lifecycles reconcile their resources through the typed API client.

## Example dialogue

> **Developer:** "Should this new chat record go into OpenBot control state?"
> **Domain expert:** "No. A ChatKit Session belongs to the Tilde Team; OpenBot stores only Control State for the installation and its computer."

## Flagged ambiguities

- "workspace" can mean the **OpenBot Workspace**, a Tilde team, or the computer filesystem; use the explicit term.
- "agent" can mean a **Tilde Agent** or the software implementing its behavior; use **Tilde Agent** for the registered runtime resource and **Bot** in owner-facing UI.
- "state" can mean **Control State** or Tilde-owned runtime data; name the owner and kind.

## Follow-up markers

Known, intentionally deferred work must be written as a standalone block using
the exact tags below. PR preparation and merged-PR review should search for
these blocks rather than relying on an unstructured TODO comment.

```text
<FOLLOW UP>
Owner: <package or subsystem>
Trigger: <the change that makes this work actionable>
Work: <specific remaining behavior and its acceptance proof>
</FOLLOW UP>
```

<FOLLOW UP>
Owner: production deployment orchestrator
Trigger: when computer-service-provider replaces the legacy production sandbox adapter
Work: persist the computer-service-provider build lifecycle's source digest and immutable image reference in redacted deployment state, and prove a second unchanged deployment skips both image build and publication
</FOLLOW UP>

<FOLLOW UP>
Background SDLC automation (ADR-0017): agents or the orchestrator should open pull requests from
the `openbot/sandbox-edits` branch and merge them once checks pass, completing the automated
software lifecycle.
</FOLLOW UP>
