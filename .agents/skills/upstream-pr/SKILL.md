---
name: upstream-pr
description: Prepare a focused change from an OpenBot fork for contribution to upstream. Use when separating reusable core or provider improvements from fork-specific configuration.
---

# Contribute Upstream

1. Identify the minimal reusable change. Exclude fork-specific `configuration/`, secrets, branding, and deployment state unless upstream explicitly requests them.
2. Before separating the contribution, search for `DO NOT UPSTREAM` markers. Treat every marked range or complete file as a hard exclusion from the upstream branch. Do not remove or rewrite marked fork behavior merely to make the upstream diff clean.
3. Mark fork-only code with balanced, language-valid comments containing these exact tokens and a concrete reason:

   ```text
   # DO NOT UPSTREAM
   #reason: <why this belongs only to the fork>
   <fork-only code>
   #END DO NOT UPSTREAM
   ```

   Use the language's native comment wrapper while preserving the tokens. For example, TypeScript uses `// # DO NOT UPSTREAM`, `// #reason: ...`, and `// #END DO NOT UPSTREAM`. To exclude a complete commentable file, put the opening marker and reason before its first code and the closing marker after its last code. For formats that cannot contain comments, mark the nearest owning source file and name the excluded generated or data file in the reason.

4. Verify marker hygiene with `rg -n 'DO NOT UPSTREAM|#reason:'`: every opening marker has one non-empty reason and one closing marker, nested ranges are forbidden, and no marked line or marked complete file appears in the upstream diff. Stop rather than guessing when a marker's intended range is ambiguous.
5. Put every provider contract interface in `src/core.ts` or `src/core/index.ts` inside the owning provider package; let the package root only re-export it, and put default implementations beside the core boundary. Keep custom implementations viable through `configuration/providers/` plugins.
6. Add focused tests and documentation for the public extension point.
7. Run `pnpm check` and `pnpm build` on the contribution branch.
8. Review the diff for credentials, marked exclusions, and unrelated fork changes before committing.
9. Write the pull request around the problem, contract, compatibility impact, and validation evidence.
