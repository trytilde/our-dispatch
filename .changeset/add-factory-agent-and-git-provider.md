---
"@tryopenbot/git-provider": minor
"@tryopenbot/agent-provider": minor
"@tryopenbot/agent-service-provider": minor
"openbot": minor
"@tryopenbot/computer-provider": minor
"@tryopenbot/control-service": minor
"@tryopenbot/configuration": minor
"@tryopenbot/runtime-provider": minor
"@tryopenbot/ui": minor
"@tryopenbot/web": minor
---

Replace the Hello World primary agent with the Factory agent and give it an end-to-end build/test/deploy loop. A new `@tryopenbot/git-provider` derives the fork repository from the checkout's origin remote, brokers a GitHub App credential through Tilde, and reconciles GitHub REST and git-over-HTTPS reverse-proxy profiles; the trusted development sandbox attaches its seeded source tree to the owner's fork through that proxy so the factory agent has an authenticated git client without holding a token. The factory agent's computer tools target the development sandbox, its skills cover creating, locally testing (Tilde local-runtime tunnel), and deploying agents, and the primary agent additionally receives the brokered GitHub toolkit on its MCP server. A background orchestrator (`openbot orchestrate`) owns the lifecycle: edits route every agent through the local-runtime tunnel with hot reload, and settled edits are verified, published to the openbot/sandbox-edits branch, and redeployed automatically. Every subagent can edit its own source in the development sandbox, and the web workspace's New Agent entry scaffolds, registers, and opens a chat with the agent itself.
