import { describe, expect, it } from "vite-plus/test";
import { TildePlatform, tildePlatform, VercelPlatform, vercelPlatform } from "./index.js";

describe("platform initialization", () => {
  it("owns shared Tilde setup once", () => {
    expect(tildePlatform).toBeInstanceOf(TildePlatform);
    expect(tildePlatform.id).toBe("tilde");
    expect(
      tildePlatform.initialization.questions.map(({ destination }) => destination.key),
    ).toEqual([
      "TILDE_API_KEY",
      "TILDE_ORG_ID",
      "TILDE_TEAM_ID",
      "OPENBOT_DEPLOYMENT_NAME",
      "TILDE_BASE_URL",
    ]);
  });

  it("owns one configured Tilde client for all dependent providers", () => {
    const platform = new TildePlatform({
      apiKey: "test-key",
      orgId: "test-org",
      teamId: "test-team",
    });

    expect(platform.connection()).toEqual({
      apiKey: "test-key",
      orgId: "test-org",
      teamId: "test-team",
      baseUrl: "https://api.trytilde.ai",
    });
    expect(platform.client()).toBe(platform.client());
  });

  it("owns shared Vercel credentials and account scope", () => {
    expect(vercelPlatform).toBeInstanceOf(VercelPlatform);
    expect(vercelPlatform.id).toBe("vercel");
    expect(
      vercelPlatform.initialization.questions.map(({ destination }) => destination.key),
    ).toEqual(["VERCEL_TOKEN", "VERCEL_TEAM_ID"]);
  });
});
