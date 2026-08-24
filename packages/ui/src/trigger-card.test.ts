import { describe, expect, it } from "vite-plus/test";
import type {
  RoutineTriggerSpec,
  SignalInstance,
  SignalProvider,
} from "@tryopenbot/client-runtime";
import { providerForSpec, triggerSpecSentence } from "./trigger-card.js";

const github: SignalProvider = {
  type_id: "github",
  name: "GitHub",
  requires_signing_key: true,
  signal_types: [{ type_id: "github.release.published", name: "Release published" }],
};

const providers = [github];

const instance: SignalInstance = {
  id: "spi_1",
  display_name: "GitHub connection",
  provider_type: "github",
  status: "enabled",
  ingress_mode: "webhook",
  created_at: "2026-08-24T07:00:00Z",
  updated_at: "2026-08-24T07:00:00Z",
};

describe("providerForSpec", () => {
  it("resolves the provider from the trigger's connection", () => {
    expect(
      providerForSpec(
        { kind: "event", instanceId: "spi_1", signalType: "github.issue.opened", filters: [] },
        providers,
        [instance],
      ),
    ).toBe(github);
  });

  it("keeps signal types outside the curated lists resolvable", () => {
    const spec: RoutineTriggerSpec = {
      kind: "event",
      instanceId: "spi_missing",
      signalType: "github.release.published",
      filters: [],
    };
    expect(providerForSpec(spec, providers)).toBe(github);
    expect(triggerSpecSentence(spec, providers).lead).toBe("GitHub");
  });
});
