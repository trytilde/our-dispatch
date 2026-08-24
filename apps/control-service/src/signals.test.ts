import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "./app.js";

const providersPage = {
  items: [
    {
      type_id: "github",
      name: "GitHub",
      documentation: "GitHub repository events.",
      instructions: "Point your webhook at {{webhook_url}}.",
      auth_methods: ["webhook"],
      route_descriptors: [{ path: "events", method: "POST", description: "GitHub webhooks" }],
      signal_types: [
        {
          type_id: "github.pull_request.opened",
          name: "Pull request opened",
          documentation: "A pull request was opened.",
          categories: [],
          default_session_key_template: "chat#{{ repository.full_name }}#{{ number }}",
          default_session_title_template: "{{ repository.full_name }}#{{ number }}",
        },
      ],
      credential_sources: [
        {
          type_id: "github_managed",
          name: "Managed",
          requires_brokering: true,
          display_name_description: "Managed GitHub credential",
        },
        {
          type_id: "github_webhook",
          name: "Webhook",
          requires_brokering: false,
          display_name_description: "Name this connection",
        },
      ],
      interpolation_variables: [
        { key: "repository.full_name", description: "Repository", example: "org/repo" },
      ],
    },
  ],
};

const upstreamInstance = {
  id: "spi_existing",
  display_name: "Main GitHub",
  signal_provider_source_type_id: "github",
  credential_source_type_id: "github_webhook",
  status: "enabled",
  ingress_mode: "webhook",
  configuration: { repository: "org/repo", some_secret: "********" },
  polling_state: {},
  poll_interval_seconds: null,
  last_error: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-20T00:00:00Z",
};

interface UpstreamCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: unknown;
}

function signalApp(respond: (call: UpstreamCall) => Response | undefined): {
  app: ReturnType<typeof createApp>;
  calls: UpstreamCall[];
} {
  const calls: UpstreamCall[] = [];
  const fetch = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(input);
    const call: UpstreamCall = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call) ?? new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
  });
  const app = createApp({
    signals: {
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
  if (call.method === "GET" && call.path === "/api/v1/team/team-1/signals/providers")
    return Response.json(providersPage);
  if (call.method === "GET" && call.path === "/api/v1/team/team-1/signals/instances")
    return Response.json({ items: [upstreamInstance], next_page_token: null });
  return undefined;
}

describe("signal routes", () => {
  it("is unavailable without Tilde credentials", async () => {
    const app = createApp({});
    const response = await app.request("https://openbot.test/api/signals/providers");
    expect(response.status).toBe(503);
  });

  it("projects the provider catalog", async () => {
    const { app } = signalApp(catalogResponses);
    const response = await app.request("https://openbot.test/api/signals/providers");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    expect(body.items[0]).toMatchObject({
      type_id: "github",
      name: "GitHub",
      instructions: "Point your webhook at {{webhook_url}}.",
      auth_methods: ["webhook"],
      requires_signing_key: false,
      signing_key_description: null,
      route_path: "events",
    });
    expect(body.items[0]?.signal_types).toEqual([
      {
        type_id: "github.pull_request.opened",
        name: "Pull request opened",
        documentation: "A pull request was opened.",
        categories: [],
        default_session_key_template: "chat#{{ repository.full_name }}#{{ number }}",
        default_session_title_template: "{{ repository.full_name }}#{{ number }}",
      },
    ]);
    expect(body.items[0]?.credential_sources).toEqual([
      {
        type_id: "github_managed",
        name: "Managed",
        requires_brokering: true,
        display_name_description: "Managed GitHub credential",
      },
      {
        type_id: "github_webhook",
        name: "Webhook",
        requires_brokering: false,
        display_name_description: "Name this connection",
      },
    ]);
  });

  it("only requires a signing key when upstream says the provider signs", async () => {
    const { app } = signalApp((call) => {
      if (call.method === "GET" && call.path === "/api/v1/team/team-1/signals/providers")
        return Response.json({
          items: [
            {
              ...providersPage.items[0],
              type_id: "firecrawl",
              webhook_verification: {
                verification_method: "none",
                requires_signing_key: false,
                signing_key_description: null,
              },
            },
            {
              ...providersPage.items[0],
              type_id: "sentry",
              webhook_verification: {
                verification_method: "hmac_sha256",
                requires_signing_key: true,
                signing_key_description: "The client secret",
              },
            },
          ],
        });
      return catalogResponses(call);
    });
    const response = await app.request("https://openbot.test/api/signals/providers");
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    expect(body.items[0]).toMatchObject({
      type_id: "firecrawl",
      requires_signing_key: false,
      signing_key_description: null,
    });
    expect(body.items[1]).toMatchObject({
      type_id: "sentry",
      requires_signing_key: true,
      signing_key_description: "The client secret",
    });
  });

  it("asks upstream for a large page and fails only when it overflows", async () => {
    const instancesPage = (length: number) =>
      Response.json({
        items: Array.from({ length }, (_unused, index) => ({
          ...upstreamInstance,
          id: `spi_${index}`,
        })),
        next_page_token: null,
      });
    const listApp = (length: number) =>
      signalApp((call) => {
        if (call.method === "GET" && call.path === "/api/v1/team/team-1/signals/instances")
          return instancesPage(length);
        return catalogResponses(call);
      });

    // Upstream queries LIMIT page_size + 1, so a full page is 1001 rows.
    const full = listApp(1000);
    const complete = await full.app.request("https://openbot.test/api/signals/instances");
    expect(complete.status).toBe(200);
    const list = full.calls.find((call) => call.path.endsWith("/signals/instances"));
    expect(list?.query.get("page_size")).toBe("1000");

    const response = await listApp(1001).app.request("https://openbot.test/api/signals/instances");
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("maximum 1000 results"),
    });
  });

  it("lists instances with computed webhook URLs and without configuration", async () => {
    const { app } = signalApp(catalogResponses);
    const response = await app.request("https://openbot.test/api/signals/instances");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toEqual([
      {
        id: "spi_existing",
        display_name: "Main GitHub",
        provider_type: "github",
        status: "enabled",
        ingress_mode: "webhook",
        webhook_url: "https://tilde.test/api/v1/webhooks/github-signals-spi_existing/events",
        poll_interval_seconds: null,
        last_error: null,
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-20T00:00:00Z",
      },
    ]);
  });

  it("creates an instance with a pre-generated id and the signing secret in configuration", async () => {
    const { app, calls } = signalApp((call) => {
      if (call.method === "POST" && call.path === "/api/v1/team/team-1/signals/instances") {
        const body = call.body as Record<string, unknown>;
        return Response.json({
          ...upstreamInstance,
          id: body.id,
          display_name: body.display_name,
          configuration: {},
        });
      }
      return catalogResponses(call);
    });
    const response = await app.request("https://openbot.test/api/signals/instances", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_type: "github",
        display_name: "New GitHub",
        signing_secret: "whsec_123",
        configuration: { repository: "org/repo" },
      }),
    });
    expect(response.status).toBe(201);
    const create = calls.find(
      (call) => call.method === "POST" && call.path.endsWith("/signals/instances"),
    );
    const sent = create?.body as Record<string, unknown>;
    expect(sent.id).toMatch(/^spi_[0-9a-f-]{36}$/);
    expect(sent).toMatchObject({
      display_name: "New GitHub",
      signal_provider_source_type_id: "github",
      credential_source_type_id: "github_webhook",
      ingress_mode: "webhook",
      configuration: { repository: "org/repo", provider_webhook_signing_key: "whsec_123" },
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.id).toBe(sent.id);
    expect(body.webhook_url).toBe(
      `https://tilde.test/api/v1/webhooks/github-signals-${sent.id as string}/events`,
    );
    expect(body).not.toHaveProperty("configuration");
  });

  it("read-modify-writes instance updates and rotates the signing secret", async () => {
    const { app, calls } = signalApp((call) => {
      if (
        call.method === "GET" &&
        call.path === "/api/v1/team/team-1/signals/instances/spi_existing"
      )
        return Response.json(upstreamInstance);
      if (
        call.method === "PATCH" &&
        call.path === "/api/v1/team/team-1/signals/instances/spi_existing"
      )
        return Response.json({ ...upstreamInstance, display_name: "Renamed" });
      return catalogResponses(call);
    });
    const response = await app.request("https://openbot.test/api/signals/instances/spi_existing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: "Renamed", signing_secret: "whsec_next" }),
    });
    expect(response.status).toBe(200);
    const update = calls.find((call) => call.method === "PATCH");
    expect(update?.body).toEqual({
      display_name: "Renamed",
      status: "enabled",
      configuration: { repository: "org/repo", provider_webhook_signing_key: "whsec_next" },
      polling_state: {},
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.display_name).toBe("Renamed");
    expect(body).not.toHaveProperty("configuration");
  });

  it("deletes an instance", async () => {
    const { app } = signalApp((call) => {
      if (call.method === "DELETE") return Response.json({ success: true });
      return catalogResponses(call);
    });
    const response = await app.request("https://openbot.test/api/signals/instances/spi_existing", {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
  });

  it("test-fires a signal", async () => {
    const { app, calls } = signalApp((call) => {
      if (call.method === "POST" && call.path.endsWith("/signals/instances/spi_existing/test"))
        return Response.json({ accepted: 1, delivery_ids: ["d-1"] });
      return catalogResponses(call);
    });
    const response = await app.request(
      "https://openbot.test/api/signals/instances/spi_existing/test",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signal_type: "fake.issue.opened", summary: "Test" }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: 1, delivery_ids: ["d-1"] });
    const fire = calls.find((call) => call.path.endsWith("/test"));
    expect(fire?.body).toEqual({ signal_type: "fake.issue.opened", summary: "Test", data: {} });
  });

  it("lists recent deliveries for one instance", async () => {
    const { app, calls } = signalApp((call) => {
      if (call.method === "GET" && call.path === "/api/v1/team/team-1/signals/deliveries")
        return Response.json({
          items: [
            {
              id: "d-1",
              signal_provider_instance_id: "spi_existing",
              signal_type: "github.pull_request.opened",
              summary: "PR opened",
              status: "completed",
              chatkit_session_id: "sess-1",
              error_message: null,
              matched_rule_ids: ["rule-1", "rule-2"],
              created_at: "2026-08-24T09:00:00Z",
            },
            {
              id: "d-2",
              signal_provider_instance_id: "spi_existing",
              signal_type: "github.pull_request.opened",
              summary: null,
              status: "pending",
              chatkit_session_id: null,
              error_message: null,
              created_at: "2026-08-24T09:05:00Z",
            },
          ],
          next_page_token: null,
        });
      return catalogResponses(call);
    });
    const response = await app.request(
      "https://openbot.test/api/signals/deliveries?instance_id=spi_existing",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "d-1",
          instance_id: "spi_existing",
          signal_type: "github.pull_request.opened",
          summary: "PR opened",
          status: "completed",
          session_id: "sess-1",
          error_message: null,
          matched_rule_ids: ["rule-1", "rule-2"],
          created_at: "2026-08-24T09:00:00Z",
        },
        {
          id: "d-2",
          instance_id: "spi_existing",
          signal_type: "github.pull_request.opened",
          summary: null,
          status: "pending",
          session_id: null,
          error_message: null,
          matched_rule_ids: [],
          created_at: "2026-08-24T09:05:00Z",
        },
      ],
    });
    const list = calls.find((call) => call.path.endsWith("/signals/deliveries"));
    expect(list?.query.get("page_size")).toBe("20");
    expect(list?.query.get("instance_id")).toBe("spi_existing");
  });

  it("requires instance_id when listing deliveries", async () => {
    const { app } = signalApp(catalogResponses);
    const response = await app.request("https://openbot.test/api/signals/deliveries");
    expect(response.status).toBe(400);
  });

  it("maps upstream failures onto the response", async () => {
    const { app } = signalApp(
      () => new Response(JSON.stringify({ error: "kaput" }), { status: 500 }),
    );
    const response = await app.request("https://openbot.test/api/signals/providers");
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "kaput" });
  });
});
