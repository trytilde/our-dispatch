# ADR-0009: Service names and one computer API

## In brief

- Name application packages after the service they own.
- `apps/control-service` owns the owner-facing Hono HTTP service.
- `apps/computer-service` is the only API running inside an OpenBot Computer.
- Keep ConnectRPC for the generated, API-key-protected Computer contract.
- Remove the legacy `box-host` package and `BoxService` protocol.
- Keep Vercel-specific control adapters in `control-service-provider`, not the portable application or repository root.

## Context

The repository carried both a legacy `apps/box-host` RPC from `packages/contracts`
and the newer `apps/computer-service` backed by `computer-service-proto`. They
overlapped on process, file, screenshot, input, and port operations. The newer
service also owns lifecycle bundles and the capability-routed VNC tunnel, so renaming both would
leave two competing computer APIs.

The owner-facing application was also named `apps/server`, which described its
transport rather than its domain, and contained a Vercel-only fetch wrapper.

## Decision

Rename `apps/server` and `@tryopenbot/server` to `apps/control-service` and
`@tryopenbot/control-service`. Keep its Hono app and local Node entrypoint portable.
The Vercel control provider owns the Web fetch adapter as a typed asset and
bundles it as part of its prebuilt artifact lifecycle.

Keep `apps/computer-service` and `computer-service-proto` as the single computer
RPC boundary. Delete `apps/box-host`, `BoxService`, and `BoxHealth*` rather than
renaming them into a collision. Existing shared legacy messages remain until
their remaining consumers migrate. The shared computer image compiles this
service in a multi-stage container build; providers never copy a host-built
`dist` file into the image. Remove the obsolete legacy contracts package after
the remaining consumers use `computer-service-proto`.

This ConnectRPC boundary is intentionally independent from the owner-facing control transport. Computer service implements execution, files, lifecycle bundles, screenshots, input, desktop allocation, and bidirectional VNC tunnelling; it is not a proxy over an existing REST API. Its generated contract remains shared by Computer providers and authored-agent Computer tools. Replacing it with handwritten REST would move rather than remove its schema, binary, streaming, cancellation, and error semantics.

Computer-service also owns the idempotent per-agent desktop registry. It routes
screenshot, input, and VNC streams by agent ID to separate displays inside the
same Computer; the agent ID does not create a security boundary.

```mermaid
flowchart LR
  U["Web and desktop"] --> C["control-service"]
  C --> P["computer providers"]
  P --> S["computer-service"]
  V["Vercel control provider"] -->|"bundles adapter asset"| C
```

## Consequences

- Package names identify domain ownership instead of generic hosting roles.
- There is one API-key-protected computer API and one generated computer contract.
- Control-service source and the repository root contain no platform-specific Vercel entrypoint.
- Removing the private legacy RPC is intentionally breaking for untracked consumers.

## Updates

- 2026-08-13T11:12:53+02:00: Required the shared computer image to compile the sole computer service in a multi-stage container build instead of copying a host-built bundle.
- 2026-08-13T12:09:51+02:00: Removed the obsolete legacy contracts package after `computer-service-proto` became the only computer RPC contract.
- 2026-08-13T17:33:29+02:00: Renamed the private workspace package scope from `@openbot` to `@tryopenbot` while retaining the `openbot` CLI command.
- 2026-08-15T13:25:19+02:00: Made computer-service the owner of per-agent display reconciliation and capability-routed VNC streams inside the one shared Computer.
- 2026-08-16T15:08:39+02:00: Retained ConnectRPC exclusively for the internal Computer API while removing owner-facing ConnectRPC from control-service. Frontend code never calls Computer service directly.
