# `@tryopenbot/inference-provider`

Initialization and external provisioning for inference services. The default Vercel implementation
creates a labeled AI Gateway key and persists it as `AI_GATEWAY_API_KEY`. Authored agents use AI
SDK's recommended plain `creator/model` string; this package does not expose model factories or
request-time inference APIs.

## Public API

- `InferenceProvider`: initialization-only contract for inference credentials and accounts.
- `VercelInferenceProvider`: creates or reuses a labeled Vercel AI Gateway API key.
- `vercelInferenceProviderInitialization`: initialization questions and persisted secret declaration for the Vercel implementation.
