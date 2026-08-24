import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "./app.js";

const providersPage = {
  items: [
    {
      type_id: "google_mail",
      name: "Google Mail",
      metadata: {
        icon_url: "https://icons.tilde.test/google-mail.svg",
        icon_slug: "google-mail",
      },
      categories: ["email"],
      tools: [
        { type_id: "google_mail_search", name: "Search mail", documentation: "Search messages" },
      ],
      credential_sources: [
        {
          type_id: "google_mail_managed_oauth",
          display_name: "Sign in with your browser",
          requires_brokering: true,
          supports_auto_display_name: true,
          configuration_schema: { resource_server: {}, user_credential: {} },
        },
      ],
    },
    {
      type_id: "tavily",
      name: "Tavily",
      metadata: { logoUrl: "https://icons.tilde.test/tavily.svg", icon: "tavily" },
      credential_sources: [
        {
          type_id: "tavily_api_key",
          name: "api_key",
          requires_brokering: false,
          configuration_schema: {
            resource_server: {},
            user_credential: {
              type: "object",
              required: ["api_key"],
              properties: { api_key: { type: "string", format: "password" } },
            },
          },
        },
      ],
    },
  ],
};

const accountsPage = {
  items: [
    {
      id: "tgi-work",
      display_name: "Work Gmail",
      status: "active",
      tool_group_source_type_id: "google_mail",
      credential_source_type_id: "google_mail_managed_oauth",
    },
    {
      id: "tgi-tavily",
      display_name: "Tavily",
      status: "active",
      tool_group_source_type_id: "tavily",
    },
  ],
};

interface UpstreamCall {
  method: string;
  path: string;
  body?: unknown;
}

function connectorApp(
  respond: (call: UpstreamCall) => Response | undefined,
  environment?: NodeJS.ProcessEnv,
): {
  app: ReturnType<typeof createApp>;
  calls: UpstreamCall[];
} {
  const calls: UpstreamCall[] = [];
  const fetch = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(input);
    const call: UpstreamCall = {
      method: init?.method ?? "GET",
      path: url.pathname,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call) ?? new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
  });
  const app = createApp({
    connectors: {
      apiKey: "key",
      orgId: "org-1",
      teamId: "team-1",
      baseUrl: "https://tilde.test",
      fetch: fetch as unknown as typeof globalThis.fetch,
      ...(environment ? { environment } : {}),
    },
  });
  return { app, calls };
}

function catalogResponses(call: UpstreamCall): Response | undefined {
  if (call.path === "/api/v1/team/team-1/mcp/available-tool-groups")
    return Response.json(providersPage);
  if (call.path === "/api/v1/team/team-1/mcp/tool-group") return Response.json(accountsPage);
  if (call.path === "/api/v1/team/team-1/skill-providers") return Response.json({ items: [] });
  if (call.path === "/api/v1/team/team-1/mcp/proxied-mcp-servers")
    return Response.json({ items: [] });
  return undefined;
}

describe("connector routes", () => {
  it("serves the public OAuth return page and bounces desktop flows to the deep link", async () => {
    const app = createApp({});
    const web = await app.request("https://openbot.test/connectors/authorized?client=web");
    expect(web.status).toBe(200);
    const webPage = await web.text();
    expect(webPage).toContain("Authorization complete");
    expect(webPage).not.toContain("openbot://");
    const desktop = await app.request("https://openbot.test/connectors/authorized?client=electron");
    const desktopPage = await desktop.text();
    expect(desktopPage).toContain("openbot://connectors/authorized");
  });

  it("is unavailable without Tilde credentials", async () => {
    const app = createApp({});
    const response = await app.request("https://openbot.test/api/connectors/providers");
    expect(response.status).toBe(503);
  });

  it("serializes the provider catalog with credential sources", async () => {
    const { app } = connectorApp(catalogResponses);
    const response = await app.request("https://openbot.test/api/connectors/providers");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    expect(body.items.map((item) => item.type_id)).toEqual(["google_mail", "tavily"]);
    const sources = body.items[0]?.credential_sources as Record<string, unknown>[];
    expect(body.items[0]).toMatchObject({
      icon_url: "https://icons.tilde.test/google-mail.svg",
      icon_slug: "google-mail",
    });
    expect(body.items[1]).toMatchObject({
      icon_url: "https://icons.tilde.test/tavily.svg",
      icon_slug: "tavily",
    });
    expect(sources[0]).toMatchObject({
      type_id: "google_mail_managed_oauth",
      name: "Sign in with your browser",
      requires_brokering: true,
      supports_auto_display_name: true,
    });
  });

  it("filters accounts by provider", async () => {
    const { app } = connectorApp(catalogResponses);
    const response = await app.request(
      "https://openbot.test/api/connectors/accounts?provider=google_mail",
    );
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toEqual([
      {
        id: "tgi-work",
        display_name: "Work Gmail",
        status: "active",
        provider_type_id: "google_mail",
        credential_source_type_id: "google_mail_managed_oauth",
      },
    ]);
  });

  it("projects Tilde MCP mappings and skill registries into the plugins catalog", async () => {
    const { app } = connectorApp(
      (call) => {
        if (call.path.endsWith("/mcp/available-tool-groups"))
          return Response.json({
            items: [
              ...providersPage.items,
              {
                type_id: "tilde_control_plane",
                name: "Tilde Control Plane",
                categories: ["tilde"],
              },
              {
                type_id: "tilde_skill_registry",
                name: "Tilde Skill Registry",
                categories: ["skills"],
              },
              { type_id: "tilde_wallet", name: "Tilde Pay", categories: ["payments"] },
              { type_id: "tilde_browser", name: "Tilde Browser", categories: ["browser"] },
              {
                type_id: "chatkit_internal_agent",
                name: "Message internal agent",
                categories: ["chat"],
              },
              {
                type_id: "custom_tool_provider:custom-data",
                name: "Custom Data",
                categories: ["custom_tool_provider"],
              },
              {
                type_id: "proxied_mcp_vercel_hello",
                name: "OpenBot hello-world Vercel",
                categories: ["proxied_mcp"],
              },
              {
                type_id: "proxied_mcp_vercel_other",
                name: "OpenBot other Vercel",
                categories: ["proxied_mcp"],
              },
            ],
          });
        if (call.path.endsWith("/mcp/proxied-mcp-servers"))
          return Response.json({
            items: [
              {
                server: {
                  id: "proxied-hello",
                  display_name: "OpenBot hello-world Vercel",
                  endpoint_configuration: { url: "https://mcp.vercel.com/" },
                  status: "active",
                  tool_group_instance_id: "vercel-hello",
                  tool_group_source_type_id: "proxied_mcp_vercel_hello",
                },
                tool_group_instance: {
                  id: "vercel-hello",
                  display_name: "OpenBot hello-world Vercel",
                  status: "active",
                  tool_group_source_type_id: "proxied_mcp_vercel_hello",
                },
                tool_count: 180,
              },
              {
                server: {
                  id: "proxied-other",
                  display_name: "OpenBot other Vercel",
                  endpoint_configuration: { url: "https://mcp.vercel.com" },
                  status: "active",
                  tool_group_instance_id: "vercel-other",
                  tool_group_source_type_id: "proxied_mcp_vercel_other",
                },
                tool_group_instance: {
                  id: "vercel-other",
                  display_name: "OpenBot other Vercel",
                  status: "active",
                  tool_group_source_type_id: "proxied_mcp_vercel_other",
                },
                tool_count: 37,
              },
            ],
          });
        if (call.path.endsWith("/skill-providers"))
          return Response.json({
            items: [
              {
                id: "provider-cloudflare",
                name: "Cloudflare",
                description: "Cloudflare hosted skills",
                categories: ["infrastructure", "developer_tools"],
                repository_url: "https://github.com/cloudflare/skills",
                trust_status: "trusted",
                skills: [
                  {
                    id: "cloudflare-workers",
                    name: "Workers",
                    description: "Build and deploy Workers",
                    source_path: "skills/workers/SKILL.md",
                  },
                ],
              },
              {
                id: "provider-aws",
                name: "AWS",
                description: "AWS hosted skills",
                repository_url: "https://github.com/aws/skills",
                trust_status: "trusted",
                skills: [
                  {
                    id: "aws-cdk",
                    name: "AWS CDK",
                    description: "Build cloud infrastructure with CDK",
                    source_path: "skills/cdk/SKILL.md",
                  },
                ],
              },
            ],
          });
        const catalog = catalogResponses(call);
        if (catalog) return catalog;
        if (call.path.endsWith("/mcp/mcp-server"))
          return Response.json({
            items: [
              {
                id: "openbot-hello-world",
                tools: [
                  {
                    tool_source_type_id: "google_mail_search",
                    tool_group_source_type_id: "google_mail",
                    tool_group_instance_id: "tgi-work",
                  },
                ],
              },
            ],
          });
        if (call.path.endsWith("/skill"))
          return Response.json({
            items: [
              {
                id: "skill-1",
                name: "hello-world-code-review",
                description: "Review code",
                source_kind: "openbot",
                category: "OpenBot",
                source_provider_id: "google_mail",
                metadata: { provider_icon_key: "gmail" },
              },
              {
                id: "materialized-cloudflare-workers",
                name: "Workers",
                description: "Build and deploy Workers",
                source_kind: "trusted_provider",
                source_provider_id: "provider-cloudflare",
                source_path: "skills/workers/SKILL.md",
              },
            ],
          });
        if (call.path.endsWith("/skill-registry"))
          return Response.json({
            items: [
              {
                id: "registry-1",
                name: "OpenBot hello-world",
                skills: [
                  { id: "skill-1", name: "hello-world-code-review" },
                  { id: "materialized-cloudflare-workers", name: "Workers" },
                ],
              },
            ],
          });
        return undefined;
      },
      {
        AGENT_HELLO_WORLD_VERCEL_MCP_SERVER_ID: "vercel-hello",
      },
    );
    const response = await app.request("https://openbot.test/api/plugins?agent_id=hello-world");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tools: {
        provider: { name: string; categories: string[]; can_add_account?: boolean };
        accounts: { id: string; assigned_agent_ids: string[] }[];
      }[];
      skills: {
        id: string;
        name: string;
        description: string;
        categories: string[];
        icon_url?: string;
        icon_key?: string;
        skills: { id: string; name: string; assigned_agent_ids: string[] }[];
      }[];
    };
    expect(body.tools[0]?.accounts[0]).toMatchObject({
      id: "tgi-work",
      assigned_agent_ids: ["hello-world"],
    });
    expect(body.tools.filter(({ provider }) => provider.name === "Vercel")).toEqual([
      expect.objectContaining({
        provider: expect.objectContaining({
          name: "Vercel",
          categories: ["other"],
          can_add_account: false,
        }),
        accounts: [
          expect.objectContaining({ id: "vercel-hello", assigned_agent_ids: ["hello-world"] }),
          expect.objectContaining({ id: "vercel-other", assigned_agent_ids: [] }),
        ],
      }),
    ]);
    expect(
      body.tools.find(({ provider }) => provider.name === "Custom Data")?.provider.categories,
    ).toEqual(["other"]);
    expect(
      body.tools.find(({ provider }) => provider.name === "Tilde Control Plane")?.provider
        .categories,
    ).toEqual(["system"]);
    expect(
      body.tools.find(({ provider }) => provider.name === "Tilde Skill Registry")?.provider
        .categories,
    ).toEqual(["system"]);
    expect(
      body.tools.find(({ provider }) => provider.name === "Tilde Pay")?.provider.categories,
    ).toEqual(["system"]);
    expect(
      body.tools.find(({ provider }) => provider.name === "Tilde Browser")?.provider.categories,
    ).toEqual(["system"]);
    expect(
      body.tools.find(({ provider }) => provider.name === "Message internal agent")?.provider
        .categories,
    ).toEqual(["system"]);
    expect(body.tools.some(({ provider }) => provider.name === "OpenBot hello-world Vercel")).toBe(
      false,
    );
    expect(body.skills).toContainEqual(
      expect.objectContaining({
        id: "team:OpenBot",
        name: "OpenBot",
        categories: ["OpenBot"],
        icon_url: "https://icons.tilde.test/google-mail.svg",
        icon_key: "gmail",
        skills: [
          expect.objectContaining({
            id: "skill-1",
            name: "code-review",
            assigned_agent_ids: ["hello-world"],
          }),
        ],
      }),
    );
    expect(body.skills).toContainEqual(
      expect.objectContaining({
        id: "provider-cloudflare",
        name: "Cloudflare",
        categories: ["infrastructure", "developer_tools"],
        icon_key: "cloudflare",
        skills: [
          expect.objectContaining({
            id: 'trusted:["provider-cloudflare","cloudflare-workers"]',
            name: "Workers",
            assigned_agent_ids: ["hello-world"],
          }),
        ],
      }),
    );
    expect(body.skills).toContainEqual(
      expect.objectContaining({
        id: "provider-aws",
        name: "AWS",
        categories: ["other"],
        icon_key: "aws",
        skills: [
          expect.objectContaining({
            id: 'trusted:["provider-aws","aws-cdk"]',
            name: "AWS CDK",
            assigned_agent_ids: [],
          }),
        ],
      }),
    );
    expect(body.skills).toHaveLength(3);
  });

  it("persists tool and skill assignments through Tilde", async () => {
    const { app, calls } = connectorApp((call) => {
      const catalog = catalogResponses(call);
      if (catalog) return catalog;
      if (call.path.endsWith("/mcp/mcp-server"))
        return Response.json({ items: [{ id: "openbot-hello-world", tools: [] }] });
      if (call.path.endsWith("/mcp/tools")) return Response.json({ items: [] });
      if (call.path.includes("/tool/google_mail_search/enable")) return Response.json({});
      if (call.path.endsWith("/mcp/mcp-server/openbot-hello-world/function"))
        return Response.json({});
      if (call.path.endsWith("/skill"))
        return Response.json({ items: [{ id: "skill-1", name: "code-review" }] });
      if (call.path.endsWith("/skill-registry"))
        return Response.json({
          items: [{ id: "registry-1", name: "OpenBot hello-world", skills: [] }],
        });
      if (call.path.endsWith("/skill-registry/registry-1")) return Response.json({});
      return undefined;
    });

    const tool = await app.request(
      "https://openbot.test/api/plugins/tools/tgi-work/agents/hello-world",
      { method: "POST" },
    );
    expect(tool.status).toBe(200);
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/team/team-1/mcp/tool-group/tgi-work/tool/google_mail_search/enable",
      }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/team/team-1/mcp/mcp-server/openbot-hello-world/function",
        body: expect.objectContaining({ tool_group_instance_id: "tgi-work" }),
      }),
    );

    const skill = await app.request(
      "https://openbot.test/api/plugins/skills/skill-1/agents/hello-world",
      { method: "POST" },
    );
    expect(skill.status).toBe(200);
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: "PATCH",
        path: "/api/v1/team/team-1/skill-registry/registry-1",
        body: { skill_ids: ["skill-1"] },
      }),
    );
  });

  it("adds and removes trusted hosted skills through Tilde's provider-skill workflow", async () => {
    const { app, calls } = connectorApp((call) => {
      if (call.path.endsWith("/skill-providers"))
        return Response.json({
          items: [
            {
              id: "provider-cloudflare",
              name: "Cloudflare",
              description: "Cloudflare hosted skills",
              categories: ["infrastructure", "developer_tools"],
              repository_url: "https://github.com/cloudflare/skills",
              trust_status: "trusted",
              skills: [
                {
                  id: "cloudflare-workers",
                  name: "Workers",
                  description: "Build and deploy Workers",
                  source_path: "skills/workers/SKILL.md",
                },
              ],
            },
            {
              id: "provider-aws",
              name: "AWS",
              description: "AWS hosted skills",
              categories: ["cloud_infrastructure", "developer_tools"],
              repository_url: "https://github.com/aws/skills",
              trust_status: "trusted",
              skills: [
                {
                  id: "aws-cdk",
                  name: "AWS CDK",
                  description: "Build cloud infrastructure with CDK",
                  source_path: "skills/cdk/SKILL.md",
                },
              ],
            },
          ],
        });
      const catalog = catalogResponses(call);
      if (catalog) return catalog;
      if (call.path.endsWith("/skill"))
        return Response.json({
          items: [
            {
              id: "materialized-cloudflare-workers",
              name: "Workers",
              source_provider_id: "provider-cloudflare",
              source_path: "skills/workers/SKILL.md",
            },
          ],
        });
      if (call.path.endsWith("/skill-registry"))
        return Response.json({
          items: [
            {
              id: "registry-1",
              name: "OpenBot hello-world",
              skills: [{ id: "materialized-cloudflare-workers", name: "Workers" }],
            },
          ],
        });
      if (call.path.endsWith("/provider-skills")) return Response.json({});
      if (call.path.endsWith("/skill-registry/registry-1")) return Response.json({});
      return undefined;
    });

    const awsId = encodeURIComponent('trusted:["provider-aws","aws-cdk"]');
    const add = await app.request(
      `https://openbot.test/api/plugins/skills/${awsId}/agents/hello-world`,
      { method: "POST" },
    );
    expect(add.status).toBe(200);
    expect(calls).toContainEqual({
      method: "POST",
      path: "/api/v1/team/team-1/skill-registry/registry-1/provider-skills",
      body: { provider_id: "provider-aws", skill_ids: ["aws-cdk"] },
    });

    const cloudflareId = encodeURIComponent('trusted:["provider-cloudflare","cloudflare-workers"]');
    const remove = await app.request(
      `https://openbot.test/api/plugins/skills/${cloudflareId}/agents/hello-world`,
      { method: "DELETE" },
    );
    expect(remove.status).toBe(200);
    expect(calls).toContainEqual({
      method: "PATCH",
      path: "/api/v1/team/team-1/skill-registry/registry-1",
      body: { skill_ids: [] },
    });
  });

  it("creates an API-key account through encrypt, create, and instance calls", async () => {
    const { app, calls } = connectorApp((call) => {
      const fromCatalog = catalogResponses(call);
      if (fromCatalog) return fromCatalog;
      if (call.path.endsWith("/user-credential/encrypt"))
        return Response.json({ ciphertext: "sealed" });
      if (call.path.endsWith("/credential/source/tavily_api_key/user-credential"))
        return Response.json({ id: "uc-1" });
      if (call.path.endsWith("/available-credentials/tavily_api_key"))
        return Response.json({
          id: "tgi-new",
          display_name: "Research",
          status: "active",
          tool_group_source_type_id: "tavily",
          credential_source_type_id: "tavily_api_key",
        });
      return undefined;
    });
    const response = await app.request("https://openbot.test/api/connectors/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_type_id: "tavily",
        credential_source_type_id: "tavily_api_key",
        display_name: "Research",
        user_credential_values: { api_key: "tvly-secret" },
      }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      status: "created",
      account: {
        id: "tgi-new",
        display_name: "Research",
        status: "active",
        provider_type_id: "tavily",
        credential_source_type_id: "tavily_api_key",
      },
    });
    const encrypt = calls.find((call) => call.path.endsWith("/user-credential/encrypt"));
    expect(encrypt?.body).toEqual({ dek_alias: "default", value: { api_key: "tvly-secret" } });
    const create = calls.find(
      (call) =>
        call.path.endsWith("/credential/source/tavily_api_key/user-credential") &&
        !call.path.includes("encrypt"),
    );
    expect(create?.body).toMatchObject({
      dek_alias: "default",
      user_credential_configuration: { ciphertext: "sealed" },
    });
    const instance = calls.find((call) =>
      call.path.endsWith("/available-credentials/tavily_api_key"),
    );
    expect(instance?.body).toMatchObject({
      display_name: "Research",
      user_credential_id: "uc-1",
    });
  });

  it("returns the brokered authorization URL for OAuth providers", async () => {
    const { app, calls } = connectorApp((call) => {
      const fromCatalog = catalogResponses(call);
      if (fromCatalog) return fromCatalog;
      if (call.path.endsWith("/available-credentials/google_mail_managed_oauth"))
        return Response.json({
          id: "tgi-oauth",
          display_name: "New Gmail",
          status: "brokering_initiated",
          tool_group_source_type_id: "google_mail",
        });
      if (call.path.endsWith("/user-credential/broker"))
        return Response.json({
          type: "broker_state",
          action: { Redirect: { url: "https://accounts.google.com/authorize" } },
        });
      return undefined;
    });
    const response = await app.request("https://openbot.test/api/connectors/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_type_id: "google_mail",
        credential_source_type_id: "google_mail_managed_oauth",
        display_name: "New Gmail",
        return_url: "https://openbot.test/?connector_setup=complete",
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("authorize");
    expect(body.authorization_url).toBe("https://accounts.google.com/authorize");
    const instance = calls.find((call) =>
      call.path.endsWith("/available-credentials/google_mail_managed_oauth"),
    );
    expect(instance?.body).toMatchObject({
      return_on_successful_brokering: {
        type: "url",
        url: "https://openbot.test/?connector_setup=complete",
      },
    });
    const broker = calls.find((call) => call.path.endsWith("/user-credential/broker"));
    expect(broker?.body).toMatchObject({
      owner_type: "tool_group_instance",
      owner_id: "tgi-oauth",
    });
  });

  it("rejects unknown providers and malformed bodies", async () => {
    const { app } = connectorApp(catalogResponses);
    const unknown = await app.request("https://openbot.test/api/connectors/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_type_id: "nope",
        credential_source_type_id: "nope",
        display_name: "x",
      }),
    });
    expect(unknown.status).toBe(404);
    const invalid = await app.request("https://openbot.test/api/connectors/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider_type_id: "tavily" }),
    });
    expect(invalid.status).toBe(400);
  });
});
