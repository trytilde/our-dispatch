import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage, shell } from "electron";
import {
  AuthenticatedSessionSchema,
  type AuthenticatedSession,
} from "@tryopenbot/client-runtime/contracts/auth";
import {
  NativeAuthConfigurationSchema,
  type NativeAuthConfiguration,
} from "@tryopenbot/client-runtime/contracts/installation";

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
  #configuration?: Promise<NativeAuthConfiguration>;
  constructor(
    readonly path: string,
    readonly controlOrigin: string,
  ) {}

  /**
   * The control service owns OIDC configuration, so a packaged build carries no deployment
   * specifics and every native desktop client resolves the same public values.
   */
  async #nativeConfiguration(): Promise<NativeAuthConfiguration> {
    this.#configuration ??= (async () => {
      const response = await fetch(new URL("/auth/native-config", this.controlOrigin), {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(`OpenBot authentication is not configured (${response.status})`);
      return NativeAuthConfigurationSchema.parse(await response.json());
    })();
    try {
      return await this.#configuration;
    } catch (error) {
      // A transient control-service failure must not pin the process to a rejected promise.
      this.#configuration = undefined;
      throw error;
    }
  }

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
    const configuration = await this.#nativeConfiguration();
    const url = new URL(configuration.authorization_endpoint);
    url.searchParams.set("client_id", configuration.client_id);
    url.searchParams.set("redirect_uri", "openbot://auth/callback");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", configuration.scope);
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
      const configuration = await this.#nativeConfiguration();
      const tokens = await exchange(configuration, {
        grant_type: "authorization_code",
        code,
        code_verifier: pending.verifier,
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
      const refreshed = await exchange(await this.#nativeConfiguration(), {
        grant_type: "refresh_token",
        refresh_token: this.#tokens.refreshToken,
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

  async status(controlOrigin = this.controlOrigin): Promise<AuthenticatedSession | null> {
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
    return AuthenticatedSessionSchema.parse(await response.json());
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
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("Secure credential storage is unavailable on this system");
  // getSelectedStorageBackend is Linux-only. Keychain and DPAPI have no plaintext fallback, so
  // isEncryptionAvailable already settles the question everywhere else.
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")
    throw new Error("Secure credential storage is unavailable on this system");
}

async function exchange(configuration: NativeAuthConfiguration, fields: Record<string, string>) {
  const response = await fetch(configuration.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, client_id: configuration.client_id }),
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
