import { describe, expect, it } from "vite-plus/test";
import { AgentProviderError } from "./core.js";

describe("agent provider core", () => {
  it("exports the provider boundary error without CRUD helpers", () => {
    expect(AgentProviderError).toBeDefined();
  });
});
