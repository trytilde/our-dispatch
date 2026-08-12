# Custom providers

Add fork-owned provider plugins at `configuration/providers/<id>/index.ts`. Export a plugin
created with `defineProviderPlugin` from `@openbot/provider-sdk`, then select
its registered provider ID in `openbot.config.ts`.

Provider modules are trusted application code. Keep credentials in the
configured environment provider and retrieve them by name from the factory
context; never commit values here.
