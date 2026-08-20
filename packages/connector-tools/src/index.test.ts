import { describe, expect, it, vi } from "vite-plus/test";
import { createConfigureConnectorTool } from "./index.js";

const providersPage = {
  items: [
    {
      type_id: "google_mail",
      name: "Google Mail",
      credential_sources: [
        {
          type_id: "google_mail_managed_oauth",
          name: "managed_oauth",
          display_name: "Sign in with your browser",
          requires_brokering: true,
          supports_auto_display_name: true,
          configuration_schema: { resource_server: {}, user_credential: {} },
        },
      ],
    },
    { type_id: "stripe", name: "Stripe", credential_sources: [] },
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
      id: "tgi-stripe",
      display_name: "Stripe live",
      status: "active",
      tool_group_source_type_id: "stripe",
    },
  ],
};

function stubFetch() {
  return vi.fn(async (input: URL | string) => {
    const url = input instanceof URL ? input : new URL(input);
    if (url.pathname.endsWith("/mcp/available-tool-groups")) return Response.json(providersPage);
    if (url.pathname.endsWith("/mcp/tool-group")) return Response.json(accountsPage);
    return new Response("not found", { status: 404 });
  });
}

function toolOptions(fetch: unknown) {
  return {
    apiKey: "test-key",
    orgId: "org-1",
    teamId: "team-1",
    baseUrl: "https://tilde.test",
    fetch: fetch as typeof globalThis.fetch,
  };
}

type ExecutableTool = { execute: (input: unknown, context: unknown) => Promise<unknown> };

describe("createConfigureConnectorTool", () => {
  it("emits a selection payload with only the provider's accounts", async () => {
    const fetch = stubFetch();
    const tool = createConfigureConnectorTool(toolOptions(fetch)) as unknown as ExecutableTool;
    const result = (await tool.execute(
      { provider_type_id: "google_mail", prompt: "Send the weekly report" },
      {},
    )) as Record<string, unknown>;

    expect(result.status).toBe("selection_required");
    expect(String(result.instructions)).toContain("end your turn");
    const selection = result.connector_selection as Record<string, unknown>;
    expect(selection.provider_type_id).toBe("google_mail");
    expect(selection.provider_name).toBe("Google Mail");
    expect(selection.prompt).toBe("Send the weekly report");
    expect(selection.accounts).toEqual([
      {
        id: "tgi-work",
        display_name: "Work Gmail",
        status: "active",
        credential_source_type_id: "google_mail_managed_oauth",
      },
    ]);
    const sources = selection.credential_sources as Record<string, unknown>[];
    expect(sources[0]).toMatchObject({
      type_id: "google_mail_managed_oauth",
      name: "Sign in with your browser",
      requires_brokering: true,
      supports_auto_display_name: true,
    });
    const teamPaths = fetch.mock.calls.map((call) => (call[0] as URL).pathname);
    expect(teamPaths.every((path) => path.startsWith("/api/v1/team/team-1/"))).toBe(true);
  });

  it("matches a provider by display name when the type id is imprecise", async () => {
    const tool = createConfigureConnectorTool(
      toolOptions(stubFetch()),
    ) as unknown as ExecutableTool;
    const result = (await tool.execute({ provider_type_id: "Stripe" }, {})) as Record<
      string,
      unknown
    >;
    expect((result.connector_selection as { provider_type_id: string }).provider_type_id).toBe(
      "stripe",
    );
  });

  it("returns the known catalog when the provider does not exist", async () => {
    const tool = createConfigureConnectorTool(
      toolOptions(stubFetch()),
    ) as unknown as ExecutableTool;
    const result = (await tool.execute({ provider_type_id: "does_not_exist" }, {})) as Record<
      string,
      unknown
    >;
    expect(result.status).toBe("unknown_provider");
    expect(result.known_provider_type_ids).toEqual(["google_mail", "stripe"]);
    expect(String(result.instructions)).toContain("tilde_search_available_capabilities");
  });

  it("surfaces upstream failures instead of inventing a payload", async () => {
    const failing = vi.fn(async () => new Response("boom", { status: 500 }));
    const tool = createConfigureConnectorTool(
      toolOptions(failing as unknown as typeof globalThis.fetch),
    ) as unknown as ExecutableTool;
    await expect(tool.execute({ provider_type_id: "google_mail" }, {})).rejects.toThrow(
      "Tilde request failed (500)",
    );
  });
});
