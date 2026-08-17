import type { DeploymentContext } from "@tryopenbot/runtime-provider";

export interface VercelCommandRunner {
  run(
    command: string,
    args: readonly string[],
    options: { cwd: string; environment: NodeJS.ProcessEnv; inherit?: boolean; input?: string },
  ): Promise<{ stdout: string; stderr: string }>;
}

export function requiredVercelProject(
  environment: NodeJS.ProcessEnv,
  variable: "VERCEL_CONTROL_PROJECT" | "VERCEL_AGENT_PROJECT",
): string {
  const value = environment[variable]?.trim();
  if (!value) throw new Error(`${variable} is required`);
  return value;
}

export function vercelScopeArguments(environment: NodeJS.ProcessEnv): string[] {
  return environment.VERCEL_TEAM_ID ? ["--scope", environment.VERCEL_TEAM_ID] : [];
}

export async function ensureVercelProject(
  runner: VercelCommandRunner,
  context: Pick<DeploymentContext, "repositoryRoot" | "environment">,
  project: string,
): Promise<void> {
  const scope = vercelScopeArguments(context.environment);
  try {
    await runner.run("pnpm", ["exec", "vercel", "project", "inspect", project, ...scope], {
      cwd: context.repositoryRoot,
      environment: context.environment,
    });
  } catch {
    await runner.run("pnpm", ["exec", "vercel", "project", "add", project, ...scope], {
      cwd: context.repositoryRoot,
      environment: context.environment,
    });
  }
}

export async function installVercelEnvironment(
  context: DeploymentContext,
  project: string,
  request: typeof fetch = fetch,
): Promise<void> {
  const variables = new Map(
    Object.entries(context.configuration ?? context.environment).flatMap(([name, value]) =>
      value === undefined || isControlPlaneCredential(name)
        ? []
        : [[name, { value, sensitive: true }] as const],
    ),
  );
  const token = context.environment.VERCEL_TOKEN?.trim();
  if (!token) throw new Error("VERCEL_TOKEN is required to install Vercel environment variables");
  const url = new URL(
    `https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/env?upsert=true`,
  );
  const teamId = context.environment.VERCEL_TEAM_ID?.trim();
  if (teamId) url.searchParams.set("teamId", teamId);
  for (const [name, variable] of variables) {
    const response = await request(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: variable.sensitive ? "sensitive" : "encrypted",
        key: name,
        value: variable.value,
        target: ["production"],
      }),
    });
    if (!response.ok)
      throw new Error(`Could not install Vercel environment variable ${name} (${response.status})`);
  }
}

function isControlPlaneCredential(name: string): boolean {
  return /^(?:VERCEL_TOKEN|SOPS_AGE_KEY(?:_FILE|_CMD)?|AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|SECURITY_TOKEN|PROFILE))$/.test(
    name,
  );
}

export function vercelDeploymentUrl(output: string): string {
  for (const line of output.split("\n").reverse()) {
    try {
      const parsed = JSON.parse(line) as { url?: unknown; deploymentUrl?: unknown };
      const value = typeof parsed.url === "string" ? parsed.url : parsed.deploymentUrl;
      if (typeof value === "string") return normalizeUrl(value);
    } catch {
      const match = line.match(/https:\/\/[^\s]+/);
      if (match) return normalizeUrl(match[0]);
    }
  }
  throw new Error("Vercel did not return a deployment URL");
}

function normalizeUrl(value: string): string {
  return (value.startsWith("http") ? value : `https://${value}`).replace(/\/$/, "");
}
