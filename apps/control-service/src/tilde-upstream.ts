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

/** Server-only Tilde call retained for local source creation and provisioning. */
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
  const response = await (options.fetch ?? globalThis.fetch)(
    new URL(
      `/api/v1/team/${encodeURIComponent(options.teamId)}${teamPath}`,
      options.baseUrl ?? "https://api.trytilde.ai",
    ),
    {
      method,
      headers: {
        accept: "application/json",
        ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
        "x-api-key": options.apiKey,
        "x-tilde-org-id": options.orgId,
        "x-tilde-team-id": options.teamId,
        ...(init?.authorization ? { authorization: init.authorization } : {}),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
  );
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null
        ? ((payload as { error?: string; message?: string }).error ??
          (payload as { message?: string }).message)
        : undefined;
    throw new Error(detail ?? `Tilde request failed (${response.status})`);
  }
  return payload;
}
