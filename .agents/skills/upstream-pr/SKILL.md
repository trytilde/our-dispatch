---
name: upstream-pr
description: Prepare a focused change from an OpenBot fork for contribution to upstream. Use when separating reusable core or provider improvements from fork-specific configuration.
---

# Contribute Upstream

1. Identify the minimal reusable change. Exclude fork-specific `configuration/`, secrets, branding, and deployment state unless upstream explicitly requests them.
2. Put new integration contracts in `packages/provider-sdk`; put default implementations in `packages/providers`. Keep custom implementations viable through `configuration/providers/` plugins.
3. Add focused tests and documentation for the public extension point.
4. Run `pnpm check` and `pnpm build` on the contribution branch.
5. Review the diff for credentials and unrelated fork changes before committing.
6. Write the pull request around the problem, contract, compatibility impact, and validation evidence.
