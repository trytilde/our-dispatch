import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { AuthProvider } from "@tryopenbot/auth-provider";
import { createApp } from "./app.js";

afterEach(() => vi.unstubAllEnvs());

describe("owner authentication", () => {
  it("exposes public native OAuth metadata without credentials", async () => {
    const app = createApp({ authProvider: stubProvider(), webRoot: "/missing" });
    const response = await app.request("https://openbot.test/auth/native-config");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      authorization_endpoint: "https://identity.test/authorize",
      token_endpoint: "https://identity.test/token",
      client_id: "client-one",
      scope: "openid offline_access openbot:control",
    });
  });

  it("completes browser PKCE login and establishes host-only token cookies", async () => {
    const provider = stubProvider();
    const app = createApp({ authProvider: provider, webRoot: "/missing" });
    const login = await app.request("https://openbot.test/auth/login");
    expect(login.status).toBe(302);
    const authorizationInput = provider.authorizationUrl.mock.calls[0]?.[0];
    expect(authorizationInput).toMatchObject({
      redirectUri: "https://openbot.test/auth/callback",
    });
    expect(authorizationInput?.state).toBeTruthy();
    expect(authorizationInput?.codeChallenge).toBeTruthy();

    const loginCookies = login.headers.getSetCookie();
    const callbackCookie = loginCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
    const callback = await app.request(
      `https://openbot.test/auth/callback?code=code-one&state=${encodeURIComponent(authorizationInput?.state ?? "")}`,
      { headers: { cookie: callbackCookie } },
    );
    expect(callback.status).toBe(302);
    expect(provider.exchangeCode).toHaveBeenCalledWith({
      code: "code-one",
      codeVerifier: expect.any(String),
      redirectUri: "https://openbot.test/auth/callback",
    });
    const established = callback.headers.getSetCookie();
    expect(established).toEqual(
      expect.arrayContaining([
        expect.stringContaining("openbot_access=fresh-token"),
        expect.stringContaining("openbot_refresh=refresh-one"),
      ]),
    );
    for (const cookie of established) {
      expect(cookie).toContain("Path=/");
      expect(cookie).not.toContain("Domain=");
    }
  });

  it("keeps the development callback on the browser origin", async () => {
    vi.stubEnv("PUBLIC_ORIGIN", "https://our-ob-control.vercel.app");
    const provider = stubProvider();
    const app = createApp({ authProvider: provider, devMode: true, webRoot: "/missing" });

    const login = await app.request("http://127.0.0.1:4100/auth/login", {
      headers: {
        "x-forwarded-host": "localhost:4173",
        "x-forwarded-proto": "http",
      },
    });

    expect(login.status).toBe(302);
    expect(provider.authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: "http://localhost:4173/auth/callback" }),
    );
    for (const cookie of login.headers.getSetCookie()) expect(cookie).not.toContain("Secure");
  });

  it("uses the configured HTTPS origin for a matching remote development host", async () => {
    vi.stubEnv("PUBLIC_ORIGIN", "https://our-openbot.exe.xyz");
    const provider = stubProvider();
    const app = createApp({ authProvider: provider, devMode: true, webRoot: "/missing" });

    const login = await app.request("http://127.0.0.1:4100/auth/login", {
      headers: {
        "x-forwarded-host": "our-openbot.exe.xyz",
        "x-forwarded-proto": "http",
      },
    });

    expect(login.status).toBe(302);
    expect(provider.authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: "https://our-openbot.exe.xyz/auth/callback" }),
    );
    for (const cookie of login.headers.getSetCookie()) expect(cookie).toContain("Secure");
  });

  it("protects control routes and accepts an installation-scoped bearer token", async () => {
    const provider = stubProvider();
    const app = createApp({ authProvider: provider, webRoot: "/missing" });
    expect((await app.request("/api/computer/missing/preview")).status).toBe(401);
    const authorized = await app.request("/api/computer/missing/preview", {
      headers: { authorization: "Bearer valid-token" },
    });
    expect(authorized.status).toBe(503);
    expect(provider.verify).toHaveBeenCalledWith("valid-token");
  });

  it("refreshes an expired browser session and rotates the access cookie", async () => {
    const provider = stubProvider();
    provider.verify.mockImplementation(async (token) => {
      if (token === "expired") throw new Error("expired");
      return { subject: "human-one", groups: [], scope: ["openbot:control"] };
    });
    const app = createApp({ authProvider: provider, webRoot: "/missing" });
    const response = await app.request("/auth/session", {
      headers: { cookie: "openbot_access=expired; openbot_refresh=refresh-one" },
    });
    expect(response.status).toBe(200);
    expect(provider.refresh).toHaveBeenCalledWith("refresh-one");
    expect(response.headers.get("set-cookie")).toContain("openbot_access=fresh-token");
  });

  it("returns account details supplied by the authentication provider", async () => {
    const provider = stubProvider();
    provider.account = vi.fn(async () => ({
      name: "Daniel Blignaut",
      email: "owner@example.com",
      organization: { id: "org-one", name: "Tilde", role: "owner" },
      workspace: { id: "team-one", name: "OpenBot", role: "owner" },
    }));
    const app = createApp({ authProvider: provider, webRoot: "/missing" });
    const response = await app.request("/auth/session", {
      headers: { authorization: "Bearer valid-token" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      user: {
        subject: "human-one",
        name: "Daniel Blignaut",
        email: "owner@example.com",
        organization: { id: "org-one", name: "Tilde", role: "owner" },
        workspace: { id: "team-one", name: "OpenBot", role: "owner" },
      },
    });
    expect(provider.account).toHaveBeenCalledWith(
      "valid-token",
      expect.objectContaining({ subject: "human-one" }),
    );
  });

  it("requires a matching origin for unsafe cookie-authenticated requests", async () => {
    const app = createApp({ authProvider: stubProvider(), webRoot: "/missing" });
    const rejected = await app.request("https://openbot.test/api/computer/missing/preview", {
      method: "POST",
      headers: { cookie: "openbot_access=valid-token" },
    });
    expect(rejected.status).toBe(403);

    const accepted = await app.request("https://openbot.test/api/computer/missing/preview", {
      method: "POST",
      headers: {
        cookie: "openbot_access=valid-token",
        origin: "https://openbot.test",
      },
    });
    expect(accepted.status).toBe(404);

    const bearer = await app.request("https://openbot.test/api/computer/missing/preview", {
      method: "POST",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(bearer.status).toBe(404);
  });

  it("accepts the forwarded local browser origin for development mutations", async () => {
    const app = createApp({
      authProvider: stubProvider(),
      devMode: true,
      environment: { WEB_PORT: "4173" },
      webRoot: "/missing",
    });
    const headers = {
      cookie: "openbot_access=valid-token",
      origin: "http://localhost:4173",
      "x-forwarded-host": "localhost:4173",
      "x-forwarded-proto": "http",
    };

    const accepted = await app.request("http://127.0.0.1:4100/api/computer/missing/preview", {
      method: "POST",
      headers,
    });
    expect(accepted.status).toBe(404);

    const rejected = await app.request("http://127.0.0.1:4100/api/computer/missing/preview", {
      method: "POST",
      headers: { ...headers, origin: "https://evil.test" },
    });
    expect(rejected.status).toBe(403);
  });

  it("accepts the configured matching HTTPS origin for remote development mutations", async () => {
    const app = createApp({
      authProvider: stubProvider(),
      devMode: true,
      environment: { PUBLIC_ORIGIN: "https://our-openbot.exe.xyz" },
      webRoot: "/missing",
    });
    const headers = {
      cookie: "openbot_access=valid-token",
      origin: "https://our-openbot.exe.xyz",
      "x-forwarded-host": "our-openbot.exe.xyz",
      "x-forwarded-proto": "http",
    };

    const accepted = await app.request("http://127.0.0.1:4100/api/computer/missing/preview", {
      method: "POST",
      headers,
    });
    expect(accepted.status).toBe(404);

    const rejected = await app.request("http://127.0.0.1:4100/api/computer/missing/preview", {
      method: "POST",
      headers: { ...headers, origin: "https://evil.test" },
    });
    expect(rejected.status).toBe(403);
  });
});

function stubProvider() {
  return {
    initialization: { id: "test-auth", label: "Test auth", questions: [] },
    deployable: { plan: async () => ({ summary: "test" }), deploy: async () => ({}) },
    nativeClientConfiguration: () => ({
      authorizationEndpoint: "https://identity.test/authorize",
      tokenEndpoint: "https://identity.test/token",
      clientId: "client-one",
      scope: "openid offline_access openbot:control",
    }),
    authorizationUrl: vi.fn(() => new URL("https://identity.test/authorize")),
    exchangeCode: vi.fn(async () => ({
      accessToken: "fresh-token",
      refreshToken: "refresh-one",
      expiresIn: 3600,
    })),
    refresh: vi.fn(async () => ({
      accessToken: "fresh-token",
      refreshToken: "refresh-one",
      expiresIn: 3600,
    })),
    verify: vi.fn(async () => ({ subject: "human-one", groups: [], scope: ["openbot:control"] })),
  } as unknown as AuthProvider & {
    account: ReturnType<typeof vi.fn> | undefined;
    authorizationUrl: ReturnType<typeof vi.fn>;
    exchangeCode: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };
}
