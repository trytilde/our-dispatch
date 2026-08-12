# Provider plugins

Forks can replace provider behavior without editing application imports. Create `configuration/providers/<plugin-id>/index.ts` and default-export `defineProviderPlugin(...)`. Register one or more typed factories with the builder, then select their IDs in `openbot.config.ts`.

Factories receive non-secret configuration options and an asynchronous `getSecret(name)` function. Implement the relevant interface from `@openbot/provider-sdk`, including `descriptor` and `health()`. Custom plugins may not shadow built-in IDs.

Core provider interfaces cover AI, agents, chat, skills, sandbox, environment, prompts, tools, memory, workspace storage, source control, and deployment. Reusable implementations belong upstream in `packages/providers`; fork-specific implementations stay here.
