# ADR-0002: Unified Changesets versioning

## In brief

- Changesets records release impact. No second release-note system.
- All OpenBot product packages one fixed group. Tilde SDK packages independent.
- Packages publish publicly. GitHub Action currently opens a version PR only.

## Context

OpenBot is a public-package monorepo whose application packages evolve as one product. Independent
version drift inside that product would imply unsupported compatibility boundaries, while direct
version edits would make release intent difficult to review. General `@trytilde/sdk*` packages also
live in the repository, but their external consumers and Tilde API compatibility form a separate
release boundary.

## Decision

Changesets manages release notes and package versions. Every OpenBot product package belongs to one
fixed group and is configured for public npm publication. Tilde SDK packages remain outside that
group and version independently. Contributors add changesets for owner-visible behavior or package
API changes. GitHub Actions may create or update a version pull request; the current workflow does
not publish packages automatically.

```mermaid
flowchart LR
  C["Contributor changeset"] --> A["Changesets Action"]
  A --> V["Unified version pull request"]
  V --> G["Fixed OpenBot versions"]
  V --> S["Independent Tilde SDK versions"]
```

## Consequences

- One release number describes the complete OpenBot product package set.
- Public package artifacts are generated and verified before publication.
- Enabling automatic npm publication remains a separate workflow decision.

## Updates

- 2026-08-13T17:50:21+02:00: Configured every workspace package for public publication and kept automatic publishing outside the current workflow.
- 2026-08-13T18:01:43+02:00: Made native package imports resolve built artifacts while the explicit development condition continues to expose TypeScript sources.
- 2026-08-24T15:45:48+02:00: Kept the imported Tilde SDK packages outside OpenBot's fixed version group because their public API and external consumers form an independent compatibility boundary.
