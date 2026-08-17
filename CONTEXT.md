# OpenBot

OpenBot is an agent workspace that combines conversation with an isolated computer. This glossary names its product and ownership boundaries consistently.

## Language

**OpenBot Installation**:
A single deployed or locally running OpenBot instance with its own setup and control state.
_Avoid_: deployment, instance, or account when the installation is meant

**OpenBot Workspace**:
The user-facing place where an owner chats with agents and uses their computer.
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
The Tilde runtime isolation boundary that owns OpenBot's agents, chats, tools, skills, and memory.
_Avoid_: workspace

**Tilde Agent**:
An agent registered in a **Tilde Team** and available for conversation through OpenBot.
_Avoid_: bot

**ChatKit Session**:
A Tilde-owned conversation between an owner and a **Tilde Agent**.
_Avoid_: local chat, thread

**OpenBot Computer**:
The isolated, resumable computer an agent can use for files, commands, browser work, and desktop interaction.
_Avoid_: host, server

**Control State**:
OpenBot-owned installation, onboarding, computer lease, deployment progress, repository reconciliation mappings, and source-publication progress.
_Avoid_: agent state, chat state

_Avoid_: credentials, runtime state

## Relationships

- An **Owner** authenticates through OIDC without a pairing-code gate.
- Each **OpenBot Installation** has one **Installation Resource** and accepts only access tokens
  with that exact audience.
- Tilde login may provide SSO across installations, but each installation keeps independent access
  tokens and host-only cookies.
- An **OpenBot Installation** presents one **OpenBot Workspace**.
- An **OpenBot Installation** connects to one **Tilde Organization** and **Tilde Team**.
- A **Tilde Team** owns one or more **Tilde Agents** and their **ChatKit Sessions**.
- An **OpenBot Installation** controls at most one active **OpenBot Computer**.
- **Control State** belongs to OpenBot; agent and conversation state belongs to the **Tilde Team**.
- Tilde provider lifecycles reconcile their resources through the typed API client.

## Example dialogue

> **Developer:** "Should this new chat record go into OpenBot control state?"
> **Domain expert:** "No. A ChatKit Session belongs to the Tilde Team; OpenBot stores only Control State for the installation and its computer."

## Flagged ambiguities

- "workspace" can mean the **OpenBot Workspace**, a Tilde team, or the computer filesystem; use the explicit term.
- "agent" can mean a **Tilde Agent** or the software implementing its behavior; use **Tilde Agent** for the registered runtime resource.
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
Trigger: when computer-provider replaces the legacy production sandbox adapter
Work: persist the computer-provider build lifecycle's source digest and immutable image reference in redacted deployment state, and prove a second unchanged deployment skips both image build and publication
</FOLLOW UP>
