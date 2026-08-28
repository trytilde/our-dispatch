import { describe, expect, it } from "vite-plus/test";
import { buildProviders, type DeploymentContext } from "@tryopenbot/runtime-provider";
import {
  agentEndpointCutoverOrigins,
  deploymentScope,
  parseOptions,
  redact,
  serviceDeploymentParticipants,
} from "./deploy.js";

describe("deploy-prod", () => {
  it("parses the minimal deployment options", () => {
    expect(parseOptions(["--", "--yes", "--json"])).toEqual({
      yes: true,
      dryRun: false,
      json: true,
      skipDeploy: false,
      skipAgentReconcile: false,
      service: "all",
    });
    expect(parseOptions(["--dry-run"])).toEqual({
      yes: false,
      dryRun: true,
      json: false,
      skipDeploy: false,
      skipAgentReconcile: false,
      service: "all",
    });
    expect(parseOptions(["--skip-deploy", "--service", "agents"])).toEqual({
      yes: false,
      dryRun: false,
      json: false,
      skipDeploy: true,
      skipAgentReconcile: false,
      service: "agents",
    });
    expect(() => parseOptions(["--service", "unknown"])).toThrow("Unsupported deploy service");
    expect(() => parseOptions(["--resume"])).toThrow("unknown or unexpected option: --resume");
  });

  it("redacts the Vercel token", () => {
    expect(redact("VERCEL_TOKEN=secret-value", ["secret-value"])).toBe("VERCEL_TOKEN=[REDACTED]");
  });

  it("treats legacy partial selectors as whole-runtime deployments after consolidation", () => {
    for (const service of ["all", "agents", "control"] as const)
      expect(deploymentScope(service, true)).toEqual({
        deployAgents: true,
        deployControl: true,
        deployComputer: true,
      });

    expect(deploymentScope("agents", false)).toEqual({
      deployAgents: true,
      deployControl: false,
      deployComputer: false,
    });
    expect(deploymentScope("control", false)).toEqual({
      deployAgents: false,
      deployControl: true,
      deployComputer: false,
    });
  });

  it("parses the explicit agent reconciliation escape hatch", () => {
    expect(parseOptions(["--yes", "--skip-agent-reconcile"])).toMatchObject({
      yes: true,
      skipAgentReconcile: true,
    });
  });

  it("builds the consolidated runtime before inference consumes its agent artifact", async () => {
    const calls: string[] = [];
    const runtime = {
      check: async () => undefined,
      build: async () => {
        calls.push("runtime.build");
        return { outputs: { "agent-service.artifact": "/runtime" } };
      },
      plan: async () => ({ summary: "runtime" }),
      deploy: async () => undefined,
      initialization: { id: "runtime", label: "Runtime", questions: [] },
      baseUrl: () => new URL("https://runtime.example"),
    };
    const inference = {
      buildable: {
        check: async () => undefined,
        build: async (context: DeploymentContext) => {
          calls.push(`inference.build:${context.inputs.require("agent-service.artifact")}`);
        },
      },
    };
    const participants = serviceDeploymentParticipants({
      agentService: runtime,
      controlService: runtime,
      inference,
      deployAgents: true,
      consolidatedRuntime: true,
    } as never);

    expect(participants.map(({ id, role }) => [id, role])).toEqual([
      ["runtime-service", "runtime"],
      ["inference", undefined],
    ]);
    await buildProviders(participants, {
      devMode: false,
      dryRun: false,
      repositoryRoot: "/repository",
    });
    expect(calls).toEqual(["runtime.build", "inference.build:/runtime"]);
  });

  it("keeps a split endpoint until the consolidated runtime is ready for cutover", () => {
    expect(
      agentEndpointCutoverOrigins({
        consolidatedRuntime: true,
        environment: { AGENT_SERVICE_ORIGIN: "https://openbot-agents.vercel.app/" },
        targetOrigin: "https://openbot-runtime.vercel.app/",
      }),
    ).toEqual({
      preparationOrigin: "https://openbot-agents.vercel.app",
      targetOrigin: "https://openbot-runtime.vercel.app",
    });
    expect(
      agentEndpointCutoverOrigins({
        consolidatedRuntime: false,
        environment: { AGENT_SERVICE_ORIGIN: "https://stale.example" },
        targetOrigin: "https://openbot-agents.vercel.app",
      }),
    ).toEqual({
      preparationOrigin: "https://openbot-agents.vercel.app",
      targetOrigin: "https://openbot-agents.vercel.app",
    });
  });
});
