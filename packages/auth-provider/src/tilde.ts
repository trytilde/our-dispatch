import { createPublicKey, type JsonWebKey, verify as verifySignature } from "node:crypto";
import type {
  DeploymentContext,
  DeploymentPlan,
  InitializableProvider,
  ProviderInitialization,
  ProviderInitializationContext,
} from "@tryopenbot/runtime-provider";
import { persistEnvironment } from "@tryopenbot/runtime-provider";
import { TildePlatform } from "@tryopenbot/platform-integrations";
import {
  AuthProviderError,
  type AuthProvider,
  type OAuthTokens,
  type OwnerPrincipal,
} from "./core.js";

const requiredScope = "openbot:control";
const defaultScope = "openid profile email offline_access openbot:control";

interface OpenBotRegistration {
  client_id: string;
  audience: string;
  issuer: string;
  scope: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface JsonWebKeySet {
  keys: Array<JsonWebKey & { kid?: string; alg?: string }>;
}

export class TildeAuthProvider implements AuthProvider, InitializableProvider {
  readonly platforms: readonly TildePlatform[];
  readonly initialization: ProviderInitialization = {
    id: "tilde-openbot-auth",
    label: "Tilde OpenBot authentication",
    description: "Register this OpenBot installation as a team-owned OIDC client.",
    questions: [],
  };
  readonly deployable = this;
  readonly #platform: TildePlatform;
  readonly #request: typeof fetch;
  readonly #environment: NodeJS.ProcessEnv;
  #jwks?: { expiresAt: number; fetchedAt: number; value: JsonWebKeySet };

  constructor(
    platform: TildePlatform,
    options: { request?: typeof fetch; environment?: NodeJS.ProcessEnv } = {},
  ) {
    this.#platform = platform;
    this.platforms = [platform];
    this.#request = options.request ?? fetch;
    this.#environment = options.environment ?? process.env;
  }

  async initialize(context: ProviderInitializationContext): Promise<void> {
    const registration = await this.#register(
      context.environment,
      context.request ?? this.#request,
    );
    await persistRegistration(registration, (name, value, description) =>
      context.setEnvironment(name, value, description),
    );
  }

  async plan(): Promise<DeploymentPlan> {
    return {
      summary: "Reconcile the team-owned OpenBot OIDC registration",
      steps: ["Register exact browser and desktop callbacks", "Persist public OIDC metadata"],
    };
  }

  async configure(context: DeploymentContext) {
    const registration = await this.#register(context.environment, this.#request, context.devMode);
    for (const [name, value, description] of registrationEnvironment(registration))
      await persistEnvironment(context, name, value, description);
    return {};
  }

  async deploy() {
    return {};
  }

  authorizationUrl(input: { redirectUri: string; state: string; codeChallenge: string }): URL {
    const url = new URL(required(this.#environment, "OPENBOT_OIDC_AUTHORIZATION_ENDPOINT"));
    url.searchParams.set("client_id", required(this.#environment, "OPENBOT_OIDC_CLIENT_ID"));
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.#environment.OPENBOT_OIDC_SCOPE || defaultScope);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url;
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthTokens> {
    return this.#token({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.codeVerifier,
      client_id: required(this.#environment, "OPENBOT_OIDC_CLIENT_ID"),
      redirect_uri: input.redirectUri,
    });
  }

  async refresh(refreshToken: string): Promise<OAuthTokens> {
    const tokens = await this.#token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: required(this.#environment, "OPENBOT_OIDC_CLIENT_ID"),
    });
    return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
  }

  async verify(accessToken: string): Promise<OwnerPrincipal> {
    const [encodedHeader, encodedPayload, encodedSignature, extra] = accessToken.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra)
      throw new AuthProviderError("invalid_token", "Malformed access token");
    const header = decodeJson<{ alg?: string; kid?: string }>(encodedHeader);
    const claims = decodeJson<{
      sub?: string;
      email?: string;
      groups?: string[];
      scope?: string;
      iss?: string;
      aud?: string;
      azp?: string;
      typ?: string;
      exp?: number;
      nbf?: number;
    }>(encodedPayload);
    if (header.alg !== "RS256" || !header.kid)
      throw new AuthProviderError("invalid_token", "Unsupported access token signing key");
    let key = (await this.#getJwks()).keys.find((candidate) => candidate.kid === header.kid);
    key ??= (await this.#getJwks(true)).keys.find((candidate) => candidate.kid === header.kid);
    if (!key) throw new AuthProviderError("invalid_token", "Unsupported access token signing key");
    const valid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      createPublicKey({ key, format: "jwk" }),
      Buffer.from(encodedSignature, "base64url"),
    );
    const now = Math.floor(Date.now() / 1000);
    const clientId = required(this.#environment, "OPENBOT_OIDC_CLIENT_ID");
    const audience = required(this.#environment, "OPENBOT_OIDC_AUDIENCE");
    const issuer = required(this.#environment, "OPENBOT_OIDC_ISSUER");
    const scope = claims.scope?.split(/\s+/).filter(Boolean) ?? [];
    if (
      !valid ||
      !claims.sub ||
      claims.iss !== issuer ||
      claims.aud !== audience ||
      claims.azp !== clientId ||
      claims.typ !== "tilde:openbot" ||
      !claims.exp ||
      claims.exp <= now ||
      (claims.nbf ?? 0) > now ||
      !scope.includes(requiredScope)
    )
      throw new AuthProviderError(
        "invalid_token",
        "Access token is not valid for this OpenBot installation",
      );
    return { subject: claims.sub, email: claims.email, groups: claims.groups ?? [], scope };
  }

  async #register(
    environment: NodeJS.ProcessEnv,
    request: typeof fetch,
    development = false,
  ): Promise<OpenBotRegistration> {
    const connection = platformConnection(this.#platform, environment);
    const port = environment.PORT?.trim() || "4100";
    const webPort = environment.WEB_PORT?.trim() || "4173";
    const publicOrigin = environment.PUBLIC_ORIGIN?.trim()?.replace(/\/$/, "");
    const redirectUris = [
      `http://127.0.0.1:${port}/auth/callback`,
      ...(development
        ? [`http://127.0.0.1:${webPort}/auth/callback`, `http://localhost:${webPort}/auth/callback`]
        : []),
      "openbot://auth/callback",
      ...(publicOrigin ? [`${publicOrigin}/auth/callback`] : []),
    ];
    const response = await request(
      `${connection.baseUrl.replace(/\/$/, "")}/api/v1/team/${encodeURIComponent(connection.teamId)}/identity/openbot/deployments`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": connection.apiKey },
        body: JSON.stringify({
          client_id: environment.OPENBOT_OIDC_CLIENT_ID?.trim() || undefined,
          name: environment.OPENBOT_DEPLOYMENT_NAME?.trim() || "OpenBot",
          redirect_uris: [...new Set(redirectUris)],
          deployment_url: publicOrigin,
          software_version: "0.1.0",
        }),
      },
    );
    if (!response.ok)
      throw new AuthProviderError(
        "exchange_failed",
        `Tilde OpenBot registration failed (${response.status})`,
      );
    return (await response.json()) as OpenBotRegistration;
  }

  async #token(fields: Record<string, string>): Promise<OAuthTokens> {
    const response = await this.#request(
      required(this.#environment, "OPENBOT_OIDC_TOKEN_ENDPOINT"),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
      },
    );
    if (!response.ok)
      throw new AuthProviderError(
        "exchange_failed",
        `OIDC token exchange failed (${response.status})`,
      );
    const body = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!body.access_token || !body.expires_in)
      throw new AuthProviderError("exchange_failed", "OIDC token response is incomplete");
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresIn: body.expires_in,
    };
  }

  async #getJwks(force = false): Promise<JsonWebKeySet> {
    const now = Date.now();
    if (
      this.#jwks &&
      ((!force && this.#jwks.expiresAt > now) || (force && this.#jwks.fetchedAt + 30_000 > now))
    )
      return this.#jwks.value;
    const response = await this.#request(required(this.#environment, "OPENBOT_OIDC_JWKS_URI"));
    if (!response.ok)
      throw new AuthProviderError("invalid_token", "OIDC signing keys are unavailable");
    const value = (await response.json()) as JsonWebKeySet;
    this.#jwks = { value, fetchedAt: now, expiresAt: now + 5 * 60_000 };
    return value;
  }
}

function platformConnection(platform: TildePlatform, environment: NodeJS.ProcessEnv) {
  try {
    return platform.connection();
  } catch {
    return {
      apiKey: required(environment, "TILDE_API_KEY"),
      orgId: required(environment, "TILDE_ORG_ID"),
      teamId: required(environment, "TILDE_TEAM_ID"),
      baseUrl: environment.TILDE_BASE_URL?.trim() || "https://api.trytilde.ai",
    };
  }
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new AuthProviderError("invalid_configuration", `${name} is required`);
  return value;
}

function decodeJson<T>(value: string): T {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    throw new AuthProviderError("invalid_token", "Malformed access token claims");
  }
}

function registrationEnvironment(
  registration: OpenBotRegistration,
): Array<[string, string, string]> {
  return [
    [
      "OPENBOT_OIDC_CLIENT_ID",
      registration.client_id,
      "Tilde OIDC public client ID for this OpenBot installation.",
    ],
    [
      "OPENBOT_OIDC_AUDIENCE",
      registration.audience,
      "Audience accepted by this OpenBot installation.",
    ],
    [
      "OPENBOT_OIDC_ISSUER",
      registration.issuer,
      "Tilde token issuer for this OpenBot installation.",
    ],
    ["OPENBOT_OIDC_SCOPE", registration.scope, "OIDC scopes requested by OpenBot."],
    [
      "OPENBOT_OIDC_AUTHORIZATION_ENDPOINT",
      registration.authorization_endpoint,
      "Tilde OIDC authorization endpoint.",
    ],
    ["OPENBOT_OIDC_TOKEN_ENDPOINT", registration.token_endpoint, "Tilde OIDC token endpoint."],
    ["OPENBOT_OIDC_JWKS_URI", registration.jwks_uri, "Tilde OIDC signing key endpoint."],
  ];
}

async function persistRegistration(
  registration: OpenBotRegistration,
  setEnvironment: ProviderInitializationContext["setEnvironment"],
): Promise<void> {
  for (const [name, value, description] of registrationEnvironment(registration))
    await setEnvironment(name, value, description);
}
