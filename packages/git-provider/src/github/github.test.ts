import { TildePlatform } from "@tryopenbot/platform-integrations";
import { DeploymentOutputs, type DeploymentContext } from "@tryopenbot/runtime-provider";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { GitHubGitProvider, parseGitHubRepository } from "./index.js";

afterEach(() => vi.unstubAllGlobals());

function platform(): TildePlatform {
  return new TildePlatform({
    apiKey: "secret",
    orgId: "org-one",
    teamId: "team-one",
    baseUrl: "https://tilde.test",
  });
}

function deploymentContext(): DeploymentContext & { events: string[] } {
  const events: string[] = [];
  return {
    devMode: false,
    repositoryRoot: "/repo",
    environment: { OPENBOT_DEPLOYMENT_NAME: "OpenBot" },
    inputs: new DeploymentOutputs(),
    platformIds: ["tilde"],
    report: ({ event }) => void events.push(event),
    events,
  };
}

function githubGroup(credentialId?: string): Record<string, unknown> {
  return {
    id: "github-group",
    display_name: "OpenBot GitHub",
    tool_group_source_type_id: "github",
    credential_source_type_id: "server_token_exchange",
    status: credentialId ? "active" : "pending",
    resource_server_credential_id: credentialId ?? null,
  };
}

describe("parseGitHubRepository", () => {
  it("extracts owner/name from GitHub remote URL forms", () => {
    expect(parseGitHubRepository("https://github.com/acme/our-openbot.git")).toBe(
      "acme/our-openbot",
    );
    expect(parseGitHubRepository("https://github.com/acme/our-openbot")).toBe("acme/our-openbot");
    expect(parseGitHubRepository("git@github.com:acme/our-openbot.git")).toBe("acme/our-openbot");
    expect(parseGitHubRepository("ssh://git@github.com/acme/our-openbot")).toBe("acme/our-openbot");
    expect(parseGitHubRepository("https://gitlab.com/acme/our-openbot.git")).toBeUndefined();
    expect(parseGitHubRepository("https://github.com/acme")).toBeUndefined();
  });
});

describe("GitHubGitProvider", () => {
  it("derives the fork repository from the origin remote once during initialization", async () => {
    const provider = new GitHubGitProvider(platform());
    const environment: NodeJS.ProcessEnv = {};
    const persisted: Record<string, string> = {};
    const context = {
      repositoryRoot: process.cwd(),
      environment,
      async setEnvironment(name: string, value: string) {
        persisted[name] = value;
        environment[name] = value;
      },
      async setSecret() {},
    };
    await provider.initialize(context);
    // This test runs inside the OpenBot checkout, whose origin is a GitHub remote.
    const derived = persisted.GIT_GITHUB_REPOSITORY;
    if (derived) expect(derived).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/);
    environment.GIT_GITHUB_REPOSITORY = "acme/pinned";
    await provider.initialize(context);
    expect(environment.GIT_GITHUB_REPOSITORY).toBe("acme/pinned");
  });

  it("starts GitHub App provisioning during initialization and never fails init", async () => {
    const mutations: string[] = [];
    const events: string[] = [];
    let provisioned = false;
    const stubFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path.endsWith("/mcp/tool-group"))
        return Response.json({ items: provisioned ? [githubGroup()] : [] });
      if (request.method === "POST" && path.endsWith("/auto-provision")) {
        mutations.push("auto-provision");
        provisioned = true;
        return Response.json({
          provider_provisioning_response: {
            next_action: { type: "redirect", url: "https://github.test/install" },
          },
          tool_group_instance: githubGroup(),
        });
      }
      throw new Error(`Unexpected request: ${request.method} ${path}`);
    };
    const environment: NodeJS.ProcessEnv = {
      GIT_GITHUB_REPOSITORY: "acme/our-openbot",
      TILDE_API_KEY: "secret",
      TILDE_ORG_ID: "org-one",
      TILDE_TEAM_ID: "team-one",
      TILDE_BASE_URL: "https://tilde.test",
    };
    const context = {
      repositoryRoot: "/repo",
      environment,
      request: stubFetch as typeof fetch,
      report: ({ event }: { event: string }) => void events.push(event),
      async setEnvironment(name: string, value: string) {
        environment[name] = value;
      },
      async setSecret() {},
    };
    const provider = new GitHubGitProvider(platform());
    await provider.initialize(context);
    expect(mutations).toEqual(["auto-provision"]);
    expect(events).toContain("git.github.authorization.required");
    expect(environment.GIT_GITHUB_TOOL_GROUP_ID).toBe("github-group");

    // A Tilde outage or unexpected response degrades to a skipped event, never a failed init.
    const failing = {
      ...context,
      request: (async () => Response.json({ unexpected: true })) as typeof fetch,
      environment: { ...environment, GIT_GITHUB_TOOL_GROUP_ID: undefined },
    };
    await expect(provider.initialize(failing)).resolves.toBeUndefined();
  });

  it("provisions the GitHub App and surfaces the authorization action while pending", async () => {
    const mutations: string[] = [];
    let provisioned = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/mcp/tool-group"))
          return Response.json({ items: provisioned ? [githubGroup()] : [] });
        if (request.method === "POST" && path.endsWith("/auto-provision")) {
          mutations.push("auto-provision");
          provisioned = true;
          return Response.json({
            provider_provisioning_response: {
              next_action: { type: "redirect", url: "https://github.test/install" },
            },
            tool_group_instance: githubGroup(),
          });
        }
        if (request.method === "POST" && path.endsWith("/credential/provider-provisioning/start")) {
          mutations.push("provisioning-start");
          return Response.json({
            next_action: { type: "redirect", url: "https://github.test/install" },
            state_id: "state-one",
          });
        }
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      }),
    );
    const context = deploymentContext();
    const provider = new GitHubGitProvider(platform());
    await provider.deployable.deploy(context);
    expect(mutations).toEqual(["auto-provision"]);
    expect(context.events).toContain("git.github.authorization.required");
    expect(context.events).toContain("git.github.pending");
    expect(context.environment.GIT_GITHUB_TOOL_GROUP_ID).toBe("github-group");
    expect(context.environment.GIT_GITHUB_REST_PROXY_PROFILE_ID).toBeUndefined();
    // A later run with the group still unconnected restarts provisioning for a fresh action.
    await provider.deployable.deploy(context);
    expect(mutations).toEqual(["auto-provision", "provisioning-start"]);
  });

  it("serves the manifest form locally and polls until authorization completes", async () => {
    let pageFetched = false;
    const events: { event: string; details?: Record<string, unknown> }[] = [];
    const stubRequest = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path.endsWith("/mcp/tool-group"))
        return Response.json({
          items: [githubGroup(pageFetched ? "credential-github" : undefined)],
        });
      if (request.method === "POST" && path.endsWith("/credential/provider-provisioning/start"))
        return Response.json({
          next_action: {
            type: "render_form_post",
            action_url: "https://github.com/settings/apps/new?state=state-one",
            fields: { manifest: { name: "Acme OpenBot", url: "https://tilde.test" } },
          },
          state_id: "state-one",
        });
      throw new Error(`Unexpected request: ${request.method} ${path}`);
    }) as typeof fetch;
    const environment: NodeJS.ProcessEnv = {
      GIT_GITHUB_REPOSITORY: "acme/our-openbot",
      GIT_GITHUB_APP_NAME: "Acme OpenBot",
      GIT_GITHUB_APP_ORGANIZATION: "acme-org",
      TILDE_API_KEY: "secret",
      TILDE_ORG_ID: "org-one",
      TILDE_TEAM_ID: "team-one",
      TILDE_BASE_URL: "https://tilde.test",
    };
    const context = {
      repositoryRoot: "/repo",
      environment,
      interactive: true,
      request: stubRequest,
      report: ({ event, details }: { event: string; details?: Record<string, unknown> }) => {
        events.push({ event, ...(details ? { details } : {}) });
      },
      async setEnvironment(name: string, value: string) {
        environment[name] = value;
      },
      async setSecret() {},
    };
    const provider = new GitHubGitProvider(platform(), {
      pollIntervalMs: 10,
      authorizationTimeoutMs: 5_000,
    });
    const initialized = provider.initialize(context);
    const localUrl = await vi.waitFor(() => {
      const required = events.find((entry) => entry.event === "git.github.authorization.required");
      const url = required?.details?.url;
      if (typeof url !== "string") throw new Error("authorization URL not reported yet");
      return url;
    });
    expect(localUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await (await fetch(localUrl)).text();
    expect(page).toContain(
      'action="https://github.com/organizations/acme-org/settings/apps/new?state=state-one"',
    );
    expect(page).toContain("&quot;Acme OpenBot&quot;");
    expect(page).toContain("document.forms[0].submit()");
    pageFetched = true;
    await initialized;
    expect(events.map((entry) => entry.event)).toContain("git.github.authorized");
    expect(environment.GIT_GITHUB_TOOL_GROUP_ID).toBe("github-group");
    await expect(fetch(localUrl)).rejects.toThrow();
  });

  it("idempotently reconciles reverse-proxy profiles once the credential is connected", async () => {
    const profiles = new Map<string, Record<string, unknown>>();
    const mutations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/mcp/tool-group"))
          return Response.json({ items: [githubGroup("credential-github")] });
        if (request.method === "GET" && path.endsWith("/reverse-proxy/profile"))
          return Response.json({ items: [...profiles.values()] });
        if (request.method === "POST" && path.endsWith("/reverse-proxy/profile")) {
          const body = (await request.json()) as { id: string; provider_id: string };
          mutations.push(`create:${body.id}`);
          const profile = {
            id: body.id,
            provider_id: body.provider_id,
            resource_server_credential_id: "credential-github",
            enabled: true,
            base_url: "https://github.test",
          };
          profiles.set(body.id, profile);
          return Response.json(profile);
        }
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      }),
    );
    const context = deploymentContext();
    const provider = new GitHubGitProvider(platform());
    await provider.deployable.deploy(context);
    await provider.deployable.deploy(context);
    expect(mutations).toEqual(["create:openbot-github-rest", "create:openbot-github-git"]);
    expect(context.environment).toMatchObject({
      GIT_GITHUB_TOOL_GROUP_ID: "github-group",
      GIT_GITHUB_CREDENTIAL_ID: "credential-github",
      GIT_GITHUB_REST_PROXY_PROFILE_ID: "openbot-github-rest",
      GIT_GITHUB_GIT_PROXY_PROFILE_ID: "openbot-github-git",
    });
  });

  it("re-attaches a rotated credential to existing profiles", async () => {
    const updates: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/mcp/tool-group"))
          return Response.json({ items: [githubGroup("credential-rotated")] });
        if (request.method === "GET" && path.endsWith("/reverse-proxy/profile"))
          return Response.json({
            items: [
              {
                id: "openbot-github-rest",
                provider_id: "github",
                resource_server_credential_id: "credential-stale",
                enabled: false,
              },
              {
                id: "openbot-github-git",
                provider_id: "github_git_https",
                resource_server_credential_id: "credential-rotated",
                enabled: true,
              },
            ],
          });
        if (path.endsWith("/reverse-proxy/profile/openbot-github-rest")) {
          updates.push("update:openbot-github-rest");
          return Response.json({
            id: "openbot-github-rest",
            provider_id: "github",
            resource_server_credential_id: "credential-rotated",
            enabled: true,
          });
        }
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      }),
    );
    const context = deploymentContext();
    const provider = new GitHubGitProvider(platform());
    await provider.deployable.deploy(context);
    expect(updates).toEqual(["update:openbot-github-rest"]);
    expect(context.environment.GIT_GITHUB_CREDENTIAL_ID).toBe("credential-rotated");
  });
});
