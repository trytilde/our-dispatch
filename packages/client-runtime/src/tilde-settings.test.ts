import { describe, expect, it, vi } from "vite-plus/test";
import { createTildeRoutineClient, createTildeSignalClient } from "./tilde-settings.js";

const automation = {
  id: "29fcfbfb-6de3-4b6b-bc35-a1bbf15e923b",
  agent_id: "inbox-1",
  name: "Deploy watchdog",
  instruction: "Check deploy health",
  enabled: true,
  version: 4,
  metadata: { source: "openbot" },
  status: "active",
  generation: 3,
  applied_generation: 3,
  error_message: null,
  last_run_at: "2026-08-26T07:00:00Z",
  last_session_id: "session-1",
  last_error: "last execution failed",
  authorization: { visibility: "private" },
  triggers: [
    {
      id: "schedule-1",
      kind: "schedule",
      enabled: true,
      schedule: "0 7 * * *",
      metadata: { color: "blue" },
      schedule_description: "Daily at 07:00 UTC",
      next_run_at: "2026-08-27T07:00:00Z",
      materialized_resource_id: "routine-1",
    },
    {
      id: "event-1",
      kind: "event",
      enabled: true,
      signal_provider_instance_id: "spi_abc",
      signal_type: "github.pull_request.opened",
      filter: { json_equals: [{ path: "pull_request.draft", value: false }] },
      session_policy: { type: "session_key_template", template: "repo#{{name}}" },
      action: { type: "invoke_chatkit_agent", agent_inbox_id: "inbox-1" },
      instruction_policy: "signal_only",
      materialized_resource_id: "rule-1",
    },
  ],
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-21T00:00:00Z",
};

describe("Tilde settings clients", () => {
  it("pages and projects native Tilde automations without an OpenBot routine API", async () => {
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ items: [automation], next_page_token: "page-2" })
      .mockResolvedValueOnce({ items: [], next_page_token: null });
    const client = createTildeRoutineClient({ requestJson });

    const routines = await client.listRoutines("inbox-1");

    expect(requestJson).toHaveBeenNthCalledWith(
      1,
      "/api/tilde/automations?agent_id=inbox-1&page_size=100",
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "/api/tilde/automations?agent_id=inbox-1&page_size=100&next_page_token=page-2",
    );
    expect(routines[0]).toMatchObject({
      id: automation.id,
      agent_id: "inbox-1",
      status: "active",
      triggers: [
        { id: "schedule-1", kind: "schedule" },
        { id: "event-1", kind: "event", instance_id: "spi_abc" },
      ],
    });
  });

  it("preserves native trigger configuration and optimistic version while replacing a Routine", async () => {
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce(automation)
      .mockResolvedValueOnce(automation)
      .mockResolvedValueOnce({ items: [automation], next_page_token: null });
    const client = createTildeRoutineClient({ requestJson });

    await client.updateRoutine(automation.id, "inbox-1", { name: "Renamed" });

    const [, request] = requestJson.mock.calls[1] ?? [];
    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      `/api/tilde/automations/${automation.id}`,
      expect.objectContaining({ method: "PUT" }),
    );
    expect(JSON.parse(String(request?.body))).toMatchObject({
      expected_version: 4,
      metadata: { source: "openbot" },
      triggers: [
        { id: "schedule-1", enabled: true, metadata: { color: "blue" } },
        {
          id: "event-1",
          action: { type: "invoke_chatkit_agent", agent_inbox_id: "inbox-1" },
          instruction_policy: "signal_only",
          session_policy: { type: "session_key_template", template: "repo#{{name}}" },
        },
      ],
    });
  });

  it("projects native signal resources and never returns configuration secrets", async () => {
    const provider = {
      type_id: "github",
      name: "GitHub",
      route_descriptors: [{ path: "events" }],
      signal_types: [],
      credential_sources: [
        { type_id: "github_webhook", name: "Webhook", requires_brokering: false },
      ],
    };
    const instance = {
      id: "spi_existing",
      display_name: "Main GitHub",
      signal_provider_source_type_id: "github",
      status: "enabled",
      ingress_mode: "webhook",
      configuration: { signing_secret: "********" },
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-20T00:00:00Z",
    };
    const secondInstance = { ...instance, id: "spi_second", display_name: "Backup GitHub" };
    const requestJson = vi.fn(async (path: string) => {
      if (path === "/api/tilde/signals/providers?page_size=100")
        return { items: [provider], next_page_token: null };
      if (path === "/api/tilde/signals/instances?page_size=100")
        return { items: [instance], next_page_token: "instances-2" };
      if (path === "/api/tilde/signals/instances?page_size=100&next_page_token=instances-2")
        return { items: [secondInstance], next_page_token: null };
      throw new Error(`Unexpected request ${path}`);
    });
    const client = createTildeSignalClient({ requestJson, apiBaseUrl: "https://tilde.test" });

    const instances = await client.listSignalInstances();

    expect(instances).toEqual([
      expect.objectContaining({
        id: "spi_existing",
        webhook_url: "https://tilde.test/api/v1/webhooks/github-signals-spi_existing/events",
      }),
      expect.objectContaining({ id: "spi_second" }),
    ]);
    expect(instances[0]).not.toHaveProperty("configuration");
  });

  it("drops redacted signal values before rotating a signing secret", async () => {
    const provider = {
      type_id: "github",
      route_descriptors: [{ path: "events" }],
      signal_types: [],
      credential_sources: [],
    };
    const existing = {
      id: "spi_existing",
      display_name: "GitHub",
      signal_provider_source_type_id: "github",
      status: "enabled",
      ingress_mode: "webhook",
      configuration: { repository: "org/repo", old_secret: "********" },
      polling_state: {},
    };
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, display_name: "Renamed" })
      .mockResolvedValueOnce({ items: [provider] });
    const client = createTildeSignalClient({ requestJson });

    await client.updateSignalInstance("spi_existing", {
      displayName: "Renamed",
      signingSecret: "whsec_next",
    });

    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "/api/tilde/signals/instances/spi_existing",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          display_name: "Renamed",
          status: "enabled",
          configuration: {
            repository: "org/repo",
            provider_webhook_signing_key: "whsec_next",
          },
          polling_state: {},
        }),
      }),
    );
  });

  it("projects native Routine trigger progress and accepts pre-migration rule ids", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      items: [
        {
          id: "delivery-native",
          matched_trigger_ids: ["trigger-1"],
          created_at: "2026-08-29T00:00:00Z",
        },
        {
          id: "delivery-legacy",
          matched_rule_ids: ["legacy-rule-1"],
          created_at: "2026-08-28T00:00:00Z",
        },
      ],
    });
    const client = createTildeSignalClient({ requestJson });

    const deliveries = await client.listSignalDeliveries("spi_existing");

    expect(deliveries.map((delivery) => delivery.matched_trigger_ids)).toEqual([
      ["trigger-1"],
      ["legacy-rule-1"],
    ]);
  });
});
