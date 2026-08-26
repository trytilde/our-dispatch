import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { startRendererServer, type RendererServer } from "./local-server.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("Electron renderer server", () => {
  it("serves SPA fallbacks and streams control requests with loopback cookies", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "openbot-electron-web-"));
    await writeFile(join(staticRoot, "index.html"), "<main>OpenBot renderer</main>");
    const upstream = createServer((request, response) => {
      response.setHeader(
        "set-cookie",
        "openbot_session=example; HttpOnly; Secure; SameSite=Strict",
      );
      response.end(
        `${request.url}:${request.headers.cookie ?? "none"}:${request.headers.authorization ?? "none"}`,
      );
    });
    await new Promise<void>((resolvePromise) => upstream.listen(0, "127.0.0.1", resolvePromise));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("test upstream did not bind");
    const renderer: RendererServer = await startRendererServer(
      staticRoot,
      `http://127.0.0.1:${address.port}`,
      {
        accessToken: async () => "desktop-token",
        tildeBaseUrl: "https://openbot-org.api.trytilde.ai/path-is-ignored",
      },
    );
    cleanups.push(async () => renderer.close());
    cleanups.push(
      async () => new Promise<void>((resolvePromise) => upstream.close(() => resolvePromise())),
    );
    cleanups.push(async () => rm(staticRoot, { recursive: true, force: true }));

    const rendered = await fetch(`${renderer.origin}/agents/one`);
    expect(await rendered.text()).toContain("OpenBot renderer");
    expect(rendered.headers.get("content-security-policy")).toContain(
      "connect-src 'self' wss://openbot-org.api.trytilde.ai",
    );
    const proxied = await fetch(`${renderer.origin}/healthz`, {
      headers: { cookie: "client=value" },
    });
    expect(await proxied.text()).toBe("/healthz:client=value:Bearer desktop-token");

    const frontendRoute = await fetch(`${renderer.origin}/api/setup/unlock`);
    expect(await frontendRoute.text()).toBe("/api/setup/unlock:none:Bearer desktop-token");
    const chatRoute = await fetch(`${renderer.origin}/api/chat/mission-control/sidebar`);
    expect(await chatRoute.text()).toBe(
      "/api/chat/mission-control/sidebar:none:Bearer desktop-token",
    );
    expect(proxied.headers.get("set-cookie")).toContain("HttpOnly");
    expect(proxied.headers.get("set-cookie")).not.toContain("Secure");
  });
});
