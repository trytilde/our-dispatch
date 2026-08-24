# @trytilde/sdk-vercel-ai-node

Server-side Tilde ChatKit, MCP, and custom tool helpers for applications built
with the Vercel AI SDK.

```bash
pnpm add @trytilde/sdk @trytilde/sdk-vercel-ai-node zod
```

## Public API

- `chatKitEndpoint(options)` verifies ChatKit webhooks and runs a Vercel AI SDK handler with typed
  session context and history.
- `createMCPClient(options)` creates a Tilde-authenticated AI SDK MCP client and merges local tools.
- `toolEndpoint(options)` exposes signed, Zod-validated custom tool discovery and invocation.
- `convertToAiSdkMessage` and `convertToAiSdkMessages` convert persisted ChatKit messages.
- `createChatKitAttachmentFilePartHandler(options)` resolves ChatKit attachments for model input.
- `verifyWebhookRequest`, `signBody`, and `WebhookVerificationError` implement signed webhook
  verification.

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
