# Auth provider

Owner authentication for OpenBot control surfaces. Tilde is the default OIDC authority; each
installation has its own audience and public PKCE client registration.

## Public API

- `AuthProvider` defines authorization URL creation, PKCE code exchange, refresh, access-token verification, and the public native-client configuration the control service exposes for an installation.
- `NativeAuthConfiguration` contains only the authorization endpoint, token endpoint, public client ID, and requested scope. It never contains tokens, client secrets, or Tilde service credentials.
- `OwnerPrincipal` is the verified installation caller, with independent `actorType`
  (`human` or `agent`), `credentialType` (`api_key` or `bearer_token`), groups, and scopes.
- `OAuthTokens` carries the access token, optional refresh token, and expiry returned by an authorization server.
- `AuthProviderError` classifies invalid configuration, invalid tokens, and failed exchanges at the provider boundary.
- `TildeAuthProvider` reconciles the installation's Tilde OIDC registration, registers the installation-specific public client, validates audience-restricted owner access tokens and team-linked human or agent API keys, and implements the `AuthProvider` contract. Development reconciliation includes the local Vite callback origins without replacing the deployed callback.
