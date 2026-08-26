import type { Context } from "hono";

export const defaultTildeBaseUrl = "https://api.trytilde.ai";

export interface TildeRouteOptions {
  apiKey: string;
  orgId: string;
  teamId: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export function tildeOptionsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): TildeRouteOptions | undefined {
  const apiKey = environment.TILDE_API_KEY?.trim();
  const orgId = environment.TILDE_ORG_ID?.trim();
  const teamId = environment.TILDE_TEAM_ID?.trim();
  if (!apiKey || !orgId || !teamId) return undefined;
  return {
    apiKey,
    orgId,
    teamId,
    baseUrl: environment.TILDE_BASE_URL?.trim() || undefined,
  };
}

export class TildeUpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function tildeJson(
  options: TildeRouteOptions,
  teamPath: string,
  init?: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    authorization?: string;
  },
): Promise<unknown> {
  const method = init?.method ?? (init && "body" in init ? "POST" : "GET");
  const body = init?.body;
  const url = new URL(
    `/api/v1/team/${encodeURIComponent(options.teamId)}${teamPath}`,
    options.baseUrl ?? defaultTildeBaseUrl,
  );
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method,
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-api-key": options.apiKey,
      "x-tilde-org-id": options.orgId,
      "x-tilde-team-id": options.teamId,
      ...(init?.authorization ? { authorization: init.authorization } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null
        ? ((payload as { error?: string; message?: string }).error ??
          (payload as { message?: string }).message)
        : undefined;
    throw new TildeUpstreamError(
      detail ?? `Tilde request failed (${response.status})`,
      response.status >= 500 ? 502 : response.status,
    );
  }
  return payload;
}

const maxPages = 20;

export async function tildePages(
  options: TildeRouteOptions,
  teamPath: string,
  pageSize: number,
): Promise<unknown[]> {
  const separator = teamPath.includes("?") ? "&" : "?";
  const items: unknown[] = [];
  let token: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const query = `${separator}page_size=${pageSize}${
      token ? `&next_page_token=${encodeURIComponent(token)}` : ""
    }`;
    const response = (await tildeJson(options, `${teamPath}${query}`)) as Record<string, unknown>;
    items.push(...pageItems(response));
    const next = response.next_page_token;
    if (typeof next !== "string" || !next) break;
    token = next;
  }
  return items;
}

/**
 * Page size the unpaginated `/signals/*` lists are asked for. They apply no
 * clamp of their own, so this is far above any realistic team's row count and
 * the truncation tripwire below is effectively unreachable. (ChatKit routines
 * are separate: they page properly and clamp to 1..=100.)
 */
export const unpagedTildePageSize = 1000;

/**
 * The `/signals/*` list endpoints are unpaginated upstream: they always answer
 * `next_page_token: null`, so `page_size` is a hard cap rather than a window.
 * They query `LIMIT page_size + 1`, so a full page is one row longer than the
 * size asked for. Fail loudly when it fills, because silently truncating
 * orphans routine members from their group.
 */
export async function tildeUnpagedItems(
  options: TildeRouteOptions,
  teamPath: string,
): Promise<unknown[]> {
  const separator = teamPath.includes("?") ? "&" : "?";
  const response = (await tildeJson(
    options,
    `${teamPath}${separator}page_size=${unpagedTildePageSize}`,
  )) as Record<string, unknown>;
  const items = pageItems(response);
  if (items.length > unpagedTildePageSize)
    throw new TildeUpstreamError(
      `Tilde returned more than the maximum ${unpagedTildePageSize} results for ${teamPath}, which OpenBot cannot page past`,
      502,
    );
  return items;
}

export function pageItems(page: Record<string, unknown>): unknown[] {
  if (Array.isArray(page.items)) return page.items;
  if (Array.isArray(page.data)) return page.data;
  if (Array.isArray(page)) return page as unknown[];
  return [];
}

export function tildeUnavailable(context: Context, feature: string): Response {
  return context.json(
    { error: `${feature} are unavailable because Tilde server credentials are not configured` },
    503,
  );
}

export function tildeUpstreamFailure(context: Context, feature: string, error: unknown): Response {
  if (error instanceof TildeUpstreamError)
    return context.json({ error: error.message }, error.status as 400);
  return context.json(
    {
      error: `Tilde ${feature} request failed`,
      detail: error instanceof Error ? error.message : "Unknown upstream failure",
    },
    502,
  );
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function valueRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
