# @tryopenbot/computer-tools

Vercel AI SDK tools for OpenBot's typed computer-service API. Authored agents
may import these tools without depending on a deployment provider package.

## Public API

`ComputerToolOptions` fixes the authored agent ID and optionally supplies lazy Computer service URL and API-key resolvers. The package exports these Vercel AI SDK tool constructors:

- `createBashTool()` and `createAwaitShellTool()` for foreground and background shell work.
- `createReadFileTool()` and `createWriteFileTool()` for UTF-8 files.
- `createCopyToComputerTool()` and `createCopyFromComputerTool()` for binary transfer.
- `createGlobTool()` and `createGrepTool()` for filesystem discovery and search.
- `createScreenshotTool()` for PNG desktop capture.
