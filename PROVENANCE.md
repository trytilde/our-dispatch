# Provenance

One index of everything in this repository that OpenBot did not write: where it
came from, who owns changes to it, and where its verification data lives.

OpenBot's own source is MIT licensed. Nothing below changes that; the entries are
about material with a different origin living inside the tree.

## Companion files

This file is the map. Three other places hold the detail, and none of them
duplicate each other:

| File | Holds |
| --- | --- |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | License status, copyright, and the recorded OpenBot modifications per upstream project |
| [`packages/ui/src/beautiful-ui/PROVENANCE.md`](packages/ui/src/beautiful-ui/PROVENANCE.md) | Per-file SHA-256 at retrieval for the vendored web component tree |
| [`apps/mobile/src/components/ui/PROVENANCE.md`](apps/mobile/src/components/ui/PROVENANCE.md) | Per-file SHA-256 in repo for the vendored React Native component tree |
| [`skills-lock.json`](skills-lock.json) | Source repository, ref, path, and content hash per vendored coding-agent skill |

The rules these files exist to enforce are recorded as decisions in
[`docs/adrs/0022-vendored-web-component-sources.md`](docs/adrs/0022-vendored-web-component-sources.md)
(vendor by copy, keep the upstream tree pristine, record every drift) and
[`docs/adrs/0021-openbot-owned-ui-naming-and-copy.md`](docs/adrs/0021-openbot-owned-ui-naming-and-copy.md)
(OpenBot-authored surfaces carry OpenBot's own identifiers and copy).

## Vendored source

Distributed as source rather than as a package, so it is copied into the tree and
maintained here. Each row is upstream material, not OpenBot's own work.

| Path | Upstream | License | Verification |
| --- | --- | --- | --- |
| `packages/ui/src/beautiful-ui/upstream/` | Beautiful UI, retrieved 2026-08-17 from the publisher's live component source | MIT, preserved in `upstream/LICENSE` | Per-file SHA-256 in the tree's `PROVENANCE.md` |
| `packages/ui/src/components/ui/` | shadcn/ui, via the shadcn registry CLI | MIT | Registry config pinned in `packages/ui/components.json` |
| `packages/ui/src/components/ai-elements/` | Vercel AI Elements, via the `ai-elements` CLI | Apache-2.0 | Modifications recorded in the notices file |
| `apps/mobile/src/components/ui/` | BNA UI, retrieved 2026-08-17 with `bna-ui` CLI 3.0.0 | MIT | Per-file SHA-256 in the tree's `PROVENANCE.md` |
| `.agents/skills/` (47 of 66) | Public GitHub skill repositories | Per upstream repository | Source, ref, path, and content hash per skill in `skills-lock.json` |
| `packages/agent-provider/src/tilde/assets/cua-driver/` | Cua GUI Automation skill, `trycua/cua` commit `70db98d1bcd92890d778f4978e0eb107a4b66c1b` | MIT | `SKILL.md.hbs` SHA-256 `18d28e0a1ca4fda81c5fe8129b45352e031bd19068e8b648a5791380d20823f1`; command reference SHA-256 `8c5d0052b3ab86af9ad74cab6d1871e7c75a4883ec832236fa9ddf54870e1969` |

`glimm` is upstream code too, but it arrives as an ordinary npm dependency of
`packages/ui` rather than as vendored source, so it needs no entry here beyond
its notices record.

## OpenBot-authored, sitting next to vendored source

These directories are easy to mistake for upstream material because of where they
live. They are OpenBot's own work, and OpenBot owns their naming, copy, and
license status:

- `packages/ui/src/beautiful-ui/atoms/` — reconstructions of primitives the
  publisher never released as source. Written by OpenBot against the published
  visual result, not copied. They are not covered by the `upstream/` hashes and
  carry no borrowed provenance.
- `packages/ui/src/beautiful-ui/blocks/` — OpenBot-authored composition built on
  the vendored primitives.
- The 19 skills under `.agents/skills/` with no entry in `skills-lock.json`.
  Absence from the lockfile is the test: anything listed there is vendored with a
  recorded hash, anything else is OpenBot's own.

The workspace UI was built with a third-party product as its visual target. The
implementation is the vendored libraries above plus OpenBot's own code; no source
was taken from that product, and per ADR-0021 no identifier or user-visible
string is carried from it either. Refer to it as the reference build.

## Generated, not vendored

Machine-generated from a source of truth in this repository. Never hand-edited,
and outside formatter and linter ownership:

| Path | Generated from | Command |
| --- | --- | --- |
| `packages/computer-service-proto/src/gen/` | `proto/openbot/computer/v1/computer.proto` | `pnpm contracts:generate` |
| `apps/web/src/routeTree.gen.ts` | the TanStack route files | the Vite dev/build pipeline |
| `apps/mobile/android/`, `apps/mobile/ios/` | `app.json` and config plugins | Expo prebuild; gitignored build output |

## Working with any of this

**Never edit a vendored tree silently.** The hashes are the evidence that the
license terms were honored, so an unrecorded edit destroys the audit trail. Put
OpenBot composition outside the vendored directory instead. When a change to
upstream source is genuinely necessary, record it in that tree's `PROVENANCE.md`
and in the notices file in the same commit.

**Refreshing means re-retrieving.** There is no automatic update path by design.
Re-retrieve from the publisher's current source, update the recorded hashes, and
review the diff — that is the cost accepted in ADR-0022 in exchange for
auditability and builds that do not depend on a registry being reachable.

```bash
# React Native components, from apps/mobile
pnpm dlx bna-ui add <name> --overwrite
```

**Adding a new upstream source** means four things in one commit: the files, a
notices entry with license and copyright, per-file hashes wherever the tree is
meant to stay pristine, and a row in the table above.
