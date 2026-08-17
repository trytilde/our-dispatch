import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage, shell } from "electron";

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}
interface PendingAuthorization {
  state: string;
  verifier: string;
  resolve(): void;
  reject(error: Error): void;
}

export class DesktopAuth {
  #tokens?: StoredTokens;
  #pending?: PendingAuthorization;
  constructor(readonly path: string) {}

  async load(): Promise<void> {
    ensureSecureStorage();
    try {
      const encrypted = await readFile(this.path);
      this.#tokens = JSON.parse(safeStorage.decryptString(encrypted)) as StoredTokens;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async signIn(): Promise<void> {
    if (this.#pending) throw new Error("A sign-in is already in progress");
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const url = new URL(required("OPENBOT_OIDC_AUTHORIZATION_ENDPOINT"));
    url.searchParams.set("client_id", required("OPENBOT_OIDC_CLIENT_ID"));
    url.searchParams.set("redirect_uri", "openbot://auth/callback");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", required("OPENBOT_OIDC_SCOPE"));
    url.searchParams.set("state", state);
    url.searchParams.set(
      "code_challenge",
      createHash("sha256").update(verifier).digest("base64url"),
    );
    url.searchParams.set("code_challenge_method", "S256");
    const completion = new Promise<void>((resolve, reject) => {
      this.#pending = { state, verifier, resolve, reject };
    });
    await shell.openExternal(url.toString());
    return completion;
  }

  async handleCallback(value: string): Promise<boolean> {
    const url = new URL(value);
    if (url.protocol !== "openbot:" || url.host !== "auth" || url.pathname !== "/callback")
      return false;
    const pending = this.#pending;
    if (!pending) return true;
    try {
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.get("state") !== pending.state)
        throw new Error("Invalid OAuth callback");
      const tokens = await exchange({
        grant_type: "authorization_code",
        code,
        code_verifier: pending.verifier,
        client_id: required("OPENBOT_OIDC_CLIENT_ID"),
        redirect_uri: "openbot://auth/callback",
      });
      if (!tokens.refresh_token) throw new Error("OIDC response did not include a refresh token");
      this.#tokens = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
      await this.#save();
      pending.resolve();
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#pending = undefined;
    }
    return true;
  }

  async accessToken(): Promise<string | undefined> {
    if (!this.#tokens) return undefined;
    const claims = tokenClaims(this.#tokens.accessToken);
    if ((claims.exp ?? 0) > Math.floor(Date.now() / 1000) + 60) return this.#tokens.accessToken;
    try {
      const refreshed = await exchange({
        grant_type: "refresh_token",
        refresh_token: this.#tokens.refreshToken,
        client_id: required("OPENBOT_OIDC_CLIENT_ID"),
      });
      this.#tokens = {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? this.#tokens.refreshToken,
      };
      await this.#save();
      return this.#tokens.accessToken;
    } catch {
      await this.signOut();
      return undefined;
    }
  }

  async status(controlOrigin = process.env.CONTROL_ORIGIN || "http://127.0.0.1:4100") {
    const token = await this.accessToken();
    if (!token) return null;
    const response = await fetch(new URL("/auth/session", controlOrigin), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) {
      await this.signOut();
      return null;
    }
    if (!response.ok) throw new Error(`Authentication check failed (${response.status})`);
    return (await response.json()) as {
      authenticated: true;
      user: { subject: string; email?: string };
    };
  }

  async signOut(): Promise<void> {
    this.#tokens = undefined;
    await rm(this.path, { force: true });
  }

  async #save(): Promise<void> {
    ensureSecureStorage();
    if (!this.#tokens) return;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, safeStorage.encryptString(JSON.stringify(this.#tokens)), {
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}

function ensureSecureStorage(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    safeStorage.getSelectedStorageBackend() === "basic_text"
  )
    throw new Error("Secure credential storage is unavailable on this system");
}

async function exchange(fields: Record<string, string>) {
  const response = await fetch(required("OPENBOT_OIDC_TOKEN_ENDPOINT"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  if (!response.ok) throw new Error(`OIDC token exchange failed (${response.status})`);
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) throw new Error("OIDC token response is incomplete");
  return { access_token: body.access_token, refresh_token: body.refresh_token };
}

function tokenClaims(token: string): { sub?: string; email?: string; exp?: number } {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
