import { describe, expect, it, vi } from "vite-plus/test";
import { ExeDevPlatform } from "@tryopenbot/platform-integrations";
import type { ComputerProvider } from "../core/index.js";
import { ExeDevComputerProvider } from "./index.js";

describe("ExeDevComputerProvider", () => {
  it("routes noVNC and its WebSocket through the public owner origin", async () => {
    const computer = {
      buildable: { check: vi.fn(), build: vi.fn() },
      deployable: { plan: vi.fn(), deploy: vi.fn() },
      previewAgentDesktop: vi.fn().mockResolvedValue({
        url: new URL("http://127.0.0.1:6080/openbot.html?path=websockify%3Ftoken%3Dcap&scale=true"),
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      }),
    } as unknown as ComputerProvider;
    const provider = new ExeDevComputerProvider({
      platform: new ExeDevPlatform({ vm: "openbot" }),
      computer,
    });

    const endpoint = await provider.previewAgentDesktop("factory", {
      requestId: "request",
      environment: {},
    });

    expect(endpoint.url.origin).toBe("https://openbot.exe.xyz");
    expect(endpoint.url.pathname).toBe("/computer-vnc/openbot.html");
    expect(endpoint.url.searchParams.get("path")).toBe("computer-vnc/websockify?token=cap");
    expect(endpoint.url.searchParams.get("scale")).toBe("true");
  });
});
