import type { AgentProvider } from "@tryopenbot/agent-provider";
import { discoverAgents, type AgentServiceProvider } from "@tryopenbot/agent-service-provider";
import type { DeployableProvider } from "@tryopenbot/runtime-provider";
import { describe, expect, it, vi } from "vite-plus/test";
import { formatAgentLifecycleProgress, reconcileAgentResources } from "./agent-lifecycle.js";

vi.mock("@tryopenbot/agent-service-provider", async (importOriginal) => ({
  ...(await importOriginal()),
  discoverAgents: vi.fn(async () => [
    {
      slug: "research-assistant",
      kind: "subagent",
      directory: "/repository/configuration/agent/subagents/research-assistant",
      path: "/repository/configuration/agent/subagents/research-assistant/agent.ts",
    },
  ]),
}));

describe("agent resource lifecycle", () => {
  it("runs the aggregate agent-resource lifecycle once per agent", async () => {
    const calls: string[] = [];
    const provider = (id: string): DeployableProvider => ({
      buildable: {
        check: async (context) => {
          expect(context.agentId).toBe("research-assistant");
          expect(context.agentPath).toBe(
            "/repository/configuration/agent/subagents/research-assistant",
          );
          expect(context.platformIds).toEqual(["vercel"]);
          calls.push(`${id}.check`);
        },
        build: async () => {
          calls.push(`${id}.build`);
        },
      },
      deployable: {
        plan: async () => ({ summary: id }),
        deploy: async () => {
          calls.push(`${id}.deploy`);
        },
      },
    });

    await reconcileAgentResources({
      repositoryRoot: "/repository",
      environment: {},
      devMode: true,
      providers: {
        agent: provider("agent") as AgentProvider,
        agentService: {
          baseUrl: vi.fn(() => new URL("http://127.0.0.1:4100")),
          platforms: [{ id: "vercel" }],
        } as unknown as AgentServiceProvider,
      },
    });

    expect(calls).toEqual(["agent.check", "agent.build", "agent.deploy"]);
  });

  it("can reconcile only the requested authored agent", async () => {
    vi.mocked(discoverAgents).mockResolvedValueOnce([
      {
        slug: "research-assistant",
        kind: "subagent",
        directory: "/repository/configuration/agent/subagents/research-assistant",
        path: "/repository/configuration/agent/subagents/research-assistant/agent.ts",
      },
      {
        slug: "unrelated-agent",
        kind: "subagent",
        directory: "/repository/configuration/agent/subagents/unrelated-agent",
        path: "/repository/configuration/agent/subagents/unrelated-agent/agent.ts",
      },
    ]);
    const deployedAgentIds: string[] = [];

    await reconcileAgentResources({
      repositoryRoot: "/repository",
      agentIds: ["research-assistant"],
      environment: {},
      devMode: true,
      providers: {
        agent: {
          deployable: {
            plan: async () => ({ summary: "agent" }),
            deploy: async (context) => {
              deployedAgentIds.push(context.agentId!);
            },
          },
        } as AgentProvider,
        agentService: {
          baseUrl: () => new URL("http://127.0.0.1:4100"),
        } as unknown as AgentServiceProvider,
      },
    });

    expect(deployedAgentIds).toEqual(["research-assistant"]);
  });

  it("formats concise per-agent progress", () => {
    expect(
      formatAgentLifecycleProgress({
        event: "agent.lifecycle.started",
        details: { total: 3 },
      }),
    ).toBe("Reconciling Tilde resources for 3 authored agents");
    expect(
      formatAgentLifecycleProgress({
        event: "agent.reconcile.started",
        details: { agentId: "hello-world", index: 1, total: 3 },
      }),
    ).toBe("[1/3] Deploying hello-world agent");
  });

  it("uses an explicitly routed agent service origin", async () => {
    const baseUrl = vi.fn(() => new URL("http://127.0.0.1:4100"));
    const deploy = vi.fn(async (context) => {
      expect(context.agentServiceOrigin).toBe("https://local.trytilde-sb.com");
    });

    await reconcileAgentResources({
      repositoryRoot: "/repository",
      environment: {},
      devMode: true,
      agentServiceOrigin: "https://local.trytilde-sb.com/",
      providers: {
        agent: {
          deployable: { plan: async () => ({ summary: "agent" }), deploy },
        } as AgentProvider,
        agentService: { baseUrl } as unknown as AgentServiceProvider,
      },
    });

    expect(deploy).toHaveBeenCalledOnce();
    expect(baseUrl).not.toHaveBeenCalled();
  });

  it("attributes an agent reconciliation failure to its provider implementation", async () => {
    class TildeAgentProvider {
      readonly deployable = {
        plan: async () => ({ summary: "agent resources" }),
        deploy: async () => {
          throw new Error("authentication error: Invalid API key");
        },
      };
    }

    await expect(
      reconcileAgentResources({
        repositoryRoot: "/repository",
        environment: {},
        devMode: true,
        providers: {
          agent: new TildeAgentProvider() as AgentProvider,
          agentService: {
            baseUrl: () => new URL("http://127.0.0.1:4100"),
          } as unknown as AgentServiceProvider,
        },
      }),
    ).rejects.toThrow(
      "authentication error: Invalid API key (occurred in the Tilde implementation of the Agent Provider)",
    );
  });
});
