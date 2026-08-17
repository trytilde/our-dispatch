import { describe, expect, it, vi } from "vite-plus/test";
import { createVercelAiGatewayApiKey } from "./ai-gateway.js";

describe("Vercel AI Gateway", () => {
  it("creates a named team-scoped API key", async () => {
    const request = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      Response.json({
        apiKey: { id: "key_123" },
        apiKeyString: "vck_private",
      }),
    );

    await expect(
      createVercelAiGatewayApiKey({
        token: "vercel-private",
        teamId: "team_123",
        name: "OpenBot agents",
        request,
      }),
    ).resolves.toEqual({ id: "key_123", value: "vck_private" });

    const [url, init] = request.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe("https://api.vercel.com/v1/api-keys?teamId=team_123");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer vercel-private",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ purpose: "ai-gateway", name: "OpenBot agents" }),
    });
  });

  it("does not include provider response bodies in failures", async () => {
    const request = vi.fn(
      async (..._args: Parameters<typeof fetch>) =>
        new Response("private upstream detail", { status: 403 }),
    );
    await expect(
      createVercelAiGatewayApiKey({ token: "vercel-private", name: "OpenBot", request }),
    ).rejects.toThrow("Vercel AI Gateway API key creation failed (403)");
  });
});
