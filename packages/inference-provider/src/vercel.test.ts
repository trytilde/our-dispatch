import { VercelPlatform } from "@tryopenbot/platform-integrations";
import { describe, expect, it, vi } from "vite-plus/test";
import { HOSTED_INFERENCE_BILLING, VercelInferenceProvider } from "./vercel.js";

describe("VercelInferenceProvider", () => {
  it("provisions and persists the canonical AI Gateway secret", async () => {
    const request = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      Response.json({ apiKey: { id: "key_123" }, apiKeyString: "gateway-private" }),
    );
    const provider = new VercelInferenceProvider(new VercelPlatform({ request }));
    const setSecret = vi.fn(async () => undefined);
    await provider.initialize({
      repositoryRoot: "/repository",
      environment: {
        VERCEL_TOKEN: "vercel-private",
        VERCEL_TEAM_ID: "team_123",
        VERCEL_AI_GATEWAY_API_KEY_NAME: "OpenBot agents",
      },
      setEnvironment: vi.fn(async () => undefined),
      setSecret,
    });
    expect(setSecret).toHaveBeenCalledWith(
      "AI_GATEWAY_API_KEY",
      "gateway-private",
      "Vercel AI Gateway API key used by authored agents.",
    );
  });

  it("records the selection without creating another key when one is configured", async () => {
    const request = vi.fn();
    const provider = new VercelInferenceProvider(new VercelPlatform({ request }));
    const setEnvironment = vi.fn(async () => undefined);
    await provider.initialize({
      repositoryRoot: "/repository",
      environment: {
        AI_GATEWAY_API_KEY: "existing",
        AI_MODEL: "gpt-5.6-sol",
        INFERENCE_PROVIDER: "codex-subscription",
      },
      setEnvironment,
      setSecret: vi.fn(async () => undefined),
    });
    expect(setEnvironment).toHaveBeenCalledWith(
      "INFERENCE_PROVIDER",
      "vercel-ai-gateway",
      expect.any(String),
    );
    expect(setEnvironment).toHaveBeenCalledWith(
      "AI_MODEL",
      "openai/gpt-5.6-sol",
      expect.any(String),
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("preserves an existing model when upgrading an installation without a provider marker", async () => {
    const provider = new VercelInferenceProvider(new VercelPlatform({ request: vi.fn() }));
    const setEnvironment = vi.fn(async () => undefined);
    await provider.initialize({
      repositoryRoot: "/repository",
      environment: {
        AI_GATEWAY_API_KEY: "existing",
        AI_MODEL: "openai/gpt-5.2",
      },
      setEnvironment,
      setSecret: vi.fn(async () => undefined),
    });

    expect(setEnvironment).not.toHaveBeenCalledWith(
      "AI_MODEL",
      expect.anything(),
      expect.anything(),
    );
  });

  it("enables credit metering only for managed project OIDC", async () => {
    const managedSetEnvironment = vi.fn(async () => undefined);
    await new VercelInferenceProvider(new VercelPlatform({ managed: true })).initialize({
      repositoryRoot: "/repository",
      environment: {},
      setEnvironment: managedSetEnvironment,
      setSecret: vi.fn(async () => undefined),
    });
    expect(managedSetEnvironment).toHaveBeenCalledWith(
      HOSTED_INFERENCE_BILLING,
      "1",
      expect.any(String),
    );

    const directSetEnvironment = vi.fn(async () => undefined);
    await new VercelInferenceProvider(new VercelPlatform({ request: vi.fn() })).initialize({
      repositoryRoot: "/repository",
      environment: { AI_GATEWAY_API_KEY: "owner-key" },
      setEnvironment: directSetEnvironment,
      setSecret: vi.fn(async () => undefined),
    });
    expect(directSetEnvironment).toHaveBeenCalledWith(
      HOSTED_INFERENCE_BILLING,
      "0",
      expect.any(String),
    );
  });
});
