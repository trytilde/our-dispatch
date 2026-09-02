---
name: add-sdk-wrapper
description: Expose a Tilde OpenAPI operation through a stable hand-authored TypeScript SDK wrapper.
---

# Add SDK Wrapper

## Process

1. Confirm the operation exists in `packages/tilde-api-client/specs/openapi.cloud.json`.
2. Add validation in `scripts/validate-tilde-openapi-surface.ts` if the operation becomes part of the supported SDK surface.
3. Add or update a wrapper in `packages/tilde-sdk/src`.
4. Map snake_case API fields to stable camelCase TypeScript inputs and outputs.
5. Keep generated OpenAPI types internal.
6. Reject internal metadata protocols. If the wrapper would parse metadata for
   Tilde-owned identity, audience, routing, lifecycle, retries, relationships,
   models, budgets, runs, jobs, compaction, or memory, add a typed upstream
   OpenAPI field instead.
7. Add Vitest coverage for path, method, query, body, auth headers, success mapping, and error behavior.
8. Update `README.md` if the wrapper is user-facing.

## Checklist

- [ ] Public API has no redundant `Tilde` prefix.
- [ ] Wrapper accepts a DTO object, not a long parameter list.
- [ ] Non-2xx responses throw `ApiError`.
- [ ] Tests use public SDK interfaces.
- [ ] Metadata is provider-specific or client-opaque; no internal domain field
      is decoded from a JSON metadata bag.
- [ ] `pnpm check` passes.
