import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const electron = vi.hoisted(() => ({
  getSelectedStorageBackend: vi.fn(() => "gnome_libsecret"),
  openExternal: vi.fn(async (_url: string) => undefined),
}));

vi.mock("electron", () => ({
  safeStorage: {
    decryptString: (value: Buffer) => value.toString("utf8"),
    encryptString: (value: string) => Buffer.from(value),
    getSelectedStorageBackend: electron.getSelectedStorageBackend,
    isEncryptionAvailable: () => true,
  },
  shell: { openExternal: electron.openExternal },
}));

import { DesktopAuth } from "./auth.js";

const controlOrigin = "http://127.0.0.1:4100";
const nativeConfiguration = {
  authorization_endpoint: "https://identity.test/oauth/authorize",
  token_endpoint: "https://identity.test/oauth/token",
  client_id: "client-one",
  scope: "openid profile",
};

/** Answer /auth/native-config, and delegate everything else to the test's own handler. */
function withNativeConfiguration(handler: typeof fetch): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    if (String(input instanceof Request ? input.url : input).endsWith("/auth/native-config"))
      return Response.json(nativeConfiguration);
    return handler(input as RequestInfo, init);
  }) as typeof fetch;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  electron.openExternal.mockClear();
  electron.getSelectedStorageBackend.mockClear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("DesktopAuth", () => {
  it("asks the control service to verify stored credentials", async () => {
    const path = await storedCredentials();
    const request = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Bearer /);
      return Response.json({
        authenticated: true,
        user: { subject: "user-1", email: "owner@example.com" },
      });
    });
    vi.stubGlobal("fetch", request);
    const auth = new DesktopAuth(path, controlOrigin);
    await auth.load();

    await expect(auth.status("https://openbot.example")).resolves.toEqual({
      authenticated: true,
      user: { subject: "user-1", email: "owner@example.com" },
    });
    expect(request).toHaveBeenCalledWith(
      new URL("https://openbot.example/auth/session"),
      expect.any(Object),
    );
  });

  it("removes stored credentials rejected by the control service", async () => {
    const path = await storedCredentials();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    const auth = new DesktopAuth(path, controlOrigin);
    await auth.load();

    await expect(auth.status("https://openbot.example")).resolves.toBeNull();
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refreshes an expiring access token and persists refresh-token rotation", async () => {
    const path = await storedCredentials(-1);
    const nextAccessToken = tokenWithExpiry(3600);
    vi.stubGlobal(
      "fetch",
      withNativeConfiguration(async (input: URL | RequestInfo, init?: RequestInit) => {
        expect(requestUrl(input)).toBe("https://identity.test/oauth/token");
        expect(init?.body).toBeInstanceOf(URLSearchParams);
        const body = init?.body as URLSearchParams;
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("refresh");
        expect(body.get("client_id")).toBe("client-one");
        return Response.json({
          access_token: nextAccessToken,
          refresh_token: "refresh-rotated",
          expires_in: 3600,
        });
      }),
    );
    const auth = new DesktopAuth(path, controlOrigin);
    await auth.load();

    await expect(auth.accessToken()).resolves.toBe(nextAccessToken);
    await expect(readFile(path, "utf8")).resolves.toContain("refresh-rotated");
  });

  it("discovers OIDC configuration from the control service, not the environment", async () => {
    const path = await storedCredentials();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        expect(requestUrl(input)).toBe(`${controlOrigin}/auth/native-config`);
        return Response.json(nativeConfiguration);
      }),
    );
    const auth = new DesktopAuth(path, controlOrigin);
    void auth.signIn().catch(() => undefined);

    await vi.waitFor(() => expect(electron.openExternal).toHaveBeenCalled());
    const opened = new URL(electron.openExternal.mock.calls[0]![0]);
    expect(`${opened.origin}${opened.pathname}`).toBe(nativeConfiguration.authorization_endpoint);
    expect(opened.searchParams.get("client_id")).toBe("client-one");
    expect(opened.searchParams.get("scope")).toBe("openid profile");
    expect(opened.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("keeps the Linux-only storage backend check off other platforms", async () => {
    const path = await storedCredentials();
    const platform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    // Electron only defines getSelectedStorageBackend on Linux; calling it elsewhere throws.
    electron.getSelectedStorageBackend.mockImplementation(() => {
      throw new TypeError("electron.safeStorage.getSelectedStorageBackend is not a function");
    });
    try {
      await new DesktopAuth(path, controlOrigin).load();
      expect(electron.getSelectedStorageBackend).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", { value: platform, configurable: true });
      electron.getSelectedStorageBackend.mockImplementation(() => "gnome_libsecret");
    }
  });
});

function requestUrl(input: URL | RequestInfo): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

async function storedCredentials(expiresIn = 3600): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-desktop-auth-"));
  cleanups.push(async () => rm(root, { recursive: true, force: true }));
  const path = join(root, "auth.enc");
  await writeFile(
    path,
    JSON.stringify({ accessToken: tokenWithExpiry(expiresIn), refreshToken: "refresh" }),
  );
  return path;
}

function tokenWithExpiry(expiresIn: number): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + expiresIn }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}
