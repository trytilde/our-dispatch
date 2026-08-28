import { describe, expect, it } from "vite-plus/test";
import config from "./vite.config";

describe("development control-service proxy", () => {
  it("forwards every owner API surface through the consolidated control server", () => {
    const proxy = (config as { server?: { proxy?: Record<string, unknown> } }).server?.proxy ?? {};
    const prefixes = Object.keys(proxy);

    for (const path of [
      "/api/agents",
      "/api/chat/workspace/bootstrap",
      "/api/computer/preview",
      "/api/connectors/catalog",
      "/api/plugins",
      "/api/routines",
      "/api/signals/providers",
    ]) {
      expect(
        prefixes.some((prefix) => path.startsWith(prefix)),
        path,
      ).toBe(true);
    }
  });
});
