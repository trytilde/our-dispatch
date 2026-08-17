import { describe, expect, it, vi } from "vite-plus/test";
import type { AuthProvider } from "@tryopenbot/auth-provider";
import { createApp } from "./app.js";

describe("owner authentication", () => {
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
});

function stubProvider() {
  return {
    initialization: { id: "test-auth", label: "Test auth", questions: [] },
    deployable: { plan: async () => ({ summary: "test" }), deploy: async () => ({}) },
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
    authorizationUrl: ReturnType<typeof vi.fn>;
    exchangeCode: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };
}
