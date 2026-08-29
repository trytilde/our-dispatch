import { describe, expect, it } from "vite-plus/test";
import type { Routine, SignalDelivery } from "@tryopenbot/client-runtime";
import { relativeRunTime } from "./relative-time.js";
import { editableTriggersFrom, routineDraftCommit, routineRunHistory } from "./routine-editor.js";

const routine: Routine = {
  id: "group-1",
  agent_id: "agent-1",
  name: "Deploy watchdog",
  instruction: "Check deploy health",
  enabled: true,
  triggers: [
    {
      id: "t-1",
      kind: "schedule",
      schedule: "0 7 * * *",
    },
    {
      id: "t-2",
      kind: "event",
      instance_id: "spi_1",
      provider_type: "github",
      signal_type: "github.pull_request.opened",
    },
  ],
  last_run_at: "2026-08-20T07:00:00Z",
  last_session_id: "session-9",
  last_error: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-20T07:00:00Z",
};

// Tilde sends matched_trigger_ids empty until event triggers finish matching.
const delivery = (overrides: Partial<SignalDelivery> & { id: string }): SignalDelivery => ({
  instance_id: "spi_1",
  signal_type: "github.pull_request.opened",
  status: "completed",
  matched_trigger_ids: [],
  created_at: "2026-08-22T10:00:00Z",
  ...overrides,
});

describe("routineRunHistory", () => {
  it("merges matched deliveries with the schedule snapshot, newest first", () => {
    const history = routineRunHistory(routine, {
      spi_1: [
        delivery({ id: "d-1", session_id: "session-1", matched_trigger_ids: ["t-2"] }),
        delivery({ id: "d-2", status: "failed_terminal", matched_trigger_ids: ["other-trigger"] }),
        delivery({
          id: "d-3",
          status: "pending",
          created_at: "2026-08-23T10:00:00Z",
          matched_trigger_ids: ["t-2"],
        }),
      ],
    });
    expect(history.map((entry) => entry.id)).toEqual([
      "delivery-d-3",
      "delivery-d-1",
      "schedule-group-1",
    ]);
    expect(history[0]?.status).toBe("running");
    expect(history[2]).toMatchObject({ status: "succeeded", sessionId: "session-9" });
  });

  it("keeps a delivery that has not been matched yet and drops it once it settles", () => {
    const ids = (deliveries: SignalDelivery[]) =>
      routineRunHistory(routine, { spi_1: deliveries }).map((entry) => entry.id);
    expect(ids([delivery({ id: "d-4", status: "pending" })])).toContain("delivery-d-4");
    expect(ids([delivery({ id: "d-4", status: "processing" })])).toContain("delivery-d-4");
    expect(ids([delivery({ id: "d-4", status: "completed" })])).not.toContain("delivery-d-4");
    expect(ids([delivery({ id: "d-4", status: "failed_terminal" })])).not.toContain("delivery-d-4");
  });

  it("marks the schedule snapshot failed when a last error exists", () => {
    const failing = { ...routine, last_error: "boom" };
    const [entry] = routineRunHistory({ ...failing, triggers: [] }, {});
    expect(entry).toMatchObject({ status: "failed", detail: "boom" });
  });
});

describe("editableTriggersFrom", () => {
  it("maps stored triggers onto specs keyed by trigger id", () => {
    expect(editableTriggersFrom(routine)).toEqual([
      { key: "t-1", spec: { kind: "schedule", id: "t-1", schedule: "0 7 * * *" } },
      {
        key: "t-2",
        spec: {
          kind: "event",
          id: "t-2",
          instanceId: "spi_1",
          signalType: "github.pull_request.opened",
          filters: [],
        },
      },
    ]);
  });
});

describe("routineDraftCommit", () => {
  const triggers = [{ key: "k-1", spec: { kind: "schedule", schedule: "0 7 * * *" } as const }];

  it("commits a complete draft with its trigger specs", () => {
    expect(
      routineDraftCommit({ name: " Digest ", instruction: " Summarize ", enabled: true, triggers }),
    ).toEqual({
      name: "Digest",
      instruction: "Summarize",
      enabled: true,
      triggers: [{ kind: "schedule", schedule: "0 7 * * *" }],
    });
  });

  it("holds the draft back while a field or the trigger list is empty", () => {
    expect(
      routineDraftCommit({ name: "Digest", instruction: "Summarize", enabled: true, triggers: [] }),
    ).toBeNull();
    expect(
      routineDraftCommit({ name: " ", instruction: "Summarize", enabled: true, triggers }),
    ).toBeNull();
    expect(
      routineDraftCommit({ name: "Digest", instruction: "", enabled: true, triggers }),
    ).toBeNull();
  });
});

describe("relativeRunTime", () => {
  const now = new Date("2026-08-24T12:00:00");

  it("covers the sentence-cased forms", () => {
    expect(relativeRunTime("2026-08-24T11:59:40", now)).toBe("Just now");
    expect(relativeRunTime("2026-08-24T11:55:00", now)).toBe("5 min ago");
    expect(relativeRunTime("2026-08-24T07:00:00", now)).toBe("Today at 7:00 AM");
    expect(relativeRunTime("2026-03-04T07:00:00", now)).toBe("Mar 4 at 7:00 AM");
    expect(relativeRunTime("2025-03-04T19:30:00", now)).toBe("Mar 4, 2025 at 7:30 PM");
  });
});
