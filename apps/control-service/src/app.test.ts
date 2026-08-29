import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Code, ConnectError } from "@connectrpc/connect";
import type { AuthProvider } from "@tryopenbot/auth-provider";
import type { ComputerProvider } from "@tryopenbot/computer-service-provider";
import { app, createApp } from "./app.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

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
    exchangeCode: async () => ({ accessToken: "browser-token", expiresIn: 3600 }),
    refresh: async () => ({ accessToken: "browser-token", expiresIn: 3600 }),
    verify: async () => ({
      subject: "owner-one",
      groups: [],
      scope: ["openbot:control"],
    }),
  } as unknown as AuthProvider;
}

describe("bare OpenBot server", () => {
  it("reports healthy without setup", async () => {
    const response = await app.request("https://openbot.test/healthz");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "openbot" });
  });

  it("reports native authentication as unavailable when it is not configured", async () => {
    const response = await app.request("https://openbot.test/auth/native-config");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Owner authentication is not configured",
    });
  });

  it("does not expose an API namespace", async () => {
    const response = await app.request("https://openbot.test/api/setup/unlock", { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("serves the public connector OAuth completion handoff", async () => {
    const response = await createApp({ webRoot: "/missing" }).request(
      "https://openbot.test/connectors/authorized?client=electron",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toContain("openbot://connectors/authorized");
  });

  it("passes allowlisted owner settings operations through to Tilde unchanged", async () => {
    const tildeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toBe(
        "https://tilde.test/api/v1/team/team-one/automations/routine-one?view=owner",
      );
      expect(request.method).toBe("PUT");
      expect(request.headers.get("x-api-key")).toBe("tilde-key");
      expect(request.headers.get("x-tilde-org-id")).toBe("org-one");
      expect(request.headers.get("x-tilde-team-id")).toBe("team-one");
      expect(request.headers.get("authorization")).toBeNull();
      await expect(request.json()).resolves.toEqual({ enabled: true });
      return Response.json({ id: "routine-one", enabled: true }, { status: 201 });
    });
    const tildeApp = createApp({
      webRoot: "/missing",
      tildeProxy: {
        apiKey: "tilde-key",
        orgId: "org-one",
        teamId: "team-one",
        baseUrl: "https://tilde.test",
        fetch: tildeFetch,
      },
    });

    const response = await tildeApp.request(
      "https://openbot.test/api/tilde/automations/routine-one?view=owner",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer browser-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: true }),
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "routine-one", enabled: true });
    expect(tildeFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects Tilde operations outside the owner settings allowlist", async () => {
    const tildeFetch = vi.fn<typeof fetch>();
    const tildeApp = createApp({
      webRoot: "/missing",
      tildeProxy: {
        apiKey: "tilde-key",
        orgId: "org-one",
        teamId: "team-one",
        fetch: tildeFetch,
      },
    });

    const unsupported = [
      ["/api/tilde/identity/api-key", "POST"],
      ["/api/tilde/openbot/plugins/catalog", "GET"],
      ["/api/tilde/provider-setup/catalog", "GET"],
      ["/api/tilde/provider-setup/setup-one/resume", "POST"],
      ["/api/tilde/signals/deliveries/delivery-one/retry", "POST"],
      ["/api/tilde/mcp/proxied-mcp-servers/server-one", "GET"],
      ["/api/tilde/credential/source/oauth/resource-server", "POST"],
    ] as const;
    for (const [path, method] of unsupported) {
      const response = await tildeApp.request(`https://openbot.test${path}`, { method });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect(tildeFetch).not.toHaveBeenCalled();
  });

  it("preserves encoded resource IDs in allowlisted Tilde paths", async () => {
    const tildeFetch = vi.fn<typeof fetch>(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      expect(request.url).toBe(
        "https://tilde.test/api/v1/team/team-one/mcp/tool-group/github%2Fwork",
      );
      return Response.json({ ok: true });
    });
    const tildeApp = createApp({
      webRoot: "/missing",
      tildeProxy: {
        apiKey: "tilde-key",
        orgId: "org-one",
        teamId: "team-one",
        baseUrl: "https://tilde.test",
        fetch: tildeFetch,
      },
    });

    const response = await tildeApp.request(
      "https://openbot.test/api/tilde/mcp/tool-group/github%2Fwork",
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(tildeFetch).toHaveBeenCalledTimes(1);
  });

  it("starts agent setup in the trusted development computer and reports readiness", async () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    const execute = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      jobId,
      running: true,
    }));
    const awaitExecution = vi.fn(async () => ({
      exitCode: 0,
      stdout: '{"ok":true,"agent":{"id":"test","name":"Test"}}\n',
      stderr: "",
      jobId,
      running: false,
    }));
    const tildeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "queued" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "active" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      );
    const agentApp = createApp({
      environment: {
        COMPUTER_SERVICE_API_KEY: "computer-key",
        DEVELOPMENT_SANDBOX_SERVICE_URL: "https://computer.test/rpc",
        AGENT_SERVICE_ORIGIN: "https://agents.openbot.test",
        TILDE_API_KEY: "tilde-key",
        TILDE_ORG_ID: "org-one",
        TILDE_TEAM_ID: "team-one",
        TILDE_BASE_URL: "https://tilde.test",
      },
      agentCreation: { execute, awaitExecution, tildeFetch },
    });

    const response = await agentApp.request("https://openbot.test/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "setting_up",
      job_id: jobId,
      agent: { id: "test", name: "Test" },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "factory",
        command: "bash",
        background: true,
        arguments: ["-lc", expect.stringContaining("openbot new-agent 'Test' --json")],
      }),
      expect.objectContaining({ authorization: "Bearer computer-key" }),
    );

    const provisioning = await agentApp.request(`https://openbot.test/api/agents/setup/${jobId}`, {
      headers: { authorization: "Bearer owner-token" },
    });
    await expect(provisioning.json()).resolves.toEqual({
      status: "setting_up",
      job_id: jobId,
      agent: { id: "test", name: "Test" },
    });
    const status = await agentApp.request(`https://openbot.test/api/agents/setup/${jobId}`, {
      headers: { authorization: "Bearer owner-token" },
    });
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({
      status: "ready",
      agent: { id: "test", name: "Test" },
    });
    expect(awaitExecution).toHaveBeenCalledWith(
      { agentId: "factory", jobId, timeoutMilliseconds: 0 },
      expect.objectContaining({ authorization: "Bearer computer-key" }),
    );
    expect(tildeFetch).toHaveBeenLastCalledWith(
      new URL("https://tilde.test/api/v1/team/team-one/chatkit/agents/test/provision"),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          authorization: "Bearer owner-token",
          "x-api-key": "tilde-key",
        }),
        body: expect.stringContaining('"display_name":"Test"'),
      }),
    );
  });

  it("starts development agent setup in the checkout served by the live agent runtime", async () => {
    const jobId = "33333333-3333-4333-8333-333333333333";
    const execute = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      jobId,
      running: true,
    }));
    const agentApp = createApp({
      environment: {},
      agentCreation: { repositoryRoot: "/repository", execute },
    });

    const response = await agentApp.request("https://openbot.test/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Tasa" }),
    });

    expect(response.status).toBe(202);
    expect(execute).toHaveBeenCalledWith(
      {
        agentId: "factory",
        command: "pnpm",
        arguments: ["openbot", "new-agent", "Tasa", "--json"],
        cwd: "/repository",
        timeoutMilliseconds: 600_000,
        background: true,
      },
      expect.objectContaining({ authorization: "" }),
    );
  });

  it("completes a development setup job through the local background runner", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-agent-create-"));
    temporaryRoots.push(root);
    const pnpm = join(root, "pnpm");
    await writeFile(
      pnpm,
      '#!/bin/sh\nprintf \'%s\\n\' \'{"ok":true,"agent":{"id":"tasa","name":"Tasa"}}\'\n',
    );
    await chmod(pnpm, 0o700);
    const agentApp = createApp({
      environment: { PATH: root },
      agentCreation: { repositoryRoot: root },
    });

    const started = await agentApp.request("https://openbot.test/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Tasa" }),
    });
    const { job_id: jobId } = (await started.json()) as { job_id: string };
    let status: { status: string; agent?: { id: string; name: string } } = {
      status: "setting_up",
    };
    for (let attempt = 0; attempt < 50 && status.status === "setting_up"; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      status = (await (
        await agentApp.request(`https://openbot.test/api/agents/setup/${jobId}`)
      ).json()) as typeof status;
    }

    expect(status).toEqual({ status: "ready", agent: { id: "tasa", name: "Tasa" } });
  });

  it("retains a completed local job while durable Tilde provisioning is pending", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-agent-provision-"));
    temporaryRoots.push(root);
    const pnpm = join(root, "pnpm");
    await writeFile(
      pnpm,
      '#!/bin/sh\nprintf \'%s\\n\' \'{"ok":true,"agent":{"id":"reviewer","name":"Reviewer"}}\'\n',
    );
    await chmod(pnpm, 0o700);
    const tildeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "queued" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ status: "active" }, { status: 202 }));
    const agentApp = createApp({
      environment: {
        PATH: root,
        AGENT_SERVICE_ORIGIN: "https://agents.openbot.test",
        TILDE_API_KEY: "tilde-key",
        TILDE_ORG_ID: "org-one",
        TILDE_TEAM_ID: "team-one",
        TILDE_BASE_URL: "https://tilde.test",
      },
      agentCreation: { repositoryRoot: root, tildeFetch },
    });
    const started = await agentApp.request("https://openbot.test/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Reviewer" }),
    });
    const { job_id: jobId } = (await started.json()) as { job_id: string };

    let pending: Response | undefined;
    for (let attempt = 0; attempt < 50 && tildeFetch.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      pending = await agentApp.request(`https://openbot.test/api/agents/setup/${jobId}`, {
        headers: { authorization: "Bearer owner-token" },
      });
    }
    expect(tildeFetch).toHaveBeenCalledOnce();
    await expect(pending?.json()).resolves.toMatchObject({ status: "setting_up", job_id: jobId });

    const ready = await agentApp.request(`https://openbot.test/api/agents/setup/${jobId}`, {
      headers: { authorization: "Bearer owner-token" },
    });
    await expect(ready.json()).resolves.toEqual({
      status: "ready",
      agent: { id: "reviewer", name: "Reviewer" },
    });
    expect(tildeFetch).toHaveBeenCalledTimes(2);
  });

  it("forwards a verified cookie access token when establishing bundle ownership", async () => {
    const jobId = "33333333-3333-4333-8333-333333333333";
    const tildeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.headers.get("authorization")).toBe("Bearer cookie-owner-token");
      return Response.json({ status: "active" }, { status: 202 });
    });
    const authProvider = ownerAuthProvider();
    const agentApp = createApp({
      authProvider,
      webRoot: "/missing",
      environment: {
        COMPUTER_SERVICE_API_KEY: "computer-key",
        DEVELOPMENT_SANDBOX_SERVICE_URL: "https://computer.test/rpc",
        AGENT_SERVICE_ORIGIN: "https://agents.openbot.test",
        TILDE_API_KEY: "tilde-key",
        TILDE_ORG_ID: "org-one",
        TILDE_TEAM_ID: "team-one",
        TILDE_BASE_URL: "https://tilde.test",
      },
      agentCreation: {
        tildeFetch,
        awaitExecution: async () => ({
          exitCode: 0,
          stdout: '{"ok":true,"agent":{"id":"cookie-agent","name":"Cookie Agent"}}\n',
          stderr: "",
          jobId,
          running: false,
        }),
      },
    });

    const response = await agentApp.request(`https://openbot.test/api/agents/setup/${jobId}`, {
      headers: {
        authorization: "Basic unverified",
        cookie: "openbot_access=cookie-owner-token",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      agent: { id: "cookie-agent", name: "Cookie Agent" },
    });
    expect(authProvider.verify).toHaveBeenCalledWith("cookie-owner-token");
    expect(tildeFetch).toHaveBeenCalledOnce();
  });

  it("reports a running or failed background agent setup without exposing command details", async () => {
    const jobId = "22222222-2222-4222-8222-222222222222";
    const awaitExecution = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
        stderr: "",
        jobId,
        running: true,
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: '{"error":"Tilde setup failed","stack":"private"}\n',
        stderr: "",
        jobId,
        running: false,
      });
    const agentApp = createApp({
      environment: {
        COMPUTER_SERVICE_API_KEY: "computer-key",
        DEVELOPMENT_SANDBOX_SERVICE_URL: "https://computer.test/rpc",
      },
      agentCreation: { awaitExecution },
    });

    const running = await agentApp.request(`https://openbot.test/api/agents/setup/${jobId}`);
    await expect(running.json()).resolves.toEqual({ status: "setting_up" });
    const failed = await agentApp.request(`https://openbot.test/api/agents/setup/${jobId}`);
    await expect(failed.json()).resolves.toEqual({ status: "failed", error: "Tilde setup failed" });
  });

  it("returns the structured CLI error written to stdout", async () => {
    const agentApp = createApp({
      environment: {
        COMPUTER_SERVICE_API_KEY: "computer-key",
        DEVELOPMENT_SANDBOX_SERVICE_URL: "https://computer.test/rpc",
      },
      agentCreation: {
        execute: async () => ({
          exitCode: 1,
          stdout:
            '{"error":"Agent test already exists","stack":"internal detail","log":"private path"}\n',
          stderr: "",
        }),
      },
    });

    const response = await agentApp.request("https://openbot.test/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Agent test already exists" });
  });

  it("opens only the selected agent's capability-scoped computer preview", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const traceId = "11111111-1111-4111-8111-111111111111";
    const previewAgentDesktop = vi.fn(async () => ({
      url: new URL("https://computer.test/vnc.html?token=opaque"),
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const computerApp = createApp({
      computerProvider: { previewAgentDesktop } as unknown as ComputerProvider,
      devMode: true,
      environment: { COMPUTER_ID: "computer-one" },
    });
    const response = await computerApp.request(
      `https://openbot.test/api/computer/hello-world/preview?trace_id=${traceId}`,
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://computer.test/vnc.html?token=opaque");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-openbot-vnc-trace-id")).toBe(traceId);
    expect(previewAgentDesktop).toHaveBeenCalledWith(
      "hello-world",
      expect.objectContaining({
        requestId: traceId,
        devMode: true,
        environment: { COMPUTER_ID: "computer-one" },
      }),
    );
    expect(info).toHaveBeenCalledWith(
      "[openbot-vnc] preview redirect ready",
      expect.objectContaining({
        agentId: "hello-world",
        endpointOrigin: "https://computer.test",
        endpointPath: "/vnc.html",
        requestId: traceId,
      }),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("opaque");

    const invalid = await computerApp.request("https://openbot.test/api/computer/../preview");
    expect(invalid.status).not.toBe(307);
  });

  it("does not surface an aborted computer preview request as a server error", async () => {
    const controller = new AbortController();
    const previewAgentDesktop = vi.fn(async () => {
      throw new ConnectError("aborted", Code.Canceled);
    });
    const computerApp = createApp({
      computerProvider: { previewAgentDesktop } as unknown as ComputerProvider,
      devMode: true,
      environment: { COMPUTER_ID: "computer-one" },
    });
    controller.abort();

    const response = await computerApp.request(
      "https://openbot.test/api/computer/hello-world/preview",
      { signal: controller.signal },
    );

    expect(response.status).toBe(499);
    expect(previewAgentDesktop).toHaveBeenCalledTimes(1);
  });

  it("proxies the configured Tilde ChatKit subtree without exposing credentials", async () => {
    const calls: Array<{ url: string; request: RequestInit }> = [];
    const chatApp = createApp({
      tildeChatProxy: {
        apiKey: "secret-api-key",
        orgId: "openbot-org",
        teamId: "openbot-team",
        baseUrl: "https://tilde.test",
        fetch: async (input, request) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          calls.push({ url, request: request ?? {} });
          return new Response('event: message_streaming\ndata: {"text":"Hello"}\n\n', {
            headers: {
              "content-encoding": "gzip",
              "content-length": "99",
              "content-type": "text/event-stream",
              "set-cookie": "private=true",
            },
          });
        },
      },
    });

    const response = await chatApp.request(
      "https://openbot.test/api/chat/session/session-one/observe?attach_to_child_sessions=true",
      { headers: { authorization: "Bearer browser-token", "last-event-id": "event-one" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    await expect(response.text()).resolves.toContain("message_streaming");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://tilde.test/api/v1/team/openbot-team/chatkit/session/session-one/observe?attach_to_child_sessions=true",
    );
    const headers = new Headers(calls[0]?.request.headers);
    expect(headers.get("x-api-key")).toBe("secret-api-key");
    expect(headers.get("x-tilde-org-id")).toBe("openbot-org");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("accept-encoding")).toBe("identity");
    expect(headers.get("last-event-id")).toBe("event-one");
  });

  it("exchanges the HttpOnly owner session for a direct ChatKit workspace socket ticket", async () => {
    let upstreamUrl = "";
    let upstreamHeaders = new Headers();
    let upstreamBody = "";
    const chatApp = createApp({
      authProvider: testAuthProvider(),
      tildeChatProxy: {
        apiKey: "secret-api-key",
        orgId: "openbot-org",
        teamId: "openbot-team",
        baseUrl: "https://openbot-org.api.trytilde.ai",
        fetch: async (input, request) => {
          upstreamUrl =
            input instanceof Request ? input.url : input instanceof URL ? input.href : input;
          upstreamHeaders = new Headers(request?.headers);
          upstreamBody = typeof request?.body === "string" ? request.body : "";
          return Response.json({
            ticket: "short-lived-ticket",
            protocol: "tilde.chatkit-realtime.ticket",
            expires_at: "2026-08-26T12:00:00Z",
          });
        },
      },
    });

    const response = await chatApp.request("https://openbot.test/api/chat/realtime/socket-ticket", {
      method: "POST",
      headers: { cookie: "openbot_access=browser-token", origin: "https://openbot.test" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ticket: "short-lived-ticket",
      protocol: "tilde.chatkit-realtime.ticket",
      expires_at: "2026-08-26T12:00:00Z",
      websocket_url:
        "wss://openbot-org.api.trytilde.ai/api/v1/team/openbot-team/chatkit/realtime?org_id=openbot-org",
    });
    expect(upstreamUrl).toBe(
      "https://openbot-org.api.trytilde.ai/api/v1/team/openbot-team/identity/openbot/chatkit-realtime-ticket",
    );
    expect(upstreamHeaders.get("authorization")).toBe("Bearer browser-token");
    expect(upstreamHeaders.get("x-tilde-org-id")).toBe("openbot-org");
    expect(upstreamHeaders.get("content-type")).toBe("application/json");
    expect(JSON.parse(upstreamBody)).toEqual({
      transport: "browser",
      origin: "https://openbot.test",
    });
  });

  it("marks bearer-authenticated native ChatKit workspace tickets as Origin-free", async () => {
    let upstreamBody = "";
    const chatApp = createApp({
      authProvider: testAuthProvider(),
      tildeChatProxy: {
        apiKey: "secret-api-key",
        orgId: "openbot-org",
        teamId: "openbot-team",
        baseUrl: "https://openbot-org.api.trytilde.ai",
        fetch: async (_input, request) => {
          upstreamBody = typeof request?.body === "string" ? request.body : "";
          return Response.json({
            ticket: "native-ticket",
            protocol: "tilde.chatkit-realtime.ticket",
            expires_at: "2026-08-26T12:00:00Z",
          });
        },
      },
    });

    const response = await chatApp.request("https://openbot.test/api/chat/realtime/socket-ticket", {
      method: "POST",
      headers: {
        authorization: "Bearer native-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ transport: "native" }),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(upstreamBody)).toEqual({ transport: "native" });
  });

  it("keeps explicit browser ticket semantics when a bearer is injected", async () => {
    let upstreamBody = "";
    const chatApp = createApp({
      authProvider: testAuthProvider(),
      tildeChatProxy: {
        apiKey: "secret-api-key",
        orgId: "openbot-org",
        teamId: "openbot-team",
        baseUrl: "https://openbot-org.api.trytilde.ai",
        fetch: async (_input, request) => {
          upstreamBody = typeof request?.body === "string" ? request.body : "";
          return Response.json({
            ticket: "browser-ticket",
            protocol: "tilde.chatkit-realtime.ticket",
            expires_at: "2026-08-26T12:00:00Z",
          });
        },
      },
    });

    const response = await chatApp.request("https://openbot.test/api/chat/realtime/socket-ticket", {
      method: "POST",
      headers: {
        authorization: "Bearer injected-token",
        origin: "https://openbot.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ transport: "browser" }),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(upstreamBody)).toEqual({
      transport: "browser",
      origin: "https://openbot.test",
    });
  });

  it("rejects native ticket mode for cookie-authenticated callers", async () => {
    const chatApp = createApp({
      authProvider: testAuthProvider(),
      tildeChatProxy: {
        apiKey: "secret-api-key",
        orgId: "openbot-org",
        teamId: "openbot-team",
        fetch: async () => {
          throw new Error("native cookie request must not reach Tilde");
        },
      },
    });

    const response = await chatApp.request("https://openbot.test/api/chat/realtime/socket-ticket", {
      method: "POST",
      headers: {
        cookie: "openbot_access=browser-token",
        origin: "https://openbot.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ transport: "native" }),
    });

    expect(response.status).toBe(403);
  });

  it("preserves attachment bytes and rejects paths outside ChatKit", async () => {
    let body = new Uint8Array();
    const chatApp = createApp({
      tildeChatProxy: {
        apiKey: "secret-api-key",
        orgId: "openbot-org",
        teamId: "openbot-team",
        fetch: async (_input, request) => {
          body = new Uint8Array(await new Response(request?.body).arrayBuffer());
          return Response.json({ status: "uploaded" });
        },
      },
    });
    const response = await chatApp.request(
      "https://openbot.test/api/chat/session/session-one/attachment/attachment-one/content",
      { method: "PUT", body: new Uint8Array([0, 1, 2, 255]) },
    );
    expect(response.status).toBe(200);
    expect([...body]).toEqual([0, 1, 2, 255]);

    const invalid = await chatApp.request("https://openbot.test/api/chat/session%5Ctool");
    expect(invalid.status).toBe(400);
  });

  it("rejects ChatKit operations outside the client allowlist", async () => {
    let upstreamCalls = 0;
    const chatApp = createApp({
      tildeChatProxy: {
        apiKey: "secret-api-key",
        orgId: "openbot-org",
        teamId: "openbot-team",
        fetch: async () => {
          upstreamCalls += 1;
          return new Response(null, { status: 204 });
        },
      },
    });

    const response = await chatApp.request("https://openbot.test/api/chat/agents/agent-one", {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported Tilde ChatKit operation",
    });
    expect(upstreamCalls).toBe(0);
  });

  it("proxies root ChatKit attachment content only for the configured org and team", async () => {
    const calls: string[] = [];
    const chatApp = createApp({
      tildeChatProxy: {
        apiKey: "secret-api-key",
        orgId: "openbot-org",
        teamId: "openbot-team",
        baseUrl: "https://tilde.test",
        fetch: async (input) => {
          calls.push(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          );
          return new Response(null, { status: 204 });
        },
      },
    });

    const accepted = await chatApp.request(
      "https://openbot.test/api/chat/_root/org/openbot-org/team/openbot-team/session/session-one/attachment/attachment-one/file.txt",
      { method: "PUT", body: "proof" },
    );
    expect(accepted.status).toBe(204);
    expect(calls).toEqual([
      "https://tilde.test/api/v1/chatkit/org/openbot-org/team/openbot-team/session/session-one/attachment/attachment-one/file.txt",
    ]);

    const rejected = await chatApp.request(
      "https://openbot.test/api/chat/_root/org/another-org/team/openbot-team/session/session-one/attachment/attachment-one/file.txt",
      { method: "PUT", body: "proof" },
    );
    expect(rejected.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("proxies signed R2 uploads only for the configured ChatKit org and team", async () => {
    let uploaded = new Uint8Array();
    let uploadContentType: string | null = null;
    const chatApp = createApp({
      tildeChatProxy: {
        apiKey: "secret-api-key",
        orgId: "openbot-org",
        teamId: "openbot-team",
        fetch: async (_input, request) => {
          uploaded = new Uint8Array(await new Response(request?.body).arrayBuffer());
          uploadContentType = new Headers(request?.headers).get("content-type");
          return new Response(null, { status: 200 });
        },
      },
    });
    const signedUrl =
      "https://bucket.r2.cloudflarestorage.com/data/chatkit/org/openbot-org/team/openbot-team/session/session-one/file.txt?signature=private";
    const accepted = await chatApp.request(
      `https://openbot.test/api/chat/_upload?url=${encodeURIComponent(signedUrl)}`,
      { method: "PUT", headers: { "content-type": "text/plain" }, body: "proof" },
    );
    expect(accepted.status).toBe(200);
    expect(new TextDecoder().decode(uploaded)).toBe("proof");
    expect(uploadContentType).toBe("text/plain");

    const rejected = await chatApp.request(
      `https://openbot.test/api/chat/_upload?url=${encodeURIComponent("https://evil.test/file")}`,
      { method: "PUT", body: "proof" },
    );
    expect(rejected.status).toBe(400);
  });

  it("serves built web assets and SPA routes when a web root is available", async () => {
    const webRoot = await mkdtemp(join(tmpdir(), "openbot-hono-web-"));
    temporaryRoots.push(webRoot);
    await mkdir(join(webRoot, "assets"));
    await writeFile(join(webRoot, "index.html"), "<main>OpenBot web</main>");
    await writeFile(join(webRoot, "assets", "app.js"), "export const ready = true;");
    const webApp = createApp({ webRoot });

    const asset = await webApp.request("https://openbot.test/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    const frontendRoute = await webApp.request("https://openbot.test/api/setup/unlock");
    expect(frontendRoute.status).toBe(200);
    expect(frontendRoute.headers.get("cache-control")).toBe("no-cache");
    await expect(frontendRoute.text()).resolves.toBe("<main>OpenBot web</main>");
  });
});

function ownerAuthProvider() {
  return {
    initialization: { id: "test-auth", label: "Test auth", questions: [] },
    deployable: { plan: async () => ({ summary: "test" }), deploy: async () => ({}) },
    nativeClientConfiguration: () => ({
      authorizationEndpoint: "https://identity.test/authorize",
      tokenEndpoint: "https://identity.test/token",
      clientId: "client-one",
      scope: "openid offline_access openbot:control",
    }),
    authorizationUrl: vi.fn(() => new URL("https://identity.test/authorize")),
    exchangeCode: vi.fn(async () => ({ accessToken: "fresh-token", expiresIn: 3600 })),
    refresh: vi.fn(async () => ({ accessToken: "fresh-token", expiresIn: 3600 })),
    verify: vi.fn(async () => ({
      subject: "human-one",
      groups: [],
      scope: ["openbot:control"],
    })),
  } as unknown as AuthProvider & { verify: ReturnType<typeof vi.fn> };
}
