import { describe, expect, it } from "vite-plus/test";
import {
  DeleteSignalInstanceResultSchema,
  SignalDeliveryListSchema,
  SignalDeliverySchema,
  SignalInstanceListSchema,
  SignalInstanceSchema,
  signalProviderById,
  SignalProviderListSchema,
  SignalProviderSchema,
  TestSignalInstanceResultSchema,
  type SignalProvider,
} from "./signals.js";

const provider = {
  type_id: "github",
  name: "GitHub",
  documentation: "GitHub webhooks",
  instructions: "Point the webhook at {{webhook_url}}.",
  auth_methods: ["webhook"],
  requires_signing_key: true,
  signing_key_description: "The webhook secret",
  route_path: "events",
  signal_types: [
    {
      type_id: "github.pull_request.opened",
      name: "Pull request opened",
      categories: [],
      default_session_key_template: "{{repository.full_name}}",
      default_session_title_template: null,
    },
  ],
  credential_sources: [
    {
      type_id: "github_pat",
      name: "Personal access token",
      requires_brokering: false,
      display_name_description: "A name for this connection",
    },
  ],
  interpolation_variables: [
    { key: "webhook_url", description: "Ingress URL", example: "https://…" },
  ],
} satisfies SignalProvider;

const instance = {
  id: "spi_1",
  display_name: "Acme GitHub",
  provider_type: "github",
  status: "enabled",
  ingress_mode: "webhook",
  webhook_url: "https://tilde.test/api/v1/webhooks/github-signals-spi_1/events",
  poll_interval_seconds: null,
  last_error: null,
  created_at: "2026-08-24T00:00:00Z",
  updated_at: "2026-08-24T00:00:00Z",
};

const delivery = {
  id: "del-1",
  instance_id: "spi_1",
  signal_type: "github.pull_request.opened",
  summary: "PR #1 opened",
  status: "completed",
  session_id: "session-one",
  error_message: null,
  matched_rule_ids: ["rule-1"],
  created_at: "2026-08-24T00:00:00Z",
};

describe("signal contracts", () => {
  it("parses the provider catalog projection and preserves unknown fields", () => {
    const parsed = SignalProviderSchema.parse({ ...provider, extra: "kept" });
    expect(parsed.signal_types[0]?.name).toBe("Pull request opened");
    expect((parsed as Record<string, unknown>).extra).toBe("kept");
    expect(SignalProviderListSchema.parse({ items: [provider] }).items).toHaveLength(1);
  });

  it("parses instances, deliveries, and result envelopes", () => {
    expect(SignalInstanceSchema.parse(instance).webhook_url).toContain("spi_1");
    expect(SignalInstanceListSchema.parse({ items: [instance] }).items[0]?.status).toBe("enabled");
    expect(SignalDeliverySchema.parse(delivery).summary).toBe("PR #1 opened");
    expect(SignalDeliverySchema.parse(delivery).matched_rule_ids).toEqual(["rule-1"]);
    const { matched_rule_ids: _matched, ...withoutRules } = delivery;
    expect(SignalDeliverySchema.parse(withoutRules).matched_rule_ids).toBeUndefined();
    expect(SignalDeliveryListSchema.parse({ items: [delivery] }).items).toHaveLength(1);
    expect(TestSignalInstanceResultSchema.parse({ accepted: 1, delivery_ids: ["del-1"] })).toEqual({
      accepted: 1,
      delivery_ids: ["del-1"],
    });
    expect(DeleteSignalInstanceResultSchema.parse({ deleted: true }).deleted).toBe(true);
  });

  it("rejects instances missing required identity", () => {
    expect(SignalInstanceSchema.safeParse({ ...instance, id: "" }).success).toBe(false);
  });
});

describe("signalProviderById", () => {
  it("finds a provider by type id", () => {
    expect(signalProviderById([provider], "github")?.name).toBe("GitHub");
    expect(signalProviderById([provider], "slack")).toBeUndefined();
  });
});
