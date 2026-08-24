import { describe, expect, it } from "vite-plus/test";
import { runSdk, sdkHelpText } from "./sdk.js";

describe("OpenBot SDK command", () => {
  it("documents every SDK workflow", () => {
    expect(sdkHelpText()).toContain("refresh|validate|smoke|publish");
  });

  it("requires explicit publication confirmation", async () => {
    await expect(runSdk(["publish"])).rejects.toThrow("requires `openbot sdk publish --yes`");
  });
});
