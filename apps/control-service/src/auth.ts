import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type {
  AuthProvider,
  OAuthTokens,
  OwnerAccount,
  OwnerPrincipal,
} from "@tryopenbot/auth-provider";

declare module "hono" {
  interface ContextVariableMap {
    ownerPrincipal: OwnerPrincipal;
    ownerAccessToken: string;
  }
}

const accessCookie = "openbot_access";
const refreshCookie = "openbot_refresh";
const stateCookie = "openbot_oauth_state";
const verifierCookie = "openbot_oauth_verifier";

interface OwnerAuthOptions {
  devMode?: boolean;
  environment?: NodeJS.ProcessEnv;
}

export function registerOwnerAuth(
  app: Hono,
  provider: AuthProvider,
  options: OwnerAuthOptions = {},
): void {
  app.get("/auth/native-config", (context) => {
    const configuration = provider.nativeClientConfiguration();
    context.header("cache-control", "no-store");
    return context.json({
      authorization_endpoint: configuration.authorizationEndpoint,
      token_endpoint: configuration.tokenEndpoint,
      client_id: configuration.clientId,
      scope: configuration.scope,
    });
  });
  app.get("/auth/login", (context) => {
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const redirectUri = callbackUrl(context, options);
    transientCookie(context, stateCookie, state, options);
    transientCookie(context, verifierCookie, verifier, options);
    const url = provider.authorizationUrl({
      redirectUri,
      state,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
    });
    return context.redirect(url.toString());
  });
  app.get("/auth/callback", async (context) => {
    const code = context.req.query("code");
    const state = context.req.query("state");
    const expectedState = getCookie(context, stateCookie);
    const verifier = getCookie(context, verifierCookie);
    if (!code || !state || state !== expectedState || !verifier)
      return context.json({ error: "Invalid OAuth callback" }, 400);
    const tokens = await provider.exchangeCode({
      code,
      codeVerifier: verifier,
      redirectUri: callbackUrl(context, options),
    });
    setTokenCookies(context, tokens, options);
    clearCookie(context, stateCookie);
    clearCookie(context, verifierCookie);
    return context.redirect("/");
  });
  app.get("/auth/session", async (context) => {
    context.header("cache-control", "no-store");
    const session = await authenticate(context, provider, options);
    if (!session) return context.json({ authenticated: false }, 401);
    let account: OwnerAccount = {
      name: session.principal.email || session.principal.subject,
      ...(session.principal.email ? { email: session.principal.email } : {}),
    };
    if (provider.account) {
      try {
        account = await provider.account(session.accessToken, session.principal);
      } catch {
        // Identity verification still establishes a valid session when optional
        // provider profile enrichment is temporarily unavailable.
      }
    }
    return context.json({
      authenticated: true,
      user: {
        subject: session.principal.subject,
        name: account.name,
        ...(account.email ? { email: account.email } : {}),
        ...(account.avatarUrl ? { avatar_url: account.avatarUrl } : {}),
        ...(account.organization ? { organization: account.organization } : {}),
        ...(account.workspace ? { workspace: account.workspace } : {}),
      },
    });
  });
  app.post("/auth/logout", (context) => {
    if (!trustedCookieMutation(context, options))
      return context.json({ error: "Untrusted request origin" }, 403);
    clearCookie(context, accessCookie);
    clearCookie(context, refreshCookie);
    return context.json({ authenticated: false });
  });
}

export function requireOwner(
  provider: AuthProvider,
  options: OwnerAuthOptions = {},
): MiddlewareHandler {
  return async (context, next) => {
    if (!trustedCookieMutation(context, options))
      return context.json({ error: "Untrusted request origin" }, 403);
    const authenticated = await authenticate(context, provider, options);
    if (!authenticated) return context.json({ error: "Authentication required" }, 401);
    context.set("ownerPrincipal", authenticated.principal);
    context.set("ownerAccessToken", authenticated.accessToken);
    await next();
  };
}

function trustedCookieMutation(context: Context, options: OwnerAuthOptions): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(context.req.method)) return true;
  const authorization = context.req.header("authorization");
  if (authorization?.startsWith("Bearer ") && authorization.slice(7).trim()) return true;
  const origin = context.req.header("origin");
  if (!origin) return false;
  try {
    const requestOrigin = new URL(context.req.url).origin;
    const expectedOrigin = options.devMode
      ? (developmentBrowserOrigin(context, options.environment ?? process.env) ?? requestOrigin)
      : requestOrigin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

async function authenticate(
  context: Context,
  provider: AuthProvider,
  options: OwnerAuthOptions,
): Promise<{ principal: OwnerPrincipal; accessToken: string } | undefined> {
  const authorization = context.req.header("authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
  const accessToken = bearer || getCookie(context, accessCookie);
  if (accessToken) {
    try {
      return { principal: await provider.verify(accessToken), accessToken };
    } catch {
      /* refresh browser cookies below */
    }
  }
  if (bearer) return undefined;
  const refreshToken = getCookie(context, refreshCookie);
  if (!refreshToken) return undefined;
  try {
    const tokens = await provider.refresh(refreshToken);
    setTokenCookies(context, tokens, options);
    return {
      principal: await provider.verify(tokens.accessToken),
      accessToken: tokens.accessToken,
    };
  } catch {
    clearCookie(context, accessCookie);
    clearCookie(context, refreshCookie);
    return undefined;
  }
}

function callbackUrl(context: Context, options: OwnerAuthOptions): string {
  const requestOrigin = new URL(context.req.url).origin;
  const environment = options.environment ?? process.env;
  if (options.devMode)
    return `${developmentBrowserOrigin(context, environment) ?? requestOrigin}/auth/callback`;
  const configured = environment.PUBLIC_ORIGIN?.trim()?.replace(/\/$/, "");
  return `${configured || requestOrigin}/auth/callback`;
}

function developmentBrowserOrigin(
  context: Context,
  environment: NodeJS.ProcessEnv,
): string | undefined {
  const forwardedHost = context.req.header("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || context.req.header("host");
  if (!host) return undefined;
  try {
    const forwardedProtocol = context.req.header("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const protocol = forwardedHost ? forwardedProtocol : "http";
    if (protocol !== "http") return undefined;
    const origin = new URL(`${protocol}://${host}`);
    const expectedPort = environment.WEB_PORT?.trim() || "4173";
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (loopback && origin.port === expectedPort) return origin.origin;
  } catch {
    /* Fall back to the control-service request origin. */
  }
  return undefined;
}

function cookieOptions(context: Context, maxAge: number, options: OwnerAuthOptions) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "Lax" as const,
    secure: callbackUrl(context, options).startsWith("https://"),
  };
}

function transientCookie(
  context: Context,
  name: string,
  value: string,
  options: OwnerAuthOptions,
): void {
  setCookie(context, name, value, cookieOptions(context, 600, options));
}

function clearCookie(context: Context, name: string): void {
  deleteCookie(context, name, { path: "/" });
}

function setTokenCookies(context: Context, tokens: OAuthTokens, options: OwnerAuthOptions): void {
  setCookie(
    context,
    accessCookie,
    tokens.accessToken,
    cookieOptions(context, tokens.expiresIn, options),
  );
  if (tokens.refreshToken)
    setCookie(
      context,
      refreshCookie,
      tokens.refreshToken,
      cookieOptions(context, 7 * 24 * 60 * 60, options),
    );
}
