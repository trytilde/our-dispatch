import { describe, expect, it } from "vitest";
import { loadRepositoryAt } from "./repository.js";

describe("repository loader", () => {
  it("loads the committed agents, skills, and sandbox contract", async () => {
    const repository = await loadRepositoryAt(new URL("../../..", import.meta.url).pathname);
    expect(repository.agents).toEqual(expect.arrayContaining([expect.objectContaining({ id: "openbot", displayName: "OpenBot", POST: expect.any(Function) })]));
    expect(repository.skills.map((skill) => skill.name)).toContain("tilde");
    expect(repository.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.sandbox.bootstrap).toContain("set -euo pipefail");
    expect(repository.config.agents.directory).toBe("configuration/agents");
    expect(repository.config.providers.directory).toBe("configuration/providers");
    expect(repository.config.sandbox.assetsDirectory).toBe("configuration/sandbox/assets");
  });
});
