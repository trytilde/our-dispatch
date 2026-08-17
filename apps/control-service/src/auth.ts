import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthProvider, OAuthTokens, OwnerPrincipal } from "@tryopenbot/auth-provider";

const accessCookie = "openbot_access";
const refreshCookie = "openbot_refresh";
const stateCookie = "openbot_oauth_state";
const verifierCookie = "openbot_oauth_verifier";

export function registerOwnerAuth(app: Hono, provider: AuthProvider): void {
  app.get("/auth/login", (context) => {
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const redirectUri = callbackUrl(context);
    transientCookie(context, stateCookie, state);
    transientCookie(context, verifierCookie, verifier);
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
      redirectUri: callbackUrl(context),
    });
    setTokenCookies(context, tokens);
    clearCookie(context, stateCookie);
    clearCookie(context, verifierCookie);
    return context.redirect("/");
  });
  app.get("/auth/session", async (context) => {
    const session = await authenticate(context, provider);
    return session
      ? context.json({ authenticated: true, user: session })
      : context.json({ authenticated: false }, 401);
  });
  app.post("/auth/logout", (context) => {
    if (!trustedCookieMutation(context))
      return context.json({ error: "Untrusted request origin" }, 403);
    clearCookie(context, accessCookie);
    clearCookie(context, refreshCookie);
    return context.json({ authenticated: false });
  });
}

export function requireOwner(provider: AuthProvider): MiddlewareHandler {
  return async (context, next) => {
    if (!trustedCookieMutation(context))
      return context.json({ error: "Untrusted request origin" }, 403);
    const principal = await authenticate(context, provider);
    if (!principal) return context.json({ error: "Authentication required" }, 401);
    context.set("ownerPrincipal", principal);
    await next();
  };
}

function trustedCookieMutation(context: Context): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(context.req.method)) return true;
  const authorization = context.req.header("authorization");
  if (authorization?.startsWith("Bearer ") && authorization.slice(7).trim()) return true;
  const origin = context.req.header("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(context.req.url).origin;
  } catch {
    return false;
  }
}

async function authenticate(
  context: Context,
  provider: AuthProvider,
): Promise<OwnerPrincipal | undefined> {
  const authorization = context.req.header("authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
  const accessToken = bearer || getCookie(context, accessCookie);
  if (accessToken) {
    try {
      return await provider.verify(accessToken);
    } catch {
      /* refresh browser cookies below */
    }
  }
  if (bearer) return undefined;
  const refreshToken = getCookie(context, refreshCookie);
  if (!refreshToken) return undefined;
  try {
    const tokens = await provider.refresh(refreshToken);
    setTokenCookies(context, tokens);
    return await provider.verify(tokens.accessToken);
  } catch {
    clearCookie(context, accessCookie);
    clearCookie(context, refreshCookie);
    return undefined;
  }
}

function callbackUrl(context: Context): string {
  const configured = process.env.PUBLIC_ORIGIN?.trim()?.replace(/\/$/, "");
  return `${configured || new URL(context.req.url).origin}/auth/callback`;
}

function cookieOptions(context: Context, maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "Lax" as const,
    secure: callbackUrl(context).startsWith("https://"),
  };
}

function transientCookie(context: Context, name: string, value: string): void {
  setCookie(context, name, value, cookieOptions(context, 600));
}

function clearCookie(context: Context, name: string): void {
  deleteCookie(context, name, { path: "/" });
}

function setTokenCookies(context: Context, tokens: OAuthTokens): void {
  setCookie(context, accessCookie, tokens.accessToken, cookieOptions(context, tokens.expiresIn));
  if (tokens.refreshToken)
    setCookie(
      context,
      refreshCookie,
      tokens.refreshToken,
      cookieOptions(context, 7 * 24 * 60 * 60),
    );
}
