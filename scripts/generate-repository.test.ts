import { describe, expect, it } from "vitest";
import { generatedSource } from "./generate-repository.js";

describe("repository manifest generation", () => {
  it("generates stable agent and provider imports", () => {
    const source = generatedSource(["configuration/agents/openbot.ts", "configuration/providers/custom/index.ts", "configuration/skills/tilde/SKILL.md"]);
    expect(source).toContain('import * as agent0 from "../../../../configuration/agents/openbot.js";');
    expect(source).toContain('import provider0 from "../../../../configuration/providers/custom/index.js";');
    expect(source).not.toContain('"agents/openbot.ts"');
    expect(source).not.toContain('"providers/custom/index.ts"');
    expect(source).toContain("repositoryAgents = [agent0]");
  });
});
