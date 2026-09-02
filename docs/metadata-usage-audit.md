# Metadata usage audit

Audit date: 2026-09-02

Governing decision: [ADR-0038](adrs/0038-metadata-is-extension-data.md)

## Internal semantics to refactor

| Current metadata use | Why it is internal | Source | Required direction |
|---|---|---|---|
| `metadata.tildeAgentRun` and `metadata.tildeAgentJob` | Durable run/job identity, worker, generation, model and hard budgets | `cli/src/assets/agents/factory/agent.ts.hbs` | Typed ChatKit HTTP-agent execution context generated from Tilde OpenAPI. |
| `metadata.createdAt` / `created_at` | Agent turn queue cutoff | `cli/src/assets/agents/factory/agent.ts.hbs` | Typed message timestamp or typed queue context. |
| `message.metadata.signal_type` | Signal discrimination and handler routing | `packages/sdk-vercel-ai-node/src/chatkit-message.ts` | Typed Signal message field/discriminated union. |
| `message.metadata.summary` | Message presentation | `packages/ui/src/message-content.tsx` | Typed display summary. |
| Credential `metadata.display_name` | Reconciliation identity/fallback matching | `packages/agent-provider/src/tilde/tools.ts` | Explicit credential display name or stable lifecycle ID. |
| Provider/skill metadata icon, category and signing-key description | Shared provider catalogue and renderer behavior | `packages/client-runtime/src/tilde-plugins.ts`; `tilde-settings.ts` | Typed server-authored provider branding, category and setup descriptor fields. |

## Metadata uses to retain

| Metadata family | Classification | Source |
|---|---|---|
| Vercel AI Gateway `providerMetadata` used to read the provider generation ID | Provider-specific; the Vercel adapter owns it | `packages/sdk-vercel-ai-node/src/hosted-inference-billing.ts` |
| AgentMail, GitHub, Slack and Linq message metadata | Provider-specific; parsed by the corresponding ChatKit provider adapter | `packages/sdk-vercel-ai-node/src/chatkit-provider-metadata.ts` |
| AI SDK attachment `providerMetadata` | Provider wire extension | `packages/sdk-vercel-ai-node/src/chatkit-attachments.ts`; `packages/computer-tools/src/attachments.ts` |
| Coding-agent source/session/cwd/model annotations | Client-opaque message extension; Tilde core does not interpret them | `packages/sdk/src/chatkit/coding-agent.ts` |
| Routine, task and job metadata exposed unchanged by SDK wrappers | Client-opaque while Tilde/OpenBot do not interpret it | `packages/sdk/src/chatkit/{routines,work,jobs}.ts` |
| Link-preview metadata | Typed presentation object, not a generic domain control bag | `packages/ui/src/content-components.tsx` |

## Excluded lexical uses

Filesystem `stat` metadata, gRPC transport `Metadata`, HTML media
`loadedmetadata`, Next.js page metadata, Git repository metadata, and typed
provider-initialization descriptors are not JSON extension bags and are outside
ADR-0038.

## Refactor order

1. Typed durable execution context and message timestamps.
2. Typed Signal and message summary fields.
3. Typed credential/provider catalogue descriptors.

The corresponding Tilde fields must land first; OpenBot must refresh generated
contracts rather than replacing one magic metadata parser with another.
