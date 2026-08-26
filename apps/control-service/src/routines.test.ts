import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "./app.js";

const automationId = "29fcfbfb-6de3-4b6b-bc35-a1bbf15e923b";
const scheduleId = "7412204e-ce8e-4822-a9ee-b7a4eb6990a5";
const eventId = "8dcc09db-fbc3-4d54-8c33-d7dfbd70dc52";

const automation = {
  id: automationId,
  org_id: "org-1",
  team_id: "team-1",
  authorization: { visibility: "private", ownership: "private" },
  created_by_user_id: "user-1",
  agent_id: "inbox-1",
  name: "Deploy watchdog",
  instruction: "Check deploy health",
  enabled: true,
  status: "active",
  generation: 3,
  applied_generation: 3,
  error_message: null,
  last_run_at: "2026-08-26T07:00:00Z",
  last_session_id: "64099782-8536-4caa-9f7b-2f6b453eafc6",
  last_error: "last execution failed",
  triggers: [
    {
      id: scheduleId,
      kind: "schedule",
      schedule: "0 7 * * *",
      schedule_description: "Daily at 07:00 UTC",
      next_run_at: "2026-08-27T07:00:00Z",
      materialized_resource_id: "44c021e1-5d1a-4c39-9029-c545f17339bf",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-20T00:00:00Z",
    },
    {
      id: eventId,
      kind: "event",
      signal_provider_instance_id: "spi_abc",
      signal_type: "github.pull_request.opened",
      filter: { json_equals: [{ path: "pull_request.draft", value: false }] },
      session_policy: {
        type: "session_key_template",
        namespace: "openbot",
        template: "repo#{{ repository.full_name }}",
        create_if_missing: true,
      },
      materialized_resource_id: "45e6efdf-080d-40a6-89d4-7d5fcd9b7303",
      created_at: "2026-08-02T00:00:00Z",
      updated_at: "2026-08-21T00:00:00Z",
    },
  ],
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-21T00:00:00Z",
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
  return {
    app: createApp({
      routines: {
        apiKey: "key",
        orgId: "org-1",
        teamId: "team-1",
        baseUrl: "https://tilde.test",
        fetch: fetch as unknown as typeof globalThis.fetch,
      },
    }),
    calls,
  };
}

function defaultResponses(call: UpstreamCall): Response | undefined {
  if (call.method === "GET" && call.path.endsWith(`/automations/${automationId}`))
    return Response.json(automation);
  if (call.method === "GET" && call.path.endsWith("/automations"))
    return Response.json({ items: [automation], next_page_token: null });
  if (call.method === "PUT" && call.path.includes("/automations/"))
    return Response.json(automation);
  if (call.method === "DELETE" && call.path.endsWith(`/automations/${automationId}`))
    return Response.json({ deleted: true });
  if (call.method === "POST" && call.path.endsWith(`/automations/${automationId}/run`))
    return Response.json({
      run_id: (call.body as { run_id: string }).run_id,
      session_id: "8e0e2208-d42e-4e30-a5f2-56d4780e1445",
      duplicate: false,
    });
  return undefined;
}

describe("routine automation facade", () => {
  it("is unavailable without Tilde credentials and requires agent_id", async () => {
    const unavailable = await createApp({}).request(
      "https://openbot.test/api/routines?agent_id=inbox-1",
    );
    expect(unavailable.status).toBe(503);
    const missing = await routineApp(defaultResponses).app.request(
      "https://openbot.test/api/routines",
    );
    expect(missing.status).toBe(400);
  });

  it("pages authoritative automations and preserves the client Routine shape", async () => {
    const { app, calls } = routineApp((call) => {
      if (call.method !== "GET" || !call.path.endsWith("/automations")) return undefined;
      if (!call.query.has("next_page_token"))
        return Response.json({ items: [automation], next_page_token: "page-2" });
      return Response.json({ items: [], next_page_token: null });
    });
    const response = await app.request("https://openbot.test/api/routines?agent_id=inbox-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: automationId,
          agent_id: "inbox-1",
          status: "active",
          generation: 3,
          applied_generation: 3,
          last_error: "last execution failed",
          error_message: null,
          last_run_at: "2026-08-26T07:00:00Z",
          last_session_id: "64099782-8536-4caa-9f7b-2f6b453eafc6",
          triggers: [
            expect.objectContaining({
              id: scheduleId,
              kind: "schedule",
              description: "Daily at 07:00 UTC",
              next_run_at: "2026-08-27T07:00:00Z",
              routine_id: "44c021e1-5d1a-4c39-9029-c545f17339bf",
            }),
            expect.objectContaining({
              id: eventId,
              kind: "event",
              instance_id: "spi_abc",
              provider_type: "github",
              rule_id: "45e6efdf-080d-40a6-89d4-7d5fcd9b7303",
            }),
          ],
        }),
      ],
    });
    const pages = calls.filter((call) => call.path.endsWith("/automations"));
    expect(pages).toHaveLength(2);
    expect(pages[0]?.query.get("agent_id")).toBe("inbox-1");
    expect(pages[0]?.query.get("page_size")).toBe("100");
    expect(pages[1]?.query.get("next_page_token")).toBe("page-2");
  });

  it("creates one automation with server-shaped triggers and generated UUIDs", async () => {
    const { app, calls } = routineApp(defaultResponses);
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
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.path).toMatch(/\/automations\/[0-9a-f-]{36}$/);
    expect(put?.body).toMatchObject({
      agent_id: "inbox-1",
      name: "Deploy watchdog",
      instruction: "Check deploy health",
      enabled: true,
      triggers: [
        { id: expect.stringMatching(/^[0-9a-f-]{36}$/), kind: "schedule", schedule: "0 7 * * *" },
        {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          kind: "event",
          signal_provider_instance_id: "spi_abc",
          signal_type: "github.pull_request.opened",
          filter: { json_equals: [{ path: "pull_request.draft", value: false }] },
        },
      ],
    });
  });

  it("GETs then fully PUTs an edit, preserving trigger ids and authorization", async () => {
    const { app, calls } = routineApp(defaultResponses);
    const response = await app.request(
      `https://openbot.test/api/routines/${automationId}?agent_id=inbox-1`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed", enabled: false }),
      },
    );
    expect(response.status).toBe(200);
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.body).toMatchObject({
      agent_id: "inbox-1",
      name: "Renamed",
      instruction: "Check deploy health",
      enabled: false,
      authorization: automation.authorization,
      triggers: [
        { id: scheduleId, kind: "schedule" },
        { id: eventId, kind: "event" },
      ],
    });
    expect((put?.body as { triggers: unknown[] }).triggers[1]).toMatchObject({
      session_policy: automation.triggers[1]?.session_policy,
    });
  });

  it("delegates delete and run while checking the routine belongs to the requested agent", async () => {
    const deleted = routineApp(defaultResponses);
    const deleteResponse = await deleted.app.request(
      `https://openbot.test/api/routines/${automationId}?agent_id=inbox-1`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(200);
    expect(deleted.calls.some((call) => call.method === "DELETE")).toBe(true);

    const run = routineApp(defaultResponses);
    const runResponse = await run.app.request(
      `https://openbot.test/api/routines/${automationId}/run?agent_id=inbox-1`,
      { method: "POST" },
    );
    expect(runResponse.status).toBe(200);
    await expect(runResponse.json()).resolves.toEqual({
      session_id: "8e0e2208-d42e-4e30-a5f2-56d4780e1445",
    });
    const runCall = run.calls.find((call) => call.path.endsWith("/run"));
    expect(runCall?.body).toEqual({ run_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });

    const wrongAgent = routineApp(defaultResponses);
    const hidden = await wrongAgent.app.request(
      `https://openbot.test/api/routines/${automationId}?agent_id=inbox-2`,
      { method: "DELETE" },
    );
    expect(hidden.status).toBe(404);
    expect(wrongAgent.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("keeps authoritative run failures separate from reconciliation errors", async () => {
    const failedRoot = {
      ...automation,
      status: "error",
      error_message: "signal rule rejected",
      last_error: "agent execution failed",
    };
    const root = routineApp((call) => {
      if (call.path.endsWith("/automations"))
        return Response.json({ items: [failedRoot], next_page_token: null });
      return undefined;
    });
    const response = await root.app.request("https://openbot.test/api/routines?agent_id=inbox-1");
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          status: "error",
          error_message: "signal rule rejected",
          last_error: "agent execution failed",
        },
      ],
    });
  });

  it("maps upstream failures", async () => {
    const upstream = routineApp(
      () => new Response(JSON.stringify({ error: "kaput" }), { status: 500 }),
    );
    const failed = await upstream.app.request("https://openbot.test/api/routines?agent_id=inbox-1");
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({ error: "kaput" });
  });
});
