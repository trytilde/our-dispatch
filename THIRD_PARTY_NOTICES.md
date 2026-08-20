# Third-party notices

OpenBot itself is licensed under MIT. Third-party materials retain their own
copyright and license status.

## Beautiful UI

- Source: <https://www.beautifului.dev/>
- Retrieved: 2026-08-17, directly from the site's published component source
  (the payload behind its "Copy code" affordance)
- Upstream description: copy-paste components for AI-native interfaces
- Files: `packages/ui/src/beautiful-ui/upstream/`
- License: MIT, copyright (c) 2026 Shane Levine, published at
  <https://www.beautifului.dev/license>; preserved in
  `packages/ui/src/beautiful-ui/upstream/LICENSE`

An earlier 2026-08-12 retrieval came from the
`TurboKach/ai-native-react-components` mirror while the site returned Vercel
`DEPLOYMENT_DISABLED`; the 2026-08-17 retrieval from the live site supersedes
it. Per-file SHA-256 values at retrieval and the small recorded OpenBot
modifications (analytics removal, import-path rewrites) are documented in
`packages/ui/src/beautiful-ui/PROVENANCE.md`. OpenBot-specific composition is
kept outside the upstream directory.

## shadcn/ui

- Source: <https://ui.shadcn.com/> (distributed via the shadcn registry CLI)
- License: MIT
- Files: `packages/ui/src/components/ui/`
- OpenBot modifications: import paths rewritten to relative form; the
  registry's `accent` utilities remapped to the Beautiful UI `hover`/`ink`
  tokens; `dialog.tsx`, `command.tsx`, and `dropdown-menu.tsx` are
  OpenBot-authored on Radix/cmdk primitives rather than registry copies.

## Vercel AI Elements

- Source: <https://elements.ai-sdk.dev/> (distributed via the `ai-elements`
  CLI, Apache-2.0)
- Files: `packages/ui/src/components/ai-elements/`
- OpenBot modifications: import paths rewritten to relative form; `accent`
  utilities remapped as above; a type cast added for the
  `streamdown`/`@streamdown/*` shiki version skew.

## glimm

- Source: <https://www.npmjs.com/package/glimm>
- License: MIT
- Used by the vendored Beautiful UI `prompt-bar` component; declared as a
  regular npm dependency of `packages/ui`.
