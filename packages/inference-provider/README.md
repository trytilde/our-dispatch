# `@tryopenbot/inference-provider`

Initialization, credential readiness, and default-agent template contributions for inference
services. Authored agents receive provider-specific source at initialization and import vendor SDKs
directly; this package does not expose request-time model factories.

## Public API

- `InferenceProvider`: account lifecycle plus provider-owned files for the default agent template.
- `VercelInferenceProvider`: creates or reuses a labeled Vercel AI Gateway API key.
- `CodexInferenceProvider`: for local or Vercel OpenBot runtimes, uses ChatGPT device-code authentication,
  keeps the opaque Codex auth cache encrypted with SOPS, and checks or refreshes it before
  development and deployment builds. Vercel builds receive the Linux x64 Codex executable and
  opt into Vercel Large Functions.
- `vercelInferenceProviderInitialization`: initialization questions and persisted secret declaration for the Vercel implementation.

The Codex contribution uses `ai-sdk-provider-codex-cli` app-server mode. OpenBot's AI SDK tools keep
their ordinary authored shape; the contribution exposes them to Codex through the package's local
MCP helper. Codex's strict structured-output and unsupported sampling controls still follow the
provider's documented limitations.
