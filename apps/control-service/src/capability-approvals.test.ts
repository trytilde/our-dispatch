import { describe, expect, it, vi } from "vite-plus/test";
import type { AuthProvider } from "@tryopenbot/auth-provider";
import { createApp } from "./app.js";

function testAuthProvider(): AuthProvider {
  return {
    initialization: { id: "test-auth", label: "Test auth", questions: [] },
    deployable: { plan: async () => ({ summary: "test" }), deploy: async () => ({}) },
    nativeClientConfiguration: () => ({
      authorizationEndpoint: "https://identity.test/authorize",
      tokenEndpoint: "https://identity.test/token",
      clientId: "client-one",
      scope: "openid offline_access openbot:control",
    }),
    authorizationUrl: () => new URL("https://identity.test/authorize"),
    exchangeCode: async () => ({ accessToken: "human-token", expiresIn: 3600 }),
    refresh: async () => ({ accessToken: "human-token", expiresIn: 3600 }),
    verify: async () => ({ subject: "owner-one", groups: [], scope: ["openbot:control"] }),
  } as unknown as AuthProvider;
}

describe("capability approval proxy", () => {
  it("forwards the authenticated human bearer and exact binding", async () => {
    const upstream = vi.fn(async (_input: URL | string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer human-token");
      expect(JSON.parse(expectStringBody(init?.body))).toEqual({
        approval_id: "approval-a",
        proposal_hash: "hash-a",
        proposal_generation: 1,
        decision: "approve",
      });
      return Response.json({
        id: "proposal-a",
        status: "approved",
        error_message: "provider secret-shaped diagnostic",
        desired_state: { client_secret: "must-not-reach-browser" },
        title: "Add Stripe",
        rationale: "Revenue",
        category: "connector",
        preview: {
          permissions: [],
          credentials: [],
          cost_summary: "$0",
          security_summary: "Read-only",
          rollback_plan: "Remove",
        },
        approval: {
          approval_id: "approval-a",
          proposal_id: "proposal-a",
          proposal_hash: "hash-a",
          proposal_generation: 1,
          status: "completed",
          title: "Add Stripe",
          instructions: "Revenue",
        },
      });
    });
    const app = createApp({
      authProvider: testAuthProvider(),
      tildeProxy: {
        apiKey: "machine",
        orgId: "org",
        teamId: "team",
        baseUrl: "https://tilde.test",
        fetch: upstream as typeof fetch,
      },
    });
    const response = await app.request(
      "https://openbot.test/api/capability-approvals/proposal-a/decision",
      {
        method: "POST",
        headers: { authorization: "Bearer human-token", "content-type": "application/json" },
        body: JSON.stringify({
          approval_id: "approval-a",
          proposal_hash: "hash-a",
          proposal_generation: 1,
          decision: "approve",
        }),
      },
    );
    expect(response.status).toBe(200);
    const responseText = await response.text();
    expect(responseText).not.toContain("must-not-reach-browser");
    expect(responseText).not.toContain("secret-shaped diagnostic");
    expect(JSON.parse(responseText)).toEqual({
      id: "proposal-a",
      title: "Add Stripe",
      rationale: "Revenue",
      category: "connector",
      status: "approved",
      preview: {
        permissions: [],
        credentials: [],
        cost_summary: "$0",
        security_summary: "Read-only",
        rollback_plan: "Remove",
      },
      approval: {
        approval_id: "approval-a",
        proposal_id: "proposal-a",
        proposal_hash: "hash-a",
        proposal_generation: 1,
        status: "completed",
        title: "Add Stripe",
        instructions: "Revenue",
      },
    });
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("does not accept a machine key in place of an owner bearer", async () => {
    const upstream = vi.fn();
    const app = createApp({
      authProvider: testAuthProvider(),
      tildeProxy: {
        apiKey: "machine",
        orgId: "org",
        teamId: "team",
        baseUrl: "https://tilde.test",
        fetch: upstream,
      },
    });
    const response = await app.request(
      "https://openbot.test/api/capability-approvals/proposal-a/decision",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          approval_id: "approval-a",
          proposal_hash: "hash-a",
          proposal_generation: 1,
          decision: "approve",
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not expose upstream errors to the owner client", async () => {
    const app = createApp({
      authProvider: testAuthProvider(),
      tildeProxy: {
        apiKey: "machine",
        orgId: "org",
        teamId: "team",
        baseUrl: "https://tilde.test",
        fetch: vi
          .fn()
          .mockResolvedValue(
            Response.json({ error: "provider client_secret was rejected" }, { status: 409 }),
          ),
      },
    });
    const response = await app.request(
      "https://openbot.test/api/capability-approvals/proposal-a/decision",
      {
        method: "POST",
        headers: { authorization: "Bearer human-token", "content-type": "application/json" },
        body: JSON.stringify({
          approval_id: "approval-a",
          proposal_hash: "hash-a",
          proposal_generation: 1,
          decision: "approve",
        }),
      },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Capability decision failed" });
  });

  it("reloads durable decision state with the verified owner bearer", async () => {
    const upstream = vi.fn(async (_input: URL | string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer human-token");
      expect(init?.method).toBeUndefined();
      return Response.json({
        id: "proposal-a",
        status: "executed",
        title: "Add Stripe",
        rationale: "Revenue",
        category: "connector",
        preview: {
          permissions: [],
          credentials: [],
          cost_summary: "$0",
          security_summary: "Read-only",
          rollback_plan: "Remove",
        },
        approval: {
          approval_id: "approval-a",
          proposal_id: "proposal-a",
          proposal_hash: "hash-a",
          proposal_generation: 1,
          status: "completed",
          title: "Add Stripe",
          instructions: "Revenue",
        },
      });
    });
    const app = createApp({
      authProvider: testAuthProvider(),
      tildeProxy: {
        apiKey: "machine",
        orgId: "org",
        teamId: "team",
        baseUrl: "https://tilde.test",
        fetch: upstream as typeof fetch,
      },
    });
    const response = await app.request("https://openbot.test/api/capability-approvals/proposal-a", {
      headers: { authorization: "Bearer human-token" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "proposal-a", status: "executed" });
  });

  it("rejects an upstream approval bound to a different proposal", async () => {
    const app = createApp({
      authProvider: testAuthProvider(),
      tildeProxy: {
        apiKey: "machine",
        orgId: "org",
        teamId: "team",
        baseUrl: "https://tilde.test",
        fetch: vi.fn().mockResolvedValue(
          Response.json({
            id: "proposal-b",
            status: "pending",
            title: "Add Stripe",
            rationale: "Revenue",
            category: "connector",
            preview: {
              permissions: [],
              credentials: [],
              cost_summary: "$0",
              security_summary: "Read-only",
              rollback_plan: "Remove",
            },
            approval: {
              approval_id: "approval-a",
              proposal_id: "proposal-b",
              proposal_hash: "hash-a",
              proposal_generation: 1,
              status: "pending",
              title: "Add Stripe",
              instructions: "Revenue",
            },
          }),
        ),
      },
    });
    const response = await app.request("https://openbot.test/api/capability-approvals/proposal-a", {
      headers: { authorization: "Bearer human-token" },
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Invalid capability response" });
  });
});

function expectStringBody(body: unknown): string {
  expect(typeof body).toBe("string");
  return body as string;
}
