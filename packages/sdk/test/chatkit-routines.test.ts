import { describe, expect, it, vi } from "vite-plus/test";
import { createClient } from "../src";

const rawRoutine = {
  id: "11111111-1111-4111-8111-111111111111",
  org_id: "org-one",
  team_id: "team-one",
  agent_inbox_id: "factory",
  title: "Weekly review",
  prompt: "Review changes and report only meaningful updates.",
  schedule: "0 9 * * 1",
  schedule_description: "Mondays at 09:00 UTC",
  enabled: true,
  next_run_at: "2026-09-07T09:00:00Z",
  created_at: "2026-09-01T09:00:00Z",
  updated_at: "2026-09-01T09:00:00Z",
};

describe("ChatKitRoutinesClient", () => {
  it("binds the authored agent and exposes lifecycle helpers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(rawRoutine))
      .mockResolvedValueOnce(Response.json({ ...rawRoutine, enabled: false }))
      .mockResolvedValueOnce(Response.json({ deleted: true }));
    const routines = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    }).chatkit.routines("factory");

    const created = await routines.create({
      title: rawRoutine.title,
      prompt: rawRoutine.prompt,
      schedule: rawRoutine.schedule,
    });
    await routines.pause(created.id);
    await routines.delete(created.id);

    expect(created).toMatchObject({
      agentId: "factory",
      scheduleDescription: rawRoutine.schedule_description,
    });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(requestBody(calls[0]![1].body))).toMatchObject({
      agent_inbox_id: "factory",
      enabled: true,
    });
    expect(JSON.parse(requestBody(calls[1]![1].body))).toMatchObject({ enabled: false });
    expect(calls[2]![1].method).toBe("DELETE");
  });

  it("filters team pagination to the bound agent", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        items: [rawRoutine, { ...rawRoutine, id: "other", agent_inbox_id: "other-agent" }],
        next_page_token: "next",
      }),
    );
    const routines = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    }).chatkit.routines("factory");

    const page = await routines.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.agentId).toBe("factory");
    expect(page.nextPageToken).toBe("next");
  });
});

function requestBody(body: RequestInit["body"]): string {
  if (typeof body !== "string") throw new TypeError("Expected a string request body");
  return body;
}
