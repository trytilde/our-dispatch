import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "./app.js";

const stampedRoutine = {
  id: "tr-1",
  agent_inbox_id: "inbox-1",
  title: "Deploy watchdog",
  prompt: "Check deploy health",
  schedule: "0 7 * * *",
  schedule_description: "Daily at 07:00 UTC",
  enabled: true,
  next_run_at: "2026-08-25T07:00:00Z",
  last_run_at: "2026-08-24T07:00:00Z",
  last_session_id: "sess-9",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-20T00:00:00Z",
  metadata: { openbot: { group: "g1", trigger: "t1" } },
};

const unstampedRoutine = {
  id: "tr-plain",
  agent_inbox_id: "inbox-1",
  title: "Not ours",
  prompt: "x",
  schedule: "* * * * *",
  enabled: true,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const otherAgentRoutine = {
  ...stampedRoutine,
  id: "tr-other",
  agent_inbox_id: "inbox-2",
  metadata: { openbot: { group: "g9", trigger: "t9" } },
};

const stampedRule = {
  id: "rule-1",
  signal_provider_instance_id: "spi_abc",
  display_name: "Deploy watchdog",
  status: "disabled",
  signal_type: "github.pull_request.opened",
  filter: { json_equals: [{ path: "pull_request.draft", value: false }] },
  session_policy: { type: "new_session_per_delivery", title_template: "Deploy watchdog" },
  action: { type: "invoke_chatkit_agent", agent_inbox_id: "inbox-1" },
  created_at: "2026-08-02T00:00:00Z",
  updated_at: "2026-08-21T00:00:00Z",
  metadata: { openbot: { group: "g1", trigger: "t2", instruction: "Check deploy health" } },
};

const unstampedRule = {
  id: "rule-plain",
  signal_provider_instance_id: "spi_abc",
  display_name: "Not ours",
  status: "enabled",
  signal_type: "github.issue.opened",
  action: { type: "invoke_chatkit_agent", agent_inbox_id: "inbox-1" },
  created_at: "2026-08-02T00:00:00Z",
  updated_at: "2026-08-02T00:00:00Z",
};

const providersPage = {
  items: [
    {
      type_id: "github",
      name: "GitHub",
      auth_methods: ["webhook"],
      route_descriptors: [{ path: "events", method: "POST", description: "GitHub webhooks" }],
      signal_types: [
        {
          type_id: "github.pull_request.opened",
          name: "Pull request opened",
          default_session_key_template: "chat#{{ repository.full_name }}#{{ number }}",
          default_session_title_template: "{{ repository.full_name }}#{{ number }}",
        },
        {
          type_id: "github.issue.opened",
          name: "Issue opened",
          default_session_key_template: "",
          default_session_title_template: null,
        },
      ],
      credential_sources: [],
      interpolation_variables: [],
    },
  ],
};

interface UpstreamCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: unknown;
}

function routineApp(respond: (call: UpstreamCall) => Response | undefined): {
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
    routines: {
      apiKey: "key",
      orgId: "org-1",
      teamId: "team-1",
      baseUrl: "https://tilde.test",
      fetch: fetch as unknown as typeof globalThis.fetch,
    },
  });
  return { app, calls };
}

function listResponses(call: UpstreamCall): Response | undefined {
  if (call.method !== "GET") return undefined;
  if (call.path === "/api/v1/team/team-1/chatkit/routines")
    return Response.json({
      items: [stampedRoutine, unstampedRoutine, otherAgentRoutine],
      next_page_token: null,
    });
  if (call.path === "/api/v1/team/team-1/signals/rules")
    return Response.json({ items: [stampedRule, unstampedRule], next_page_token: null });
  if (call.path === "/api/v1/team/team-1/signals/providers") return Response.json(providersPage);
  return undefined;
}

describe("routine routes", () => {
  it("is unavailable without Tilde credentials", async () => {
    const app = createApp({});
    const response = await app.request("https://openbot.test/api/routines?agent_id=inbox-1");
    expect(response.status).toBe(503);
  });

  it("requires agent_id", async () => {
    const { app } = routineApp(listResponses);
    const response = await app.request("https://openbot.test/api/routines");
    expect(response.status).toBe(400);
  });

  it("groups stamped routines and rules and ignores unstamped resources", async () => {
    const { app } = routineApp(listResponses);
    const response = await app.request("https://openbot.test/api/routines?agent_id=inbox-1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: "g1",
      agent_id: "inbox-1",
      name: "Deploy watchdog",
      instruction: "Check deploy health",
      enabled: true,
      last_run_at: "2026-08-24T07:00:00Z",
      last_session_id: "sess-9",
      last_error: null,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-21T00:00:00Z",
    });
    expect(body.items[0]?.triggers).toEqual([
      {
        id: "t1",
        kind: "schedule",
        schedule: "0 7 * * *",
        description: "Daily at 07:00 UTC",
        next_run_at: "2026-08-25T07:00:00Z",
        routine_id: "tr-1",
      },
      {
        id: "t2",
        kind: "event",
        instance_id: "spi_abc",
        provider_type: "github",
        signal_type: "github.pull_request.opened",
        filters: [{ path: "pull_request.draft", value: false }],
        rule_id: "rule-1",
      },
    ]);
  });

  it("walks routine pages with next_page_token", async () => {
    const { app, calls } = routineApp((call) => {
      if (call.path === "/api/v1/team/team-1/chatkit/routines") {
        if (!call.query.get("next_page_token"))
          return Response.json({ items: [stampedRoutine], next_page_token: "page-2" });
        return Response.json({ items: [], next_page_token: null });
      }
      if (call.path === "/api/v1/team/team-1/signals/rules")
        return Response.json({ items: [], next_page_token: null });
      return undefined;
    });
    const response = await app.request("https://openbot.test/api/routines?agent_id=inbox-1");
    expect(response.status).toBe(200);
    const routineCalls = calls.filter((call) => call.path.endsWith("/chatkit/routines"));
    expect(routineCalls).toHaveLength(2);
    expect(routineCalls[0]?.query.get("page_size")).toBe("100");
    expect(routineCalls[1]?.query.get("next_page_token")).toBe("page-2");
  });

  it("creates members sequentially with stamped metadata and a session policy from the catalog", async () => {
    const { app, calls } = routineApp((call) => {
      if (call.method === "POST" && call.path === "/api/v1/team/team-1/chatkit/routines")
        return Response.json({ ...stampedRoutine, id: "tr-new" });
      if (call.method === "POST" && call.path === "/api/v1/team/team-1/signals/rules")
        return Response.json({ ...stampedRule, id: "rule-new" });
      return listResponses(call);
    });
    const response = await app.request("https://openbot.test/api/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "inbox-1",
        name: "Deploy watchdog",
        instruction: "Check deploy health",
        triggers: [
          { kind: "schedule", schedule: "0 7 * * *" },
          {
            kind: "event",
            instance_id: "spi_abc",
            signal_type: "github.pull_request.opened",
            filters: [{ path: "pull_request.draft", value: false }],
          },
        ],
      }),
    });
    expect(response.status).toBe(201);
    const routineCreate = calls.find(
      (call) => call.method === "POST" && call.path.endsWith("/chatkit/routines"),
    );
    const ruleCreate = calls.find(
      (call) => call.method === "POST" && call.path.endsWith("/signals/rules"),
    );
    expect(routineCreate?.body).toMatchObject({
      agent_inbox_id: "inbox-1",
      title: "Deploy watchdog",
      prompt: "Check deploy health",
      schedule: "0 7 * * *",
      enabled: true,
    });
    const stampOf = (call: UpstreamCall | undefined): Record<string, string> =>
      ((call?.body as { metadata?: { openbot?: unknown } } | undefined)?.metadata?.openbot ??
        {}) as Record<string, string>;
    const routineStamp = stampOf(routineCreate);
    const ruleStamp = stampOf(ruleCreate);
    expect(routineStamp.group).toMatch(/^[0-9a-f-]{36}$/);
    expect(ruleStamp.group).toBe(routineStamp.group);
    expect(ruleStamp.trigger).not.toBe(routineStamp.trigger);
    expect(ruleStamp.instruction).toBe("Check deploy health");
    expect(ruleCreate?.body).toMatchObject({
      signal_provider_instance_id: "spi_abc",
      display_name: "Deploy watchdog",
      signal_type: "github.pull_request.opened",
      filter: { json_equals: [{ path: "pull_request.draft", value: false }] },
      session_policy: {
        type: "session_key_template",
        namespace: "openbot",
        template: "chat#{{ repository.full_name }}#{{ number }}",
        create_if_missing: true,
        title_template: "{{ repository.full_name }}#{{ number }}",
      },
      action: { type: "invoke_chatkit_agent", agent_inbox_id: "inbox-1" },
    });
  });

  it("immediately disables the rule when creating a disabled routine", async () => {
    const { app, calls } = routineApp((call) => {
      if (call.method === "POST" && call.path === "/api/v1/team/team-1/signals/rules")
        return Response.json({ ...stampedRule, id: "rule-new" });
      if (call.method === "PATCH" && call.path === "/api/v1/team/team-1/signals/rules/rule-new")
        return Response.json({ ...stampedRule, id: "rule-new", status: "disabled" });
      return listResponses(call);
    });
    const response = await app.request("https://openbot.test/api/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "inbox-1",
        name: "Quiet",
        instruction: "Watch quietly",
        enabled: false,
        triggers: [
          { kind: "event", instance_id: "spi_abc", signal_type: "github.pull_request.opened" },
        ],
      }),
    });
    expect(response.status).toBe(201);
    const disable = calls.find(
      (call) => call.method === "PATCH" && call.path.endsWith("/signals/rules/rule-new"),
    );
    expect(disable?.body).toMatchObject({ display_name: "Quiet", status: "disabled" });
  });

  it("rolls back already-created members when a later member fails", async () => {
    const { app, calls } = routineApp((call) => {
      if (call.method === "POST" && call.path === "/api/v1/team/team-1/chatkit/routines")
        return Response.json({ ...stampedRoutine, id: "tr-new" });
      if (call.method === "POST" && call.path === "/api/v1/team/team-1/signals/rules")
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      if (call.method === "DELETE") return Response.json({ deleted: true });
      return listResponses(call);
    });
    const response = await app.request("https://openbot.test/api/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "inbox-1",
        name: "Doomed",
        instruction: "Fail",
        triggers: [
          { kind: "schedule", schedule: "0 7 * * *" },
          { kind: "event", instance_id: "spi_abc", signal_type: "github.pull_request.opened" },
        ],
      }),
    });
    expect(response.status).toBe(502);
    const rollback = calls.find(
      (call) => call.method === "DELETE" && call.path.endsWith("/chatkit/routines/tr-new"),
    );
    expect(rollback).toBeDefined();
  });

  it("diffs triggers on PATCH: updates by id, creates new entries, deletes missing ids", async () => {
    const { app, calls } = routineApp((call) => {
      if (call.method === "PATCH" && call.path === "/api/v1/team/team-1/chatkit/routines/tr-1")
        return Response.json({ ...stampedRoutine, schedule: "0 8 * * *" });
      if (call.method === "POST" && call.path === "/api/v1/team/team-1/signals/rules")
        return Response.json({ ...stampedRule, id: "rule-new" });
      if (call.method === "DELETE" && call.path === "/api/v1/team/team-1/signals/rules/rule-1")
        return Response.json({ success: true });
      return listResponses(call);
    });
    const response = await app.request("https://openbot.test/api/routines/g1?agent_id=inbox-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triggers: [
          { id: "t1", kind: "schedule", schedule: "0 8 * * *" },
          { kind: "event", instance_id: "spi_abc", signal_type: "github.issue.opened" },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const update = calls.find(
      (call) => call.method === "PATCH" && call.path.endsWith("/chatkit/routines/tr-1"),
    );
    expect(update?.body).toEqual({
      title: "Deploy watchdog",
      prompt: "Check deploy health",
      schedule: "0 8 * * *",
    });
    const create = calls.find(
      (call) => call.method === "POST" && call.path.endsWith("/signals/rules"),
    );
    expect(create?.body).toMatchObject({
      signal_type: "github.issue.opened",
      session_policy: { type: "new_session_per_delivery" },
    });
    const remove = calls.find(
      (call) => call.method === "DELETE" && call.path.endsWith("/signals/rules/rule-1"),
    );
    expect(remove).toBeDefined();
  });

  it("rejects a kind change for an existing trigger id", async () => {
    const { app } = routineApp(listResponses);
    const response = await app.request("https://openbot.test/api/routines/g1?agent_id=inbox-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triggers: [
          { id: "t1", kind: "event", instance_id: "spi_abc", signal_type: "github.issue.opened" },
        ],
      }),
    });
    expect(response.status).toBe(400);
  });

  it("fans enabled out to every member with a full-replace rule update", async () => {
    const { app, calls } = routineApp((call) => {
      if (call.method === "PATCH" && call.path === "/api/v1/team/team-1/chatkit/routines/tr-1")
        return Response.json({ ...stampedRoutine, enabled: false });
      if (call.method === "PATCH" && call.path === "/api/v1/team/team-1/signals/rules/rule-1")
        return Response.json({ ...stampedRule, status: "disabled" });
      return listResponses(call);
    });
    const response = await app.request("https://openbot.test/api/routines/g1?agent_id=inbox-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(response.status).toBe(200);
    const routinePatch = calls.find(
      (call) => call.method === "PATCH" && call.path.endsWith("/chatkit/routines/tr-1"),
    );
    expect(routinePatch?.body).toMatchObject({ enabled: false });
    const rulePatch = calls.find(
      (call) => call.method === "PATCH" && call.path.endsWith("/signals/rules/rule-1"),
    );
    expect(rulePatch?.body).toEqual({
      display_name: "Deploy watchdog",
      status: "disabled",
      filter: { json_equals: [{ path: "pull_request.draft", value: false }] },
      session_policy: { type: "new_session_per_delivery", title_template: "Deploy watchdog" },
      action: { type: "invoke_chatkit_agent", agent_inbox_id: "inbox-1" },
      metadata: {
        openbot: { group: "g1", trigger: "t2", instruction: "Check deploy health" },
      },
    });
  });

  it("leaves each member's enabled state alone when the edit omits enabled", async () => {
    const { app, calls } = routineApp((call) => {
      if (call.method === "PATCH" && call.path === "/api/v1/team/team-1/chatkit/routines/tr-1")
        return Response.json({ ...stampedRoutine, title: "Renamed" });
      if (call.method === "PATCH" && call.path === "/api/v1/team/team-1/signals/rules/rule-1")
        return Response.json({ ...stampedRule, display_name: "Renamed" });
      return listResponses(call);
    });
    const response = await app.request("https://openbot.test/api/routines/g1?agent_id=inbox-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(response.status).toBe(200);
    const routinePatch = calls.find(
      (call) => call.method === "PATCH" && call.path.endsWith("/chatkit/routines/tr-1"),
    );
    expect(routinePatch?.body).toEqual({ title: "Renamed", prompt: "Check deploy health" });
    const rulePatch = calls.find(
      (call) => call.method === "PATCH" && call.path.endsWith("/signals/rules/rule-1"),
    );
    expect(rulePatch?.body).toMatchObject({ display_name: "Renamed", status: "disabled" });
  });

  it("asks for a large rule page and fails only when the unpaginated list overflows", async () => {
    const rulesApp = (length: number) =>
      routineApp((call) => {
        if (call.path === "/api/v1/team/team-1/chatkit/routines")
          return Response.json({ items: [stampedRoutine], next_page_token: null });
        if (call.path === "/api/v1/team/team-1/signals/rules")
          return Response.json({
            items: Array.from({ length }, (_unused, index) => ({
              ...stampedRule,
              id: `rule-${index}`,
            })),
            next_page_token: null,
          });
        return undefined;
      });

    // Upstream queries LIMIT page_size + 1, so a full page is 1001 rows.
    const full = rulesApp(1000);
    const complete = await full.app.request("https://openbot.test/api/routines?agent_id=inbox-1");
    expect(complete.status).toBe(200);
    const ruleCalls = full.calls.filter((call) => call.path.endsWith("/signals/rules"));
    expect(ruleCalls).toHaveLength(1);
    expect(ruleCalls[0]?.query.get("page_size")).toBe("1000");

    const response = await rulesApp(1001).app.request(
      "https://openbot.test/api/routines?agent_id=inbox-1",
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("maximum 1000 results"),
    });
  });

  it("deletes every member of the group", async () => {
    const { app, calls } = routineApp((call) => {
      if (call.method === "DELETE") return Response.json({ deleted: true });
      return listResponses(call);
    });
    const response = await app.request("https://openbot.test/api/routines/g1?agent_id=inbox-1", {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    const deletes = calls.filter((call) => call.method === "DELETE").map((call) => call.path);
    expect(deletes).toContain("/api/v1/team/team-1/chatkit/routines/tr-1");
    expect(deletes).toContain("/api/v1/team/team-1/signals/rules/rule-1");
  });

  it("runs a routine now through a mission-control session and message", async () => {
    const { app, calls } = routineApp((call) => {
      if (
        call.method === "POST" &&
        call.path === "/api/v1/team/team-1/chatkit/mission-control/agents/inbox-1/sessions"
      )
        return Response.json({ session: { id: "sess-1", title: "Deploy watchdog" } });
      if (
        call.method === "POST" &&
        call.path ===
          "/api/v1/team/team-1/chatkit/mission-control/agents/inbox-1/sessions/sess-1/messages"
      )
        return Response.json({ message: { id: "msg-1" } });
      return listResponses(call);
    });
    const response = await app.request(
      "https://openbot.test/api/routines/g1/run?agent_id=inbox-1",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session_id: "sess-1" });
    const session = calls.find((call) => call.path.endsWith("/sessions"));
    expect(session?.body).toEqual({ title: "Deploy watchdog" });
    const message = calls.find((call) => call.path.endsWith("/messages"));
    expect(message?.body).toEqual({ text: "Check deploy health", attachment_ids: [] });
  });

  it("maps upstream failures onto the response", async () => {
    const { app } = routineApp(
      () => new Response(JSON.stringify({ error: "kaput" }), { status: 500 }),
    );
    const response = await app.request("https://openbot.test/api/routines?agent_id=inbox-1");
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "kaput" });
  });
});
