import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "./app.js";

const providersPage = {
  items: [
    {
      type_id: "google_mail",
      name: "Google Mail",
      metadata: { icon_url: "https://icons.tilde.test/google-mail.svg" },
      categories: ["email"],
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

function connectorApp(respond: (call: UpstreamCall) => Response | undefined): {
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
    },
  });
  return { app, calls };
}

function catalogResponses(call: UpstreamCall): Response | undefined {
  if (call.path === "/api/v1/team/team-1/mcp/available-tool-groups")
    return Response.json(providersPage);
  if (call.path === "/api/v1/team/team-1/mcp/tool-group") return Response.json(accountsPage);
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
    expect(body.items[0]).toMatchObject({ icon_url: "https://icons.tilde.test/google-mail.svg" });
    expect(body.items[1]).not.toHaveProperty("icon_url");
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
