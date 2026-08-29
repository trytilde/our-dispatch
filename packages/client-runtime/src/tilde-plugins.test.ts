import { describe, expect, it, vi } from "vite-plus/test";
import { createTildePluginsClient } from "./tilde-plugins.js";

describe("Tilde plugin client", () => {
  it("loads and exhausts native Tilde resource pages", async () => {
    const requestJson = vi.fn(async (path: string) => {
      if (path.startsWith("/api/tilde/mcp/available-tool-groups?"))
        return path.includes("next_page_token=providers-2")
          ? { items: [{ type_id: "google_mail", name: "Google Mail" }] }
          : {
              items: [{ type_id: "github", name: "GitHub" }],
              next_page_token: "providers-2",
            };
      if (path === "/api/tilde/skill-providers") return { items: [] };
      if (path === "/api/tilde/mcp/provider-catalog") return { items: [] };
      return { items: [] };
    });
    const client = createTildePluginsClient(requestJson);

    await expect(client.getPluginsCatalog()).resolves.toMatchObject({
      tools: [{ provider: { type_id: "github" } }, { provider: { type_id: "google_mail" } }],
    });
    expect(requestJson).toHaveBeenCalledWith(
      "/api/tilde/mcp/available-tool-groups?deployment_alias=latest&include_global=true&page_size=100",
    );
    expect(requestJson).toHaveBeenCalledWith(
      "/api/tilde/mcp/available-tool-groups?deployment_alias=latest&include_global=true&page_size=100&next_page_token=providers-2",
    );
    expect(requestJson).not.toHaveBeenCalledWith("/api/tilde/openbot/plugins/catalog");
  });

  it("uses provider setup directly for ordinary connectors", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      resource: {
        id: "github-work",
        display_name: "Work",
        status: "active",
        tool_group_source_type_id: "github",
      },
      next_action: { type: "complete" },
    });
    const client = createTildePluginsClient(requestJson);

    await expect(
      client.createNativeConnectorAccount({
        providerTypeId: "github",
        credentialSourceTypeId: "github_api_key",
        displayName: "Work",
        resourceServerValues: { api_key: "secret" },
      }),
    ).resolves.toMatchObject({ status: "created", account: { id: "github-work" } });
    expect(requestJson).toHaveBeenCalledWith(
      "/api/tilde/provider-setup/start",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"provider_id":"github"'),
      }),
    );
  });

  it("uses Tilde's managed connection API for dynamic OAuth providers", async () => {
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            id: "notion",
            name: "Notion",
            connection_method: "oauth_dynamic_client_registration",
          },
        ],
      })
      .mockResolvedValueOnce({
        status: "authorization_required",
        oauth: {
          tool_group_instance: { id: "notion-work", display_name: "Work", status: "pending" },
          broker_response: { type: "redirect", url: "https://notion.test/authorize" },
        },
      });
    const client = createTildePluginsClient(requestJson);

    await expect(
      client.createNativeConnectorAccount({
        providerTypeId: "managed_mcp:notion",
        credentialSourceTypeId: "managed_mcp_oauth",
        displayName: "Work",
        returnUrl: "https://openbot.test/connectors/authorized",
      }),
    ).resolves.toEqual({
      status: "authorize",
      account: {
        id: "notion-work",
        display_name: "Work",
        status: "pending",
        provider_type_id: "managed_mcp:notion",
      },
      authorization_url: "https://notion.test/authorize",
    });
    expect(requestJson).toHaveBeenLastCalledWith(
      "/api/tilde/mcp/provider-catalog/notion/connect",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("encrypts manual managed API keys with the authenticated Tilde team", async () => {
    const calls: Array<{ path: string; body?: string }> = [];
    const requestJson = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      if (path === "/api/tilde/mcp/provider-catalog")
        return {
          items: [
            {
              id: "sentry",
              name: "Sentry",
              connection_method: "manual",
              suggested_auth_mode: "bearer_token",
              endpoint_url: "https://mcp.sentry.dev",
            },
          ],
        };
      if (path === "/auth/session")
        return {
          authenticated: true,
          tilde: { team_id: "team-one", api_base_url: "https://tilde.test" },
          user: { subject: "human-one", name: "Daniel" },
        };
      if (path.endsWith("/encrypt")) return { ciphertext: "encrypted" };
      if (path.endsWith("/resource-server")) return { id: "credential-one" };
      if (path === "/api/tilde/mcp/proxied-mcp-servers")
        return {
          tool_group_instance: { id: "sentry-work", display_name: "Work", status: "active" },
        };
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = createTildePluginsClient(requestJson);

    await expect(
      client.createNativeConnectorAccount({
        providerTypeId: "managed_mcp:sentry",
        credentialSourceTypeId: "api_key",
        displayName: "Work",
        resourceServerValues: { api_key: "secret" },
      }),
    ).resolves.toMatchObject({ status: "created", account: { id: "sentry-work" } });
    expect(calls.find((call) => call.path.endsWith("/encrypt"))?.body).toContain(
      '"dek_alias":"team:team-one:default"',
    );
    expect(
      calls.find((call) => call.path === "/api/tilde/mcp/proxied-mcp-servers")?.body,
    ).toContain('"resource_server_credential_id":"credential-one"');
  });
});
