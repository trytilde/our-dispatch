---
name: tilde
description: Build and operate TypeScript AI agents with Tilde tools, MCP servers, ChatKit, memory, skills, secure browser sessions, Dev Tunnels, and organisation controls. Use when connecting an agent to Tilde or configuring Tilde resources.
license: MIT
compatibility: Requires an MCP-compatible agent or Node.js 20 or later for the Tilde TypeScript SDK and CLI.
metadata:
  author: Tilde
  version: "1.0"
---

# Use Tilde

Tilde is a TypeScript-first platform for building and operating AI agents. It provides secure tools and MCP servers, ChatKit, memory, skills, browser sessions, organisation controls, and portable state.

## Start here

1. Read the canonical agent context at https://trytilde.ai/llms.txt.
2. Follow the Quickstart at https://trytilde.ai/docs/quickstart.
3. Use the global Tilde MCP server at https://api.trytilde.ai/mcp for configuration tasks.
4. Read the OpenAPI description at https://api.trytilde.ai/openapi.json when implementing direct API integrations.

## Choose the right surface

- Use the global MCP server to inspect the current identity and workspace, discover provider and tool schemas, configure resources, and export portable state.
- Use a runtime MCP server created in Tilde when an agent needs selected tools during normal work.
- Use the TypeScript Harness SDK when implementing ChatKit endpoints, custom tools, memory access, or application-side integrations.
- Use the Tilde CLI for authentication, Dev Tunnels, and state import or export.

## Safe operating rules

- Call `tilde_whoami` before performing workspace-scoped configuration and use the returned `team_id`.
- Discover provider, credential source, and tool identifiers from Tilde. Never guess identifiers.
- Keep API keys, webhook signing keys, OAuth credentials, claim tokens, and PINs out of source code, logs, chat history, and generated state.
- OpenBot does not use a Tilde state file during normal operation. Reconcile Tilde resources through typed, idempotent provider lifecycles. For one-time setup or team migration, the operator may manually export and import state with the Tilde CLI.
- Keep webhook verification and server-side credentials in ChatKit endpoints.
- Ask before changing or deleting existing resources when the requested scope is ambiguous.

## Reference

- Documentation: https://trytilde.ai/docs
- Agent context: https://trytilde.ai/llms.txt
- Full documentation context: https://trytilde.ai/llms-full.txt
- Tools: https://trytilde.ai/docs/tools
- ChatKit: https://trytilde.ai/docs/chatkit
- Memory: https://trytilde.ai/docs/memory
- Skills: https://trytilde.ai/docs/skills
- Dev Tunnels: https://trytilde.ai/docs/dev-tunnels
- Portable state: https://trytilde.ai/docs/terraform
- API description: https://api.trytilde.ai/openapi.json
