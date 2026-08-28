---
"@trytilde/sdk-vercel-ai-node": minor
---

Attribute ChatKit speakers and scope MCP connections to a session.

Inbound ChatKit messages now carry a structured `identity` block, so an agent in a
multi-party session can tell participants apart. `convertToAiSdkMessage` prefixes the
first text part of an attributed message with the speaker's label, leaving the agent's
own assistant messages untouched. The label is re-sanitized before it is concatenated
into model-visible text, because a display name is chosen by whoever sent the message.

Request bodies now also carry `session` provenance. Use `sessionProvenanceInstruction`
to add a system-prompt line when a reply is delivered back to the platform the
conversation started on, so an agent answering an email does not write as if it were in
a chat window.

`createMCPClient` accepts a `chatkit: { sessionId, permissions }` option that scopes the
connection to one ChatKit session. Tilde offers session-scoped tools, delegation among
them, only on a scoped connection, and rejects a connection naming a session the caller
may not use rather than silently omitting those tools.
