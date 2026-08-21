import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  input: vi.fn(),
  loadDevelopmentConfiguration: vi.fn(async () => ({ providers: {} })),
  loadLocalEnvironment: vi.fn(async () => ({
    AGENT_SERVICE_ORIGIN: "https://local.trytilde-sb.com",
  })),
  reconcileAgentResources: vi.fn(async () => undefined),
  scaffoldAgent: vi.fn(async () => ({
    id: "research-assistant",
    name: "Research Assistant",
    directory: "/repository/configuration/agent/subagents/research-assistant",
  })),
  setEnvironmentValue: vi.fn(async () => undefined),
}));

vi.mock("../agent-lifecycle.js", () => ({
  formatAgentLifecycleProgress: vi.fn(),
  reconcileAgentResources: mocks.reconcileAgentResources,
}));
vi.mock("../agent-scaffold.js", () => ({ scaffoldAgent: mocks.scaffoldAgent }));
vi.mock("../environment.js", () => ({ loadLocalEnvironment: mocks.loadLocalEnvironment }));
vi.mock("../initialization.js", () => ({ setEnvironmentValue: mocks.setEnvironmentValue }));
vi.mock("../paths.js", () => ({ repositoryRoot: "/repository" }));
vi.mock("./dev.js", () => ({
  loadDevelopmentConfiguration: mocks.loadDevelopmentConfiguration,
}));
vi.mock("./init.js", () => ({ inkPrompts: { input: mocks.input } }));

import { runNewAgent } from "./new-agent.js";

describe("new-agent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists a supplied display name before reconciling the agent", async () => {
    await runNewAgent(["--json", "Research Assistant"]);

    expect(mocks.input).not.toHaveBeenCalled();
    expect(mocks.scaffoldAgent).toHaveBeenCalledWith("/repository", "Research Assistant", {
      existing: "preserve",
    });
    expect(mocks.setEnvironmentValue).toHaveBeenCalledWith(
      "/repository",
      "AGENT_RESEARCH_ASSISTANT_NAME",
      "Research Assistant",
      "Display name for the research-assistant agent.",
    );
    expect(mocks.setEnvironmentValue.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.loadLocalEnvironment.mock.invocationCallOrder[0]!,
    );
  });

  it("resumes reconciliation without overwriting an existing agent", async () => {
    await runNewAgent(["Research Assistant", "--json"]);

    expect(mocks.scaffoldAgent).toHaveBeenCalledWith("/repository", "Research Assistant", {
      existing: "preserve",
    });
    expect(mocks.reconcileAgentResources).toHaveBeenCalledWith(
      expect.objectContaining({
        agentIds: ["research-assistant"],
        agentServiceOrigin: "https://local.trytilde-sb.com",
      }),
    );
  });
});
