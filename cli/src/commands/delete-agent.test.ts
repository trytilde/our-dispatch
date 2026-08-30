import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  discoverAgents: vi.fn(async () => [
    {
      slug: "factory",
      kind: "primary" as const,
      directory: "/repository/configuration/agent",
      path: "/repository/configuration/agent/agent.ts",
    },
    {
      slug: "research-assistant",
      kind: "subagent" as const,
      directory: "/repository/configuration/agent/subagents/research-assistant",
      path: "/repository/configuration/agent/subagents/research-assistant/agent.ts",
    },
  ]),
  loadDevelopmentConfiguration: vi.fn(async () => ({ providers: {} })),
  loadLocalEnvironment: vi.fn(async () => ({
    AGENT_RESEARCH_ASSISTANT_NAME: "Research Assistant",
  })),
  readLiveAgentServiceOrigin: vi.fn(async () => "https://local.trytilde-sb.com"),
  removeAgentResources: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
}));

vi.mock("node:fs/promises", () => ({ rm: mocks.rm }));
vi.mock("@tryopenbot/agent-service-provider", async (importOriginal) => ({
  ...(await importOriginal()),
  discoverAgents: mocks.discoverAgents,
}));
vi.mock("../agent-lifecycle.js", () => ({ removeAgentResources: mocks.removeAgentResources }));
vi.mock("../environment.js", () => ({ loadLocalEnvironment: mocks.loadLocalEnvironment }));
vi.mock("../live-agent-service.js", () => ({
  readLiveAgentServiceOrigin: mocks.readLiveAgentServiceOrigin,
}));
vi.mock("../paths.js", () => ({ repositoryRoot: "/repository" }));
vi.mock("./dev.js", () => ({
  loadDevelopmentConfiguration: mocks.loadDevelopmentConfiguration,
}));

import { runDeleteAgent } from "./delete-agent.js";

describe("delete-agent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes managed resources before deleting authored source", async () => {
    const result = await runDeleteAgent(["research-assistant", "--yes", "--json"]);

    expect(result).toMatchObject({
      agent: { id: "research-assistant", name: "Research Assistant" },
      json: true,
    });
    expect(mocks.removeAgentResources).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "research-assistant",
        agentServiceOrigin: "https://local.trytilde-sb.com",
      }),
    );
    expect(mocks.removeAgentResources.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.rm.mock.invocationCallOrder[0]!,
    );
    expect(mocks.rm).toHaveBeenCalledWith(
      "/repository/configuration/agent/subagents/research-assistant",
      { recursive: true, force: true },
    );
  });

  it("requires explicit confirmation and protects Factory", async () => {
    await expect(runDeleteAgent(["research-assistant"])).rejects.toThrow("requires --yes");
    await expect(runDeleteAgent(["factory", "--yes"])).rejects.toThrow(
      "Factory agent cannot be deleted",
    );
    expect(mocks.removeAgentResources).not.toHaveBeenCalled();
    expect(mocks.rm).not.toHaveBeenCalled();
  });

  it("retries cleanup after the authored directory is already absent", async () => {
    mocks.discoverAgents.mockResolvedValueOnce([
      {
        slug: "factory",
        kind: "primary",
        directory: "/repository/configuration/agent",
        path: "/repository/configuration/agent/agent.ts",
      },
    ]);

    await runDeleteAgent(["research-assistant", "--yes"]);

    expect(mocks.removeAgentResources).toHaveBeenCalledWith(
      expect.objectContaining({
        agentPath: "/repository/configuration/agent/subagents/research-assistant",
      }),
    );
    expect(mocks.rm).toHaveBeenCalledWith(
      "/repository/configuration/agent/subagents/research-assistant",
      { recursive: true, force: true },
    );
  });
});
