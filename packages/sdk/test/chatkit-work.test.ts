import { describe, expect, it, vi } from "vite-plus/test";
import { createClient } from "../src";

const rawGoal = {
  id: "11111111-1111-4111-8111-111111111111",
  org_id: "org-one",
  team_id: "team-one",
  session_id: "22222222-2222-4222-8222-222222222222",
  agent_id: "factory",
  objective: "Ship the feature",
  status: "active",
  created_at: "2026-09-01T09:00:00Z",
  updated_at: "2026-09-01T09:00:00Z",
};

const rawTask = {
  id: "33333333-3333-4333-8333-333333333333",
  org_id: "org-one",
  team_id: "team-one",
  session_id: rawGoal.session_id,
  agent_id: "factory",
  goal_id: rawGoal.id,
  dependency_task_ids: [],
  summary: "Implement it",
  status: "submitted",
  metadata: {},
  created_at: "2026-09-01T09:01:00Z",
  updated_at: "2026-09-01T09:01:00Z",
};

describe("ChatKitWorkClient", () => {
  it("binds agent and session in the path rather than mutation bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(rawGoal))
      .mockResolvedValueOnce(Response.json(rawTask));
    const client = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    });
    const work = client.chatkit.work({ agentId: "factory", sessionId: rawGoal.session_id });

    const goal = await work.goals.create({ objective: "Ship the feature" });
    const task = await work.tasks.create({ summary: "Implement it", goalId: goal.id });

    expect(goal).toMatchObject({ agentId: "factory", sessionId: rawGoal.session_id });
    expect(task).toMatchObject({ goalId: rawGoal.id, dependencyTaskIds: [] });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const [goalUrl, goalInit] = calls[0]!;
    const goalBody = typeof goalInit.body === "string" ? goalInit.body : "";
    expect(goalUrl).toContain(`/chatkit/agents/factory/sessions/${rawGoal.session_id}/goals`);
    expect(JSON.parse(goalBody)).toEqual({ objective: "Ship the feature" });
    expect(goalBody).not.toContain("agent_id");
    expect(goalBody).not.toContain("session_id");
  });

  it("provides typed progress and terminal helpers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...rawGoal, status: "completed", progress_percent: 100 }),
      )
      .mockResolvedValueOnce(
        Response.json({ ...rawTask, status: "failed", status_reason: "blocked" }),
      );
    const client = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    });
    const work = client.chatkit.work({ agentId: "factory", sessionId: rawGoal.session_id });

    await work.goals.complete(rawGoal.id, "Delivered");
    await work.tasks.fail(rawTask.id, "blocked");

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const firstBody = calls[0]?.[1].body;
    const secondBody = calls[1]?.[1].body;
    expect(JSON.parse(typeof firstBody === "string" ? firstBody : "")).toMatchObject({
      status: "completed",
      progress_percent: 100,
      progress_note: "Delivered",
    });
    expect(JSON.parse(typeof secondBody === "string" ? secondBody : "")).toMatchObject({
      status: "failed",
      status_reason: "blocked",
    });
  });

  it("lists with scoped filters and maps pagination", async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
      Response.json({ items: [rawTask], next_page_token: "next" }),
    );
    const client = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    });
    const work = client.chatkit.work({ agentId: "factory", sessionId: rawGoal.session_id });

    const page = await work.tasks.list({ goalId: rawGoal.id, status: "submitted" });

    expect(page).toMatchObject({ nextPageToken: "next", items: [{ id: rawTask.id }] });
    const requestedUrl = fetchMock.mock.calls[0]?.[0];
    const requestedUrlString =
      typeof requestedUrl === "string"
        ? requestedUrl
        : requestedUrl instanceof URL
          ? requestedUrl.href
          : requestedUrl?.url;
    expect(requestedUrlString).toContain(`goal_id=${rawGoal.id}`);
    expect(requestedUrlString).toContain("status=submitted");
  });
});
