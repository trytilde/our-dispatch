import { describe, expect, it, vi } from "vite-plus/test";
import { DeploymentOutputs, type DeploymentContext } from "@tryopenbot/runtime-provider";
import {
  ensureVercelProject,
  installVercelEnvironment,
  requiredVercelProject,
  vercelDeploymentUrl,
  vercelScopeArguments,
  type VercelCommandRunner,
} from "./deployment.js";

describe("Vercel deployment helpers", () => {
  it("owns project validation, team scope, and deployment URL parsing", () => {
    expect(
      requiredVercelProject({ VERCEL_AGENT_PROJECT: " agents " }, "VERCEL_AGENT_PROJECT"),
    ).toBe("agents");
    expect(() => requiredVercelProject({}, "VERCEL_CONTROL_PROJECT")).toThrow(
      "VERCEL_CONTROL_PROJECT is required",
    );
    expect(vercelScopeArguments({ VERCEL_TEAM_ID: "team-one" })).toEqual(["--scope", "team-one"]);
    expect(vercelDeploymentUrl('{"deploymentUrl":"agents.vercel.app"}')).toBe(
      "https://agents.vercel.app",
    );
  });

  it("creates a missing project in the configured scope", async () => {
    const run = vi.fn<VercelCommandRunner["run"]>(async (_command, args) => {
      if (args.includes("inspect")) throw new Error("missing");
      return { stdout: "", stderr: "" };
    });

    await ensureVercelProject(
      { run },
      { repositoryRoot: "/repo", environment: { VERCEL_TEAM_ID: "team-one" } },
      "agents",
    );

    expect(run).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      ["exec", "vercel", "project", "add", "agents", "--scope", "team-one"],
      { cwd: "/repo", environment: { VERCEL_TEAM_ID: "team-one" } },
    );
  });

  it("installs the combined environment as sensitive values", async () => {
    const inputs = new DeploymentOutputs();
    const context: DeploymentContext = {
      devMode: false,
      repositoryRoot: "/repo",
      environment: {
        HOME: "/root",
        PUBLIC_ORIGIN: "https://openbot.test",
        API_KEY: "private",
        VERCEL_TOKEN: "deployment-only",
        SOPS_AGE_KEY: "sandbox-only",
      },
      configuration: {
        PUBLIC_ORIGIN: "https://openbot.test",
        API_KEY: "private",
        VERCEL_TOKEN: "deployment-only",
        SOPS_AGE_KEY: "sandbox-only",
      },
      inputs,
      report: () => undefined,
    };
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    await installVercelEnvironment(context, "openbot", request);

    expect(request).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls.map((call) => {
        const body = call[1]?.body;
        if (typeof body !== "string") throw new Error("expected a JSON request body");
        return JSON.parse(body);
      }),
    ).toEqual([
      {
        type: "sensitive",
        key: "PUBLIC_ORIGIN",
        value: "https://openbot.test",
        target: ["production"],
      },
      { type: "sensitive", key: "API_KEY", value: "private", target: ["production"] },
    ]);
    expect(request.mock.calls[0]?.[0]).toEqual(
      new URL("https://api.vercel.com/v10/projects/openbot/env?upsert=true"),
    );
  });
});
