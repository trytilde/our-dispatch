export interface VercelRegistryIdentity {
  repository: string;
  username: string;
}

export interface VercelProjectCredentials {
  token: string;
  projectId: string;
  teamId: string;
}

export class VercelPlatformError extends Error {
  constructor(
    readonly code: "invalid_configuration" | "provider_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "VercelPlatformError";
  }
}

/** Resolve the authenticated Vercel account and its Container Registry namespace. */
export async function resolveVercelRegistryIdentity(options: {
  token?: string;
  project?: string;
  teamId?: string;
  request?: typeof fetch;
}): Promise<VercelRegistryIdentity> {
  const token = options.token?.trim();
  if (!token)
    throw new VercelPlatformError(
      "invalid_configuration",
      "VERCEL_TOKEN is required to resolve the Vercel Container Registry",
    );
  const project = options.project?.trim();
  if (!project)
    throw new VercelPlatformError(
      "invalid_configuration",
      "VERCEL_AGENT_PROJECT is required to resolve the Vercel Container Registry",
    );
  const team = options.teamId?.trim();
  const url = team
    ? `https://api.vercel.com/v2/teams/${encodeURIComponent(team)}`
    : "https://api.vercel.com/v2/user";
  const response = await (options.request ?? fetch)(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new VercelPlatformError(
      "provider_unavailable",
      `Could not resolve the Vercel registry scope (${response.status})`,
    );
  const body = (await response.json()) as {
    id?: unknown;
    slug?: unknown;
    username?: unknown;
    user?: { id?: unknown; username?: unknown };
  };
  const account = body.user ?? body;
  const slug = team ? body.slug : account.username;
  const username = team ? body.id : account.id;
  if (typeof slug !== "string" || !slug || typeof username !== "string" || !username)
    throw new VercelPlatformError(
      "provider_unavailable",
      "Vercel did not return the account identity required for its Container Registry",
    );
  return {
    repository: `vcr.vercel.com/${slug}/${project}/openbot-computer`,
    username,
  };
}

/** Resolve explicit credentials for SDKs that cannot use the Vercel CLI project context. */
export async function resolveVercelProjectCredentials(options: {
  token?: string;
  project?: string;
  teamId?: string;
  request?: typeof fetch;
}): Promise<VercelProjectCredentials> {
  const token = options.token?.trim();
  if (!token)
    throw new VercelPlatformError(
      "invalid_configuration",
      "VERCEL_TOKEN is required to access Vercel Sandbox",
    );
  const project = options.project?.trim();
  if (!project)
    throw new VercelPlatformError(
      "invalid_configuration",
      "VERCEL_AGENT_PROJECT is required to access Vercel Sandbox",
    );
  const url = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(project)}`);
  const configuredTeam = options.teamId?.trim();
  if (configuredTeam) url.searchParams.set("teamId", configuredTeam);
  const response = await (options.request ?? fetch)(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new VercelPlatformError(
      "provider_unavailable",
      `Could not resolve the Vercel agent project (${response.status})`,
    );
  const body = (await response.json()) as { id?: unknown; accountId?: unknown };
  if (
    typeof body.id !== "string" ||
    !body.id ||
    typeof body.accountId !== "string" ||
    !body.accountId
  )
    throw new VercelPlatformError(
      "provider_unavailable",
      "Vercel did not return the project identity required for Sandbox",
    );
  return { token, projectId: body.id, teamId: body.accountId };
}
