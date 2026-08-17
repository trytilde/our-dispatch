import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TildePlatform } from "@tryopenbot/platform-integrations";
import { TildeAuthProvider } from "./tilde.js";

const environment = {
  OPENBOT_OIDC_CLIENT_ID: "client-one",
  OPENBOT_OIDC_AUDIENCE: "urn:tilde:openbot:client-one",
  OPENBOT_OIDC_ISSUER: "https://team.api.trytilde.ai/api/v1/team/team-one/identity/oauth",
  OPENBOT_OIDC_SCOPE: "openid openbot:control",
  OPENBOT_OIDC_AUTHORIZATION_ENDPOINT: "https://api.trytilde.ai/api/v1/identity/oauth/authorize",
  OPENBOT_OIDC_TOKEN_ENDPOINT: "https://api.trytilde.ai/api/v1/identity/oauth/token",
  OPENBOT_OIDC_JWKS_URI: "https://api.trytilde.ai/api/v1/identity/.well-known/jwks.json",
};

afterEach(() => vi.useRealTimers());

describe("TildeAuthProvider", () => {
  it("verifies the issuer, audience, authorized party, token type, and scope", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" });
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ keys: [{ ...jwk, kid: "key-one", alg: "RS256" }] }),
    );
    const provider = providerWith({ request, environment });
    const token = jwt(privateKey, {
      sub: "human-one",
      email: "owner@example.com",
      groups: ["team-member"],
      scope: "openid openbot:control",
      iss: environment.OPENBOT_OIDC_ISSUER,
      aud: environment.OPENBOT_OIDC_AUDIENCE,
      azp: environment.OPENBOT_OIDC_CLIENT_ID,
      typ: "tilde:openbot",
      exp: Math.floor(Date.now() / 1000) + 300,
      nbf: Math.floor(Date.now() / 1000) - 1,
    });
    await expect(provider.verify(token)).resolves.toMatchObject({
      subject: "human-one",
      email: "owner@example.com",
    });
    const wrongAudience = jwt(privateKey, {
      sub: "human-one",
      scope: "openbot:control",
      iss: environment.OPENBOT_OIDC_ISSUER,
      aud: "urn:tilde:openbot:other",
      azp: environment.OPENBOT_OIDC_CLIENT_ID,
      typ: "tilde:openbot",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    await expect(provider.verify(wrongAudience)).rejects.toThrow("not valid for this OpenBot");
  });

  it("registers once during init and persists public OIDC metadata", async () => {
    const request = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.headers).toMatchObject({ "x-api-key": "tilde-key" });
      expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}")).toMatchObject({
        name: "My OpenBot",
        redirect_uris: expect.arrayContaining(["openbot://auth/callback"]),
      });
      return Response.json({
        client_id: "client-one",
        audience: "urn:tilde:openbot:client-one",
        issuer: environment.OPENBOT_OIDC_ISSUER,
        scope: environment.OPENBOT_OIDC_SCOPE,
        authorization_endpoint: environment.OPENBOT_OIDC_AUTHORIZATION_ENDPOINT,
        token_endpoint: environment.OPENBOT_OIDC_TOKEN_ENDPOINT,
        jwks_uri: environment.OPENBOT_OIDC_JWKS_URI,
      });
    });
    const setEnvironment = vi.fn(async () => undefined);
    await providerWith({ request, environment: {} }).initialize({
      repositoryRoot: "/repo",
      environment: {
        TILDE_API_KEY: "tilde-key",
        TILDE_ORG_ID: "org-one",
        TILDE_TEAM_ID: "team-one",
        TILDE_BASE_URL: "https://api.trytilde.ai",
        OPENBOT_DEPLOYMENT_NAME: "My OpenBot",
      },
      request,
      setEnvironment,
      setSecret: async () => undefined,
    });
    expect(setEnvironment).toHaveBeenCalledWith(
      "OPENBOT_OIDC_AUDIENCE",
      environment.OPENBOT_OIDC_AUDIENCE,
      expect.any(String),
    );
  });

  it("refreshes cached signing keys once when a new kid appears", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date());
    const first = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const second = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          keys: [{ ...first.publicKey.export({ format: "jwk" }), kid: "key-one" }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          keys: [{ ...second.publicKey.export({ format: "jwk" }), kid: "key-two" }],
        }),
      );
    const provider = providerWith({ request, environment });
    const claims = {
      sub: "human-one",
      scope: "openbot:control",
      iss: environment.OPENBOT_OIDC_ISSUER,
      aud: environment.OPENBOT_OIDC_AUDIENCE,
      azp: environment.OPENBOT_OIDC_CLIENT_ID,
      typ: "tilde:openbot",
      exp: Math.floor(Date.now() / 1000) + 300,
    };

    await expect(provider.verify(jwt(first.privateKey, claims))).resolves.toBeDefined();
    vi.advanceTimersByTime(30_001);
    await expect(provider.verify(jwt(second.privateKey, claims, "key-two"))).resolves.toBeDefined();
    expect(request).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

function providerWith(options: { request: typeof fetch; environment: NodeJS.ProcessEnv }) {
  return new TildeAuthProvider(
    new TildePlatform({ apiKey: "tilde-key", orgId: "org-one", teamId: "team-one" }),
    options,
  );
}

function jwt(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  claims: object,
  kid = "key-one",
) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString(
    "base64url",
  );
  return `${header}.${payload}.${signature}`;
}
