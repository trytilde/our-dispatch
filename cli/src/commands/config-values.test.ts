import { describe, expect, it } from "vite-plus/test";
import { runEnvironment } from "./env.js";
import { runSecrets } from "./secrets.js";

describe("described configuration commands", () => {
  it("requires a description when setting a secret", async () => {
    await expect(runSecrets(["set", "API_TOKEN", "--stdin"])).rejects.toThrow(
      "secrets set requires --description TEXT",
    );
  });

  it("requires a description when setting an environment value", async () => {
    await expect(runEnvironment(["set", "MODEL", "gpt-test"])).rejects.toThrow(
      "env set requires --description TEXT",
    );
  });

  it("rejects descriptions for unset operations", async () => {
    await expect(runEnvironment(["unset", "MODEL", "--description", "unused"])).rejects.toThrow(
      "env unset accepts only the environment variable name",
    );
  });
});
