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
    const response = respond(call);
    if (response) return response;
    if (call.path === "/api/v1/team/team-1/openbot/plugins/catalog") {
      const items = async (path: string): Promise<unknown[]> => {
        const legacy = respond({ method: "GET", path });
        if (!legacy) return [];
        const payload = (await legacy.json()) as { items?: unknown[] };
        return payload.items ?? [];
      };
      return Response.json({
        tool_providers: await items("/api/v1/team/team-1/mcp/available-tool-groups"),
        tool_accounts: await items("/api/v1/team/team-1/mcp/tool-group"),
        mcp_servers: await items("/api/v1/team/team-1/mcp/mcp-server"),
        proxied_mcp_servers: await items("/api/v1/team/team-1/mcp/proxied-mcp-servers"),
        skills: await items("/api/v1/team/team-1/skill"),
        skill_providers: await items("/api/v1/team/team-1/skill-providers"),
        skill_registries: await items("/api/v1/team/team-1/skill-registry"),
      });
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
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
  if (call.path === "/api/v1/team/team-1/provider-setup/start") {
    const body = call.body as {
      provider_id?: string;
      form_values?: Record<string, unknown>;
      return_url?: string | null;
    };
    if (body.provider_id === "nope")
      return Response.json({ error: "Unknown connector provider" }, { status: 404 });
    const oauth = body.provider_id === "google_mail";
    return Response.json({
      resource: {
        id: oauth ? "tgi-oauth" : "tgi-new",
        display_name: body.form_values?.displayName,
        status: oauth ? "brokering_initiated" : "active",
        tool_group_source_type_id: body.provider_id,
        credential_source_type_id: oauth ? "google_mail_managed_oauth" : "tavily_api_key",
      },
      next_action: oauth
        ? { type: "redirect", url: "https://accounts.google.com/authorize" }
        : { type: "complete" },
    });
  }
  if (call.path === "/api/v1/team/team-1/provider-setup/catalog")
    return Response.json({
      domain: "mcp",
      providers: providersPage.items.map((provider) => ({
        provider_id: provider.type_id,
        display_name: provider.name,
        description: provider.name,
        categories: provider.categories ?? [],
        icon_url: provider.metadata?.icon_url ?? provider.metadata?.logoUrl,
        icon_slug: provider.metadata?.icon_slug ?? provider.metadata?.icon,
        auth_methods: provider.credential_sources.map((rawSource) => {
          const source = rawSource as {
            type_id: string;
            display_name?: string;
            name?: string;
            requires_brokering: boolean;
            supports_auto_display_name?: boolean;
            configuration_schema: {
              user_credential?: {
                properties?: Record<string, { format?: string }>;
                required?: string[];
              };
            };
          };
          return {
            id: source.type_id,
            credential_source_type_id: source.type_id,
            display_name: source.display_name ?? source.name,
            setup_kind: source.requires_brokering ? "oauth" : "api_key",
            supports_auto_display_name: source.supports_auto_display_name ?? false,
            fields: Object.entries(
              source.configuration_schema.user_credential?.properties ?? {},
            ).map(([name, field]) => ({
              name,
              label: name,
              field_type: field.format === "password" ? "password" : "text",
              required:
                source.configuration_schema.user_credential?.required?.includes(name) ?? false,
            })),
          };
        }),
      })),
      resources: accountsPage.items,
    });
  if (call.path === "/api/v1/team/team-1/mcp/available-tool-groups")
    return Response.json(providersPage);
  if (call.path === "/api/v1/team/team-1/mcp/provider-catalog") return Response.json({ items: [] });
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

  it("deletes a toolkit account through the cascading tool-group endpoint", async () => {
    const { app, calls } = connectorApp((call) => {
      if (call.method === "DELETE" && call.path === "/api/v1/team/team-1/mcp/tool-group/tgi-work")
        return Response.json({});
      const catalog = catalogResponses(call);
      if (catalog) return catalog;
      return undefined;
    });

    const response = await app.request("https://openbot.test/api/connectors/accounts", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account_ids: ["tgi-work"] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(calls).toContainEqual({
      method: "DELETE",
      path: "/api/v1/team/team-1/mcp/tool-group/tgi-work",
      body: undefined,
    });
  });

  it("deletes a proxied MCP account through its dedicated cascading endpoint", async () => {
    const { app, calls } = connectorApp((call) => {
      if (call.method === "GET" && call.path === "/api/v1/team/team-1/mcp/proxied-mcp-servers")
        return Response.json({
          items: [
            {
              server: {
                id: "proxied-apollo",
                display_name: "Sales team",
                endpoint_configuration: {},
                status: "active",
                tool_group_instance_id: "apollo-account",
                tool_group_source_type_id: "proxied_mcp_apollo_account",
              },
              tool_group_instance: {
                id: "apollo-account",
                display_name: "Sales team",
                status: "active",
              },
              tool_count: 12,
            },
          ],
        });
      if (
        call.method === "DELETE" &&
        call.path === "/api/v1/team/team-1/mcp/proxied-mcp-servers/apollo-account"
      )
        return Response.json({});
      return undefined;
    });

    const response = await app.request("https://openbot.test/api/connectors/accounts", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account_ids: ["apollo-account"] }),
    });

    expect(response.status).toBe(200);
    expect(calls).toContainEqual({
      method: "DELETE",
      path: "/api/v1/team/team-1/mcp/proxied-mcp-servers/apollo-account",
      body: undefined,
    });
    expect(
      calls.some(
        (call) => call.method === "DELETE" && call.path.includes("/mcp/tool-group/apollo-account"),
      ),
    ).toBe(false);
  });

  it("includes unconnected managed MCP providers in the plugins catalog", async () => {
    const { app } = connectorApp((call) => {
      if (call.path.endsWith("/mcp/provider-catalog")) {
        return Response.json({
          items: [
            {
              id: "apollo",
              tool_provider_type_id: "managed_mcp:apollo",
              name: "Apollo.io",
              description: "Search and enrich sales intelligence.",
              endpoint_url: "https://mcp.apollo.io/mcp",
              categories: ["sales", "productivity"],
              connection_method: "oauth_dynamic_client_registration",
            },
          ],
        });
      }
      if (call.path.endsWith("/mcp/available-tool-groups")) return Response.json({ items: [] });
      if (call.path.endsWith("/mcp/tool-group")) return Response.json({ items: [] });
      if (call.path.endsWith("/mcp/mcp-server")) return Response.json({ items: [] });
      if (call.path.endsWith("/mcp/proxied-mcp-servers")) return Response.json({ items: [] });
      if (call.path.endsWith("/skill")) return Response.json({ items: [] });
      if (call.path.endsWith("/skill-providers")) return Response.json({ items: [] });
      if (call.path.endsWith("/skill-registry")) return Response.json({ items: [] });
      return undefined;
    });

    const response = await app.request("https://openbot.test/api/plugins");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tools: {
        provider: Record<string, unknown>;
        accounts: unknown[];
      }[];
    };
    expect(body.tools).toEqual([
      {
        provider: expect.objectContaining({
          type_id: "managed_mcp:apollo",
          name: "Apollo.io",
          icon_slug: "apollo",
          categories: ["sales", "productivity"],
          credential_sources: [
            expect.objectContaining({
              type_id: "managed_mcp_oauth",
              requires_brokering: true,
            }),
          ],
        }),
        accounts: [],
      },
    ]);
  });

  it("connects a managed MCP provider through its server-authored catalog entry", async () => {
    const { app, calls } = connectorApp((call) => {
      if (call.path.endsWith("/mcp/provider-catalog")) {
        return Response.json({
          items: [
            {
              id: "apollo",
              tool_provider_type_id: "managed_mcp:apollo",
              name: "Apollo.io",
              description: "Search and enrich sales intelligence.",
              endpoint_url: "https://mcp.apollo.io/mcp",
              categories: ["sales", "productivity"],
              connection_method: "oauth_dynamic_client_registration",
            },
          ],
        });
      }
      if (call.path.endsWith("/mcp/provider-catalog/apollo/connect")) {
        return Response.json({
          status: "authorization_required",
          oauth: {
            tool_group_instance: {
              id: "apollo-account",
              display_name: "Sales team",
              status: "pending",
              tool_group_source_type_id: "proxied_mcp_apollo_account",
            },
            broker_response: {
              type: "broker_state",
              action: { Redirect: { url: "https://apollo.test/authorize" } },
            },
          },
        });
      }
      return undefined;
    });

    const response = await app.request("https://openbot.test/api/connectors/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_type_id: "managed_mcp:apollo",
        credential_source_type_id: "managed_mcp_oauth",
        display_name: "Sales team",
        return_url: "https://openbot.test/connectors/authorized",
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      status: "authorize",
      account: { id: "apollo-account", display_name: "Sales team" },
      authorization_url: "https://apollo.test/authorize",
    });
    expect(calls.find((call) => call.path.endsWith("/apollo/connect"))?.body).toEqual({
      display_name: "Sales team",
      return_url: "https://openbot.test/connectors/authorized",
    });
  });

  it("polls a connected managed MCP account through its stable provider identity", async () => {
    const { app } = connectorApp((call) => {
      if (call.path.endsWith("/mcp/proxied-mcp-servers")) {
        return Response.json({
          items: [
            {
              server: {
                id: "proxied-apollo",
                display_name: "Sales team",
                endpoint_configuration: {
                  url: "https://mcp.apollo.io/mcp",
                  catalog_provider_id: "apollo",
                },
                status: "active",
                tool_group_instance_id: "apollo-account",
                tool_group_source_type_id: "proxied_mcp_apollo_account",
              },
              tool_group_instance: {
                id: "apollo-account",
                display_name: "Sales team",
                status: "active",
                tool_group_source_type_id: "proxied_mcp_apollo_account",
                credential_source_type_id: "oauth_auth_flow",
              },
              tool_count: 12,
            },
          ],
        });
      }
      return undefined;
    });

    const response = await app.request(
      "https://openbot.test/api/connectors/accounts?provider=managed_mcp%3Aapollo",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "apollo-account",
          display_name: "Sales team",
          status: "active",
          provider_type_id: "managed_mcp:apollo",
          credential_source_type_id: "oauth_auth_flow",
        },
      ],
    });
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

  it("bulk enables and binds a tool account idempotently while preserving skill assignment", async () => {
    const { app, calls } = connectorApp((call) => {
      const catalog = catalogResponses(call);
      if (catalog) return catalog;
      if (call.path.endsWith("/mcp/mcp-server"))
        return Response.json({ items: [{ id: "openbot-hello-world", tools: [] }] });
      if (call.path.endsWith("/tools/enable-and-bind")) return Response.json({ complete: true });
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
    const retry = await app.request(
      "https://openbot.test/api/plugins/tools/tgi-work/agents/hello-world",
      { method: "POST" },
    );
    expect(retry.status).toBe(200);
    expect(calls.filter((call) => call.path.endsWith("/tools/enable-and-bind"))).toEqual([
      {
        method: "POST",
        path: "/api/v1/team/team-1/mcp/tool-group/tgi-work/tools/enable-and-bind",
        body: {
          all_tools: true,
          tool_source_type_ids: [],
          mcp_server_instance_ids: ["openbot-hello-world"],
        },
      },
      {
        method: "POST",
        path: "/api/v1/team/team-1/mcp/tool-group/tgi-work/tools/enable-and-bind",
        body: {
          all_tools: true,
          tool_source_type_ids: [],
          mcp_server_instance_ids: ["openbot-hello-world"],
        },
      },
    ]);
    expect(calls.some((call) => call.path.includes("/tool/google_mail_search/enable"))).toBe(false);
    expect(
      calls.some((call) => call.path.endsWith("/mcp/mcp-server/openbot-hello-world/function")),
    ).toBe(false);

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

  it("reports an incomplete bulk tool assignment as an upstream failure", async () => {
    const { app } = connectorApp((call) => {
      if (call.path.endsWith("/mcp/mcp-server"))
        return Response.json({ items: [{ id: "openbot-hello-world", tools: [] }] });
      if (call.path.endsWith("/tools/enable-and-bind"))
        return Response.json({ complete: false, failed_tools: ["google_mail_search"] });
      return undefined;
    });

    const response = await app.request(
      "https://openbot.test/api/plugins/tools/tgi-work/agents/hello-world",
      { method: "POST" },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Tilde could not enable and bind every tool",
    });
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

  it("creates an API-key account through one provider-setup call", async () => {
    const { app, calls } = connectorApp(catalogResponses);
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
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/v1/team/team-1/provider-setup/start",
        body: {
          domain: "mcp",
          provider_id: "tavily",
          auth_method_id: "tavily_api_key",
          form_values: { displayName: "Research", api_key: "tvly-secret" },
          return_url: null,
        },
      },
    ]);
  });

  it("returns the brokered authorization URL for OAuth providers", async () => {
    const { app, calls } = connectorApp(catalogResponses);
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
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/team/team-1/provider-setup/start",
        body: expect.objectContaining({
          provider_id: "google_mail",
          return_url: "https://openbot.test/?connector_setup=complete",
        }),
      }),
    ]);
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
