import { describe, expect, it, vi } from "vite-plus/test";
import {
  buildProviders,
  collectProviderInitializations,
  deployProviders,
  DeploymentOutputs,
  initializeProviders,
  persistEnvironment,
  persistSecret,
  unsetEnvironment,
  unsetSecret,
  type DeploymentContext,
} from "./core.js";

describe("runtime provider lifecycle", () => {
  it("deduplicates shared platform initialization", () => {
    const platform = {
      id: "tilde",
      initialization: {
        id: "tilde",
        label: "Tilde",
        questions: [],
      },
    };
    expect(
      collectProviderInitializations([{ platforms: [platform] }, { platforms: [platform] }]),
    ).toEqual([platform.initialization]);
  });

  it("runs initialization provisioning once per stable provider ID", async () => {
    const initialize = vi.fn(async () => undefined);
    const provider = {
      initialization: { id: "inference", label: "Inference", questions: [] },
      initialize,
    };
    const context = {
      repositoryRoot: "/repository",
      environment: {},
      setEnvironment: vi.fn(async () => undefined),
      setSecret: vi.fn(async () => undefined),
    };
    await initializeProviders([provider, provider], context);
    expect(initialize).toHaveBeenCalledOnce();
  });

  it("attributes initialization failures to the concrete provider", async () => {
    class TildeAgentProvider {
      readonly initialization = { id: "tilde-tools", label: "Tilde tools", questions: [] };
      async initialize() {
        throw new Error("Invalid API key");
      }
    }

    await expect(
      initializeProviders([new TildeAgentProvider()], {
        repositoryRoot: "/repository",
        environment: {},
        setEnvironment: async () => undefined,
        setSecret: async () => undefined,
      }),
    ).rejects.toThrow(
      "Invalid API key (occurred in the Tilde implementation of the Agent Provider)",
    );
  });

  it("retains named non-secret outputs", () => {
    const outputs = new DeploymentOutputs();
    outputs.merge({ outputs: { artifact: "/tmp/artifact" } });
    expect(outputs.require("artifact")).toBe("/tmp/artifact");
    expect(() => outputs.merge({ outputs: { artifact: "/tmp/other" } })).toThrow(
      "Conflicting deployment output: artifact",
    );
  });

  it("persists environment and secrets through the mutable context", async () => {
    const environment: NodeJS.ProcessEnv = {};
    const configuration: NodeJS.ProcessEnv = {};
    const persistence = {
      setEnvironment: vi.fn(async () => undefined),
      setSecret: vi.fn(async () => undefined),
      unsetEnvironment: vi.fn(async () => undefined),
      unsetSecret: vi.fn(async () => undefined),
    };
    const context = {
      devMode: true,
      repositoryRoot: "/repository",
      environment,
      configuration,
      persistence,
      inputs: new DeploymentOutputs(),
      report: () => undefined,
    } satisfies DeploymentContext;
    await persistEnvironment(context, "AGENT_ID", "agent", "Agent ID");
    await persistSecret(context, "AGENT_KEY", "private", "Agent key");
    expect(environment).toEqual({ AGENT_ID: "agent", AGENT_KEY: "private" });
    expect(configuration).toEqual({ AGENT_ID: "agent", AGENT_KEY: "private" });
    await unsetEnvironment(context, "AGENT_ID");
    await unsetSecret(context, "AGENT_KEY");
    expect(environment).toEqual({});
    expect(configuration).toEqual({});
    expect(persistence.setEnvironment).toHaveBeenCalledWith("AGENT_ID", "agent", "Agent ID");
    expect(persistence.setSecret).toHaveBeenCalledWith("AGENT_KEY", "private", "Agent key");
  });

  it("builds and deploys in lifecycle order while carrying outputs", async () => {
    const calls: string[] = [];
    const participant = {
      id: "service",
      provider: {
        buildable: {
          check: async (context: DeploymentContext) => {
            expect(context.devMode).toBe(false);
            calls.push("check");
          },
          build: async (context: DeploymentContext) => {
            expect(context.devMode).toBe(false);
            calls.push("build");
            return { outputs: { artifact: "/tmp/service" } };
          },
        },
        deployable: {
          plan: async (context: DeploymentContext) => {
            expect(context.devMode).toBe(false);
            calls.push("plan");
            return { summary: "service" };
          },
          configure: async ({ inputs }: DeploymentContext) => {
            expect(inputs.require("artifact")).toBe("/tmp/service");
            calls.push("configure");
          },
          deploy: async (context: DeploymentContext) => {
            expect(context.devMode).toBe(false);
            calls.push("deploy");
          },
        },
      },
    };
    const built = await buildProviders([participant], {
      devMode: false,
      dryRun: false,
      repositoryRoot: "/repository",
      environment: {},
    });
    await deployProviders([participant], {
      devMode: false,
      dryRun: false,
      repositoryRoot: "/repository",
      environment: {},
      initialInputs: built.result(),
    });
    expect(calls).toEqual(["check", "build", "plan", "configure", "deploy"]);
  });

  it("attributes lifecycle failures to the concrete provider implementation", async () => {
    class VercelToolProvider {
      readonly buildable = {
        check: async () => {
          throw new Error("authentication error: Invalid API key");
        },
        build: async () => undefined,
      };
    }
    const provider = new VercelToolProvider();

    await expect(
      buildProviders([{ id: "tools", provider }], {
        devMode: true,
        dryRun: false,
        repositoryRoot: "/repository",
      }),
    ).rejects.toMatchObject({
      message:
        "authentication error: Invalid API key (occurred in the Vercel implementation of the Tools Provider)",
      cause: expect.objectContaining({ message: "authentication error: Invalid API key" }),
      operation: "check",
    });
  });
});
