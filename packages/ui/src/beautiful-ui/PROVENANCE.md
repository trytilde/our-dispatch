# Beautiful UI provenance

The files in `upstream/` were retrieved on 2026-08-17 directly from
<https://www.beautifului.dev/> — the component source the site itself serves
for its "Copy code" affordance, extracted from the page's React Server
Component payload. This supersedes the 2026-08-12 retrieval from the
`TurboKach/ai-native-react-components` mirror, which had fallen behind the
live site.

The site's `/license` page publishes the MIT License, Copyright (c) 2026
Shane Levine ("Yes, you can use it for free."). That license text is
preserved in `upstream/LICENSE` and applies to the files in this directory.

Two published components were not vendored: `insight-cards` (depends on
`liveline`) and `selection-actions` (depends on `iconoir-react`). They can be
re-extracted the same way if needed.

## Per-file SHA-256 at retrieval (pristine extraction)

| File | SHA-256 at retrieval |
| --- | --- |
| `approval-card.tsx` | `00abe673f233267265ff804e275b7021b60334a9ec2c6ebb64d2377bb81fa279` |
| `chat-composer.tsx` | `959ac6e35481b1c3afa76b38cbd39fd78c434a81d1928f3aea32351909d941bb` |
| `code-block.tsx` | `c3196c2978c5e66e234b2b7bbe8761b83a437a03e79aeafdcc542b4fa951e3ca` |
| `context-cards.tsx` | `9826e2e361d9480bbf69e571bccfa51db52f0ba81982938f904df4f9f0266f0f` |
| `diff-table.tsx` | `5fbf7e2e065a826b6258fc1a68639e0fc1ac36debf6ae59efbfc41449f08b471` |
| `filter-table.tsx` | `4a48c51cd6e5c0aa3bab91aab9975005518fd82dd294d059e402c2bb4ce681f4` |
| `fine-tune-card.tsx` | `53ed05c782005011191f072c471a977da51f44308d2f17157e355258971b77da` |
| `flowchart.tsx` | `214c0f2c3779185a3cbe730364ffc7f01a0fd567af9c544f19d2a3f86213e366` |
| `loading-state.tsx` | `bc1e57f528c47e2e57e693a3d95546e95951b87d379ab747b04b7b33a37a287d` |
| `prompt-bar.tsx` | `7c20020cd215874d9bc85360105d2c01c27554651db213d9c7395e9a696c471c` |
| `recommendation-card.tsx` | `193dade28faa49fb11a623e98b279d376bf91e0734a95667875adb0bfb57e1b8` |
| `records-table.tsx` | `78c626519250722d6305324ca357ba76ef4aeba04e4ba5a62d6656aef804e41a` |
| `search-list.tsx` | `82da064543ae874408a74a8da874f98867d81348affbcd30fdd011a1f5f2ddea` |
| `sidebar-nav.tsx` | `391633a5d5ef5dfe3de6f10e2ec3b77d66bcbe5309da364b7f17d4780687072b` |
| `streaming-text.tsx` | `468607dbe390a64d42450ceb7515b682c16e2babccddd7dc80ab48e64855c16f` |
| `task-rows.tsx` | `e9cfcccaa6312de7b83f1e68a1e5360b75a2fa0bf2d19228f63f5bc5e9e9aac4` |
| `thinking-state.tsx` | `8806141f0d94f461ba2086b4e0780dafa08577fb5b055a6b25560fabe52f8449` |
| `tool-chips.tsx` | `d29bded620d8a895dd00a23af461f7b99a0951ae201202c7ab0e7428bcf02415` |

## OpenBot modifications to upstream files

Recorded so drift from the pristine hashes above stays explainable:

- `chat-composer.tsx`: removed the `posthog-js` import and its single
  `posthog.capture(...)` call (site analytics, not wanted in a library).
- `diff-table.tsx`, `recommendation-card.tsx`: import path
  `@/components/atoms/Button` rewritten to `../atoms/button.js`.
- `search-list.tsx`, `fine-tune-card.tsx`, `records-table.tsx`: import path
  `@/components/primitives/GlideMenu` rewritten to `../atoms/glide-menu.js`.
- `globals.css`: reconstructed rather than copied — the site does not publish
  its stylesheet as source. Token values (light/dark palettes, shadows,
  radii, easings) were transcribed from the site's compiled CSS
  (`/_next/static/css/0ca7d0ef37780a19.css`, deployment
  `dpl_EvYgKtyJ2e2ts6oZTyG8qZ7yCZAJ`) into the same Tailwind v4
  `@theme inline` structure the previous vendoring used.

The site does not ship source for its atom primitives (`Button`, `Shimmer`,
`StreamText`, `GlideMenu`). The files in `../atoms/` are OpenBot-authored
reconstructions written against the API surface the upstream components use;
they are not upstream source and carry no upstream hashes.

`prompt-bar.tsx` depends on the MIT-licensed `glimm` npm package, declared in
`packages/ui/package.json`.

OpenBot-specific composition and state wiring belong outside `upstream/` so
source changes stay obvious.
