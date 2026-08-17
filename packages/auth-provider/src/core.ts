import type { DeployableProvider } from "@tryopenbot/runtime-provider";

export interface OwnerPrincipal {
  subject: string;
  email?: string;
  groups: readonly string[];
  scope: readonly string[];
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface AuthProvider extends DeployableProvider {
  authorizationUrl(input: { redirectUri: string; state: string; codeChallenge: string }): URL;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  verify(accessToken: string): Promise<OwnerPrincipal>;
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
