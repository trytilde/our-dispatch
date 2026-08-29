# @trytilde/sdk

Core TypeScript client for Tilde agents, MCP servers, skills, ChatKit sessions,
and credential-injecting reverse proxies.

```bash
pnpm add @trytilde/sdk
```

## Public API

- `createConfig(input)` normalizes Tilde team, organization, URL, and authentication settings.
- `createClient(config?)` creates the core client with ChatKit, MCP, messages, and skills APIs.
- `createTildeGrpcReverseProxy(options)` exposes a credential-injecting gRPC reverse proxy.
- `wrapMcpClientWithLocalTools(options)` combines remote MCP tools with process-local tools.
- `ChatKitClient.registerAgentTools(input)` reconciles an agent's process-local tool catalog.
- `ChatKitClient.reportToolExecution(input)` records canonical local-tool execution lifecycle events.
- `ChatKitClient.sendSessionMessage(input)` persists a visible message through the provider and
  active turn bound by ChatKit.
- `ChatKitClient.invokeSessionProviderTool(input)` invokes a reaction, thread, or poll action using
  trusted session routing rather than model-supplied provider identifiers.
- `McpClient.addFunctions(input)` and `McpClient.removeFunctions(input)` atomically reconcile up to 500 function mappings from one tool provider instance.
- `SkillPackage` and `SkillsClient` discover, download, verify, and materialize managed skills.
- `@trytilde/sdk/api` exposes the generated API client when a stable wrapper does not yet exist.
- `@trytilde/sdk/json` exposes the shared JSON types, guards, accessors, and parser.

## JSON values

`@trytilde/sdk/json` owns the SDK's shared JSON types, object guards, string-field accessors, and
non-throwing parser. SDK adapters use this subpath instead of redefining local `isRecord`,
`isJsonObject`, or `stringField` helpers.

See the
[code review bot example](https://github.com/trytilde/examples/tree/main/code-review-bot)
for a complete Next.js, ChatKit, MCP, and reverse-proxy integration.

## Materialize a managed skill package

Managed skills may include scripts, references, templates, and assets in
addition to `SKILL.md`. The SDK reads the manifest first and lazily requests a
short-lived R2 URL for each file. `materialize` verifies file sizes and SHA-256
checksums, preserves executable bits, and atomically moves the completed tree
into the requested directory.

```ts
import { createClient } from "@trytilde/sdk";

const tilde = createClient();
const skill = await tilde.skills.registry(registryId).then((registry) =>
  registry.find("popular-web-designs"),
);

await tilde.skills
  .package(skill.id)
  .materialize("/workspace/.agents/skills/popular-web-designs");
```

`materialize` is a Node.js API and is suitable for a scoped Modal computer or
another agent filesystem. Browser callers can use `manifest()` and
`download(path)` directly.
