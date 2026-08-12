import { describe, expect, it } from "vitest";
import { agentSource } from "./publishing.js";

describe("agent publication source", () => {
  it("generates a repository-owned agent with a code prompt", () => {
    const source = agentSource({ id: "researcher", displayName: "Researcher", description: "Find evidence" });
    expect(source).toContain('export const displayName = "Researcher"');
    expect(source).toContain("chatKitEndpoint({");
    expect(source).toContain("export async function POST(request: Request)");
    expect(source).not.toContain("defineAgent");
    expect(source).not.toContain("prompt.md");
  });
});
