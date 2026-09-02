# @trytilde/sdk-vercel-ai-node

Server-side Tilde ChatKit, MCP, and custom tool helpers for applications built
with the Vercel AI SDK.

```bash
pnpm add @trytilde/sdk @trytilde/sdk-vercel-ai-node zod
```

## Public API

- `chatKitEndpoint(options)` verifies ChatKit webhooks and runs a Vercel AI SDK handler with typed
  session context and history. Select `responseMode: "agentLoop"` for direct streamed responses or
  `responseMode: "tool"` to expose provider-bound communication through `context.session.tools`
  and `context.$provider.tools` while treating returned assistant text as private reasoning. Tool
  mode instructs the model to use `sendMessage` once for the completed result; acknowledgements and
  progress messages are reserved for explicit requests or genuinely long-running work.
- `createMCPClient(options)` creates a Tilde-authenticated AI SDK MCP client, registers local tools
  for the owning ChatKit agent, and records local and dynamic child executions. Pass `agentId` when
  supplying `tools`; use `chatkit.sessionId` to correlate executions to the active session. Tilde
  derives the tools and agents reachable from that session from the authenticated agent record;
  callers cannot declare permissions in this client. `context.mcp.connect(options)` constructs a
  request-scoped connection in every endpoint mode. Inside a tool-mode endpoint,
  `context.session.createMCPClient(options)` also injects the current session's bound provider tools
  without registering them as authored local tools. When Tilde supplies a verified speaker-bound
  personal-tool capability, both request-scoped helpers forward it privately to MCP with fresh
  nonce and protocol-session bindings; the capability is removed before application code runs.
- `createChatKitSessionTools(client, session)` constructs the trusted, provider-aware `sendMessage`,
  reaction, thread, AgentMail, and Linq poll tools used by tool-mode endpoints.
- `toolEndpoint(options)` exposes signed, Zod-validated custom tool discovery and invocation.
- `convertToAiSdkMessage` and `convertToAiSdkMessages` convert persisted ChatKit messages.
- AgentMail, GitHub, and Slack provider metadata is promoted into typed endpoint context, and
  AgentMail Signals can be handled through the discriminated `AgentMailSignalByType` map.
- `ChatKitEndpointContext` exposes validated provider metadata through typed `github`, `slack`, and
  `linq` fields, plus canonical receiving-agent metadata through optional `context.agent`.
  Delegated sessions expose the authenticated caller through
  `context.body.session.parentAgentId`; direct sessions omit it.
  `ChatKitRequestAgent` includes the agent ID, display name, provider, status, principal, avatar
  path, and lifecycle timestamps. `LinqChatKitMessageMetadata` describes inbound Linq chats,
  handles, and parts.
- `LinqSignalType`, `LinqSignalByType`, and `LinqWebhookEnvelope` strongly type every supported Linq
  webhook event. Register event-specific conversion handlers under `onUnprocessed.linq`.
- `createChatKitAttachmentFilePartHandler(options)` resolves ChatKit attachments for model input.
- `HostedInferenceBillingController` reserves organization AI credits before every managed model
  call, settles authoritative Gateway generation receipts, releases excluded BYOK calls, and
  blocks provider replay while a durable AgentRun effect outcome is uncertain. All Gateway calls
  reserve before inference because BYOK can fall back to charged system credentials; an
  authoritative BYOK receipt releases the reservation. Callers must terminally
  fail a reconciled run when no model response can be recovered; replaying the
  same step is unsafe. Supply an `effectScope` derived from the semantic
  continuation or operation, not the lease generation: effect lookup must stay
  stable when a reclaimed worker receives a new generation, while prepare and
  finish writes remain fenced by the current `runGeneration`, `workerId`, and
  `stepId`.
- `createMemorySynthesisInferenceRun(options)` creates and claims one lease-fenced AgentRun per
  Tilde synthesis batch and worker lease, then composes `HostedInferenceBillingController` with
  that run. Redelivery within the same synthesis lease reuses the durable effect ledger; a newly
  reclaimed API lease gets a distinct run and must satisfy its own mutation/completion fencing.
  Failed commit or BYOK release boundaries leave the run waiting until preflight replays the
  committed settlement, after which the unrecoverable provider response is terminalized without
  another provider call.
  `parseMemorySynthesisInvocation(messages, webhookId)` accepts only Tilde's exact batch prompt.
- `createChatKitCompactionController(options)` implements an agent-owned `prepareStep` compaction
  loop; compose it after provider preparation with `composeChatKitCompactionPrepareStep`.
- `runAgentObjective(options)` and `runAgentHostOnce(options)` continue durable objectives across
  request and deployment boundaries with loop and budget guards.
- `executeRunEffect(options)` records effect intent before execution and reuses committed outputs;
  unsupported uncertain outcomes are never automatically repeated.
- `createChatKitAutomaticMemoryController(options)` converts server-authorized
  recall into a deterministic dynamic system suffix for insertion after stable
  instructions and any compaction checkpoint.
- `composeChatKitAutomaticMemoryMessages(options)` preserves checkpoint →
  memory → mutable-tail ordering without moving stable instructions out of the
  model call's cacheable `instructions` field.
- `createMemorySynthesisTools(session)` creates bank-free tools for a Tilde
  synthesis session; `context.session.memorySynthesisTools()` supplies the
  request-bound form inside a ChatKit endpoint. Upsert, supersede, forget, and
  finish tools require the current job's exact batch, evidence set, and lease owner.
- `verifyWebhookRequest`, `signBody`, and `WebhookVerificationError` implement signed webhook
  verification.

Compaction is request-scoped and never rewrites ChatKit history. The active agent reports start,
completion, or failure through `context.session`; ChatKit persists those events while authored
code controls thresholds, prompts, retries, and retained context.

```ts
import { convertToAiSdkMessage, type LinqSignalByType } from "@trytilde/sdk-vercel-ai-node";

type Received = LinqSignalByType["linq.message.received"];

const message = await convertToAiSdkMessage({
  message: signal,
  onUnprocessed: {
    linq: {
      "linq.message.received": async (received: Received) => ({
        id: received.id,
        role: "user",
        parts: [{ type: "text", text: `Message in ${received.data.data.chat?.id}` }],
      }),
    },
  },
});
```

## Remote custom tools

`toolEndpoint` returns signed `GET` discovery and `POST` invocation handlers.
It derives the public invocation URL from the incoming request unless you set
`baseUrl` or `endpointPath`.

```ts
import { toolEndpoint } from "@trytilde/sdk-vercel-ai-node";
import { z } from "zod";

export const { GET, POST } = toolEndpoint({
  webhookSigningKey: process.env.TILDE_CUSTOM_TOOL_SIGNING_KEY!,
  provider: {
    name: "Example tools",
    description: "Example remote tools",
    version: "1.0.0"
  },
  tools: [
    {
      id: "greet",
      name: "Greet",
      description: "Greet a person by name.",
      inputSchema: z.object({ name: z.string() }),
      outputSchema: z.object({ greeting: z.string() }),
      async fn({ name }) {
        return { greeting: `Hello, ${name}!` };
      }
    }
  ]
});
```

See the
[code review bot example](https://github.com/trytilde/examples/tree/main/code-review-bot)
for a complete endpoint.
