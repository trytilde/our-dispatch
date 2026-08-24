import { createClient } from "@trytilde/sdk";
import { DeploymentOutputs, type DeploymentContext } from "@tryopenbot/runtime-provider";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TildeToolReconciler } from "./tools.js";

afterEach(() => vi.unstubAllGlobals());

describe("TildeToolReconciler", () => {
  it("creates a missing agent MCP server", async () => {
    const client = createClient({ teamId: "team-one", apiKey: "secret" });
    vi.spyOn(client.mcp, "getServer").mockRejectedValue({ status: 404 });
    vi.spyOn(client.mcp, "createServer").mockResolvedValue({
      id: "openbot-scout",
      name: "OpenBot scout",
      teamId: "team-one",
      isDynamicToolDiscovery: true,
      tools: [],
      url: "https://tilde.test/mcp",
    });
    const provider = new TildeToolReconciler({ client });
    await expect(
      provider.ensureServer(
        { id: "openbot-scout", name: "OpenBot scout", dynamicToolDiscovery: true },
        { requestId: "request-one" },
      ),
    ).resolves.toEqual({ id: "openbot-scout" });
    expect("listTools" in provider).toBe(false);
    expect("invoke" in provider).toBe(false);
  });

  it("idempotently reconciles a dynamic server and Tilde control-plane toolkit", async () => {
    const client = createClient({
      teamId: "team-one",
      orgId: "org-one",
      apiKey: "secret",
      baseUrl: "https://tilde.test",
    });
    let toolkitCreated = false;
    let toolkitEnabled = false;
    let toolkitMapped = false;
    const mutations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const path = url.pathname;
        if (request.method === "GET" && path.endsWith("/mcp-server/openbot-scout"))
          return Response.json({
            id: "openbot-scout",
            name: "OpenBot scout",
            team_id: "team-one",
            is_dynamic_tool_discovery: true,
            tools: toolkitMapped
              ? [
                  {
                    tool_group_instance_id: "openbot-scout-tilde-control-plane",
                    tool_group_source_type_id: "tilde_control_plane",
                    tool_source_type_id: "tilde_whoami",
                    tool_name: "tilde_whoami",
                  },
                ]
              : [],
          });
        if (request.method === "POST" && path.endsWith("/mcp-server/openbot-scout/function")) {
          toolkitMapped = true;
          mutations.push("map-toolkit-function");
          return Response.json({});
        }
        if (request.method === "GET" && path.endsWith("/mcp/tool-group"))
          return Response.json({
            items: toolkitCreated
              ? [
                  {
                    id: "openbot-scout-tilde-control-plane",
                    display_name: "OpenBot scout Tilde control plane",
                    tool_group_source_type_id: "tilde_control_plane",
                  },
                ]
              : [],
          });
        if (request.method === "POST" && path.includes("/available-tool-groups/")) {
          toolkitCreated = true;
          mutations.push("create-toolkit");
          return Response.json({
            id: "openbot-scout-tilde-control-plane",
            display_name: "OpenBot scout Tilde control plane",
            tool_group_source_type_id: "tilde_control_plane",
          });
        }
        if (request.method === "GET" && path.endsWith("/mcp/available-tool-groups"))
          return Response.json(
            url.searchParams.get("include_global") === "true"
              ? {
                  items: [
                    {
                      type_id: "tilde_control_plane",
                      tools: [{ type_id: "tilde_whoami" }],
                      credential_sources: [{ type_id: "no_auth" }],
                    },
                  ],
                }
              : { items: [] },
          );
        if (request.method === "GET" && path.endsWith("/mcp/tools"))
          return Response.json({
            items: toolkitEnabled
              ? [
                  {
                    tool_group_instance_id: "openbot-scout-tilde-control-plane",
                    tool_source_type_id: "tilde_whoami",
                  },
                ]
              : [],
          });
        if (request.method === "POST" && path.endsWith("/tool/tilde_whoami/enable")) {
          toolkitEnabled = true;
          mutations.push("enable-toolkit-tool");
          return Response.json({});
        }
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      }),
    );
    const context: DeploymentContext = {
      devMode: true,
      repositoryRoot: "/repo",
      environment: {},
      inputs: new DeploymentOutputs(),
      agentId: "scout",
      agentPath: "/repo/configuration/agent/subagents/scout",
      platformIds: ["tilde"],
      report: () => undefined,
    };
    const provider = new TildeToolReconciler({ client });
    await provider.deploy(context);
    await provider.deploy(context);
    expect(mutations).toEqual(["create-toolkit", "enable-toolkit-tool", "map-toolkit-function"]);
    expect(context.environment).toMatchObject({
      AGENT_SCOUT_MCP_SERVER_ID: "openbot-scout",
      AGENT_SCOUT_TILDE_CONTROL_PLANE_TOOL_GROUP_ID: "openbot-scout-tilde-control-plane",
    });
  });

  it("enables brokered GitHub tools only for the primary agent", async () => {
    const client = createClient({
      teamId: "team-one",
      orgId: "org-one",
      apiKey: "secret",
      baseUrl: "https://tilde.test",
    });
    let githubEnabled = false;
    const mutations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const path = url.pathname;
        if (request.method === "GET" && path.endsWith("/mcp-server/openbot-factory"))
          return Response.json({
            id: "openbot-factory",
            name: "OpenBot factory",
            team_id: "team-one",
            is_dynamic_tool_discovery: true,
            tools: [],
          });
        if (request.method === "GET" && path.endsWith("/mcp/tool-group"))
          return Response.json({
            items: [
              {
                id: "openbot-factory-tilde-control-plane",
                display_name: "OpenBot factory Tilde control plane",
                tool_group_source_type_id: "tilde_control_plane",
              },
            ],
          });
        if (request.method === "GET" && path.endsWith("/mcp/available-tool-groups"))
          return Response.json({
            items: [
              { type_id: "tilde_control_plane", tools: [], credential_sources: [] },
              {
                type_id: "github",
                tools: [{ type_id: "github_create_pull_request" }],
                credential_sources: [{ type_id: "server_token_exchange" }],
              },
            ],
          });
        if (request.method === "GET" && path.endsWith("/mcp/tools"))
          return Response.json({
            items:
              githubEnabled && url.searchParams.get("tool_group_instance_id") === "github-group"
                ? [
                    {
                      tool_group_instance_id: "github-group",
                      tool_source_type_id: "github_create_pull_request",
                    },
                  ]
                : [],
          });
        if (request.method === "POST" && path.endsWith("/tool/github_create_pull_request/enable")) {
          githubEnabled = true;
          mutations.push("enable-github-tool");
          return Response.json({});
        }
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      }),
    );
    const context: DeploymentContext = {
      devMode: false,
      repositoryRoot: "/repo",
      environment: { GIT_GITHUB_TOOL_GROUP_ID: "github-group" },
      inputs: new DeploymentOutputs(),
      agentId: "factory",
      agentPath: "/repo/configuration/agent",
      agentKind: "primary",
      platformIds: ["tilde"],
      report: () => undefined,
    };
    const provider = new TildeToolReconciler({ client });
    await provider.deploy(context);
    await provider.deploy(context);
    expect(mutations).toEqual(["enable-github-tool"]);
    await provider.deploy({ ...context, agentKind: "subagent", agentId: "factory" });
    expect(mutations).toEqual(["enable-github-tool"]);
  });

  it("idempotently connects Vercel MCP when Vercel is the deployment platform", async () => {
    const client = createClient({
      teamId: "team-one",
      orgId: "org-one",
      apiKey: "secret",
      baseUrl: "https://tilde.test",
    });
    let vercelServer: Record<string, unknown> | undefined;
    let vercelCredential: Record<string, unknown> | undefined;
    const mutations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/mcp-server/openbot-scout"))
          return Response.json({
            id: "openbot-scout",
            name: "OpenBot scout",
            team_id: "team-one",
            is_dynamic_tool_discovery: true,
            tools: [],
          });
        if (request.method === "GET" && path.endsWith("/mcp/tool-group"))
          return Response.json({
            items: [
              {
                id: "openbot-scout-tilde-control-plane",
                display_name: "OpenBot scout Tilde control plane",
                tool_group_source_type_id: "tilde_control_plane",
              },
            ],
          });
        if (request.method === "GET" && path.endsWith("/mcp/available-tool-groups"))
          return Response.json({
            items: [{ type_id: "tilde_control_plane", tools: [], credential_sources: [] }],
          });
        if (request.method === "GET" && path.endsWith("/mcp/tools"))
          return Response.json({ items: [] });
        if (request.method === "GET" && path.endsWith("/resource-server"))
          return Response.json({ items: vercelCredential ? [vercelCredential] : [] });
        if (request.method === "POST" && path.endsWith("/resource-server/encrypt")) {
          mutations.push("encrypt-vercel-token");
          return Response.json({ encrypted: true });
        }
        if (request.method === "POST" && path.endsWith("/resource-server")) {
          mutations.push("create-vercel-credential");
          vercelCredential = {
            id: "credential-one",
            metadata: { display_name: "OpenBot scout Vercel MCP" },
          };
          return Response.json({ id: "credential-one" });
        }
        if (request.method === "GET" && path.endsWith("/mcp/proxied-mcp-servers"))
          return Response.json({ items: vercelServer ? [vercelServer] : [] });
        if (request.method === "POST" && path.endsWith("/mcp/proxied-mcp-servers")) {
          mutations.push("connect-vercel-mcp");
          vercelServer = {
            server: {
              id: "vercel-provider",
              display_name: "OpenBot scout Vercel",
              endpoint_configuration: {
                url: "https://mcp.vercel.com",
                api_key_header_name: "Authorization",
                api_key_header_prefix: "Bearer ",
              },
              auth_mode: "bearer_token",
              status: "active",
            },
            tool_group_instance: {
              id: "vercel-group",
              display_name: "OpenBot scout Vercel",
              resource_server_credential_id: "credential-one",
            },
            tool_count: 4,
          };
          return Response.json({
            tool_group_instance: (vercelServer as { tool_group_instance: unknown })
              .tool_group_instance,
            discovered_tool_count: 4,
          });
        }
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      }),
    );
    const context: DeploymentContext = {
      devMode: false,
      repositoryRoot: "/repo",
      environment: { VERCEL_TOKEN: "vercel-secret" },
      inputs: new DeploymentOutputs(),
      agentId: "scout",
      agentPath: "/repo/configuration/agent/subagents/scout",
      platformIds: ["tilde", "vercel"],
      report: () => undefined,
    };
    const provider = new TildeToolReconciler({ client });
    await provider.deploy(context);
    await provider.deploy(context);
    context.environment.AGENT_SCOUT_VERCEL_MCP_CREDENTIAL_ID = "rotated-away-credential";
    await provider.deploy(context);
    expect(mutations).toEqual([
      "encrypt-vercel-token",
      "create-vercel-credential",
      "connect-vercel-mcp",
    ]);
    expect(context.environment).toMatchObject({
      AGENT_SCOUT_VERCEL_MCP_CREDENTIAL_ID: "credential-one",
      AGENT_SCOUT_VERCEL_MCP_SERVER_ID: "vercel-group",
    });
  });
});
