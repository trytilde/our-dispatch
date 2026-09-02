# `@tryopenbot/inference-provider`

Initialization, credential readiness, and default-agent template contributions for inference
services. Authored agents receive provider-specific source at initialization and import vendor SDKs
directly; this package does not expose request-time model factories.

## Public API

- `InferenceProvider`: account lifecycle plus provider-owned files for the default agent template.
- `VercelInferenceProvider`: creates or reuses a labeled Vercel AI Gateway API key and enables
  hosted-inference billing only for Tilde-managed project OIDC. Direct owner keys remain unmetered.
- `CodexInferenceProvider`: for local or Vercel OpenBot runtimes, uses ChatGPT device-code authentication,
  keeps the opaque Codex auth cache encrypted with SOPS, and checks or refreshes it before
  development and deployment builds. Vercel builds receive the Linux x64 Codex executable and
  opt into Vercel Large Functions.
- `vercelInferenceProviderInitialization`: initialization questions and persisted secret declaration for the Vercel implementation.
- `HOSTED_INFERENCE_BILLING`: stable environment key written by inference initialization so the
  authored runtime can distinguish managed project OIDC from direct-key and subscription calls.

Both provider templates accept an optional per-call model ID without owning request-time model
selection. The Codex contribution uses `ai-sdk-provider-codex-cli` app-server mode and explicitly
disables hosted-inference billing for subscription-backed calls. OpenBot's AI SDK tools keep
their ordinary authored shape; the contribution exposes them to Codex through the package's local
MCP helper. Codex's strict structured-output and unsupported sampling controls still follow the
provider's documented limitations.
