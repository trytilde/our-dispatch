import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ComputerProvider } from "@tryopenbot/computer-provider";
import { app, createApp } from "./app.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bare OpenBot server", () => {
  it("reports healthy without setup", async () => {
    const response = await app.request("https://openbot.test/healthz");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "openbot" });
  });

  it("does not expose an API namespace", async () => {
    const response = await app.request("https://openbot.test/api/setup/unlock", { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("opens only the selected agent's capability-scoped computer preview", async () => {
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
      "https://openbot.test/api/computer/hello-world/preview",
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://computer.test/vnc.html?token=opaque");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(previewAgentDesktop).toHaveBeenCalledWith(
      "hello-world",
      expect.objectContaining({
        requestId: expect.any(String),
        devMode: true,
        environment: { COMPUTER_ID: "computer-one" },
      }),
    );

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
