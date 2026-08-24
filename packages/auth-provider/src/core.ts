import type { DeployableProvider } from "@tryopenbot/runtime-provider";

export interface OwnerPrincipal {
  subject: string;
  email?: string;
  groups: readonly string[];
  scope: readonly string[];
}

export interface OwnerAccountContext {
  id: string;
  name: string;
  role?: string;
}

export interface OwnerAccount {
  name: string;
  email?: string;
  avatarUrl?: string;
  organization?: OwnerAccountContext;
  workspace?: OwnerAccountContext;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface NativeAuthConfiguration {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scope: string;
}

export interface AuthProvider extends DeployableProvider {
  nativeClientConfiguration(): NativeAuthConfiguration;
  authorizationUrl(input: { redirectUri: string; state: string; codeChallenge: string }): URL;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  verify(accessToken: string): Promise<OwnerPrincipal>;
  account?(accessToken: string, principal: OwnerPrincipal): Promise<OwnerAccount>;
}

export class AuthProviderError extends Error {
  constructor(
    readonly code: "invalid_configuration" | "invalid_token" | "exchange_failed",
    message: string,
  ) {
    super(message);
    this.name = "AuthProviderError";
  }
}
