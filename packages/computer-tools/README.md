# @tryopenbot/computer-tools

Vercel AI SDK tools for OpenBot's typed computer-service API. Authored agents
may import these tools without depending on a deployment provider package.

## Public API

`ComputerToolOptions` fixes the authored agent ID and optionally supplies lazy Computer service URL and API-key resolvers. The package exports these Vercel AI SDK tool constructors:

- `createBashTool()` and `createAwaitShellTool()` for foreground and background shell work.
- `createReadFileTool()` and `createWriteFileTool()` for UTF-8 files.
- `createCopyToComputerTool()` and `createCopyFromComputerTool()` for binary transfer through
  session-scoped Tilde attachments; binary data is never exposed to the model as base64.
- `createGlobTool()` and `createGrepTool()` for filesystem discovery and search.
- `createScreenshotTool()` for PNG desktop capture through a session-scoped Tilde attachment.
- `createCuaTools()` asynchronously loads the runtime Cua catalog and returns one identically named AI SDK tool per entry. It rejects collisions, uses each runtime JSON Schema directly, preserves structured failure/completion metadata, and uploads image results as Tilde attachments.

`createTildeMediaUploader()`, `createTildeMediaDownloader()`, and
`createTildeAttachmentMessageHandlers()` implement the shared attachment boundary. Browser uploads,
computer-tool output, model input, and owner rendering pass attachment references or signed URLs;
converted-message caches never contain file bytes or expiring signed URLs.
