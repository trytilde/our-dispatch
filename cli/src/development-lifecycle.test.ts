import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenBotConfiguration } from "@tryopenbot/configuration";
import type { DeploymentContext, DeployableProvider } from "@tryopenbot/runtime-provider";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  developmentInputFingerprint,
  reconcileDevelopmentInfrastructure,
} from "./development-lifecycle.js";

vi.mock("@tryopenbot/agent-service-provider", async (importOriginal) => ({
  ...(await importOriginal()),
  discoverAgentWorkspaces: vi.fn(async () => []),
}));

describe("development lifecycle", () => {
  it("fingerprints watched inputs by content instead of filesystem notifications", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-computer-watch-"));
    const source = join(root, "source.ts");
    await writeFile(source, "export const value = 1;\n");
    const before = await developmentInputFingerprint([source]);
    await writeFile(source, "export const value = 1;\n");
    expect(await developmentInputFingerprint([source])).toBe(before);
    await writeFile(source, "export const value = 2;\n");
    expect(await developmentInputFingerprint([source])).not.toBe(before);
  });

  it("passes development mode through checks and lifecycle hooks", async () => {
    const calls: string[] = [];
    const provider = (id: string): DeployableProvider => ({
      buildable: {
        check: async (context) => record(context, `${id}.check`, calls),
        build: async (context) => record(context, `${id}.build`, calls),
      },
      deployable: {
        plan: async (context) => {
          record(context, `${id}.plan`, calls);
          return { summary: id };
        },
        configure: async (context) => record(context, `${id}.configure`, calls),
        deploy: async (context) => record(context, `${id}.deploy`, calls),
      },
    });
    const computer = {
      ...provider("computer"),
      deployAgentWorkspaces: vi.fn(async (_request, context: DeploymentContext) =>
        record(context, "computer.workspaces", calls),
      ),
      deployDevelopmentSandbox: vi.fn(async () => undefined),
    };
    const service = (id: string) => ({
      ...provider(id).buildable!,
      ...provider(id).deployable!,
      baseUrl: () => new URL("http://127.0.0.1:4100"),
    });
    const providers = {
      computer,
      agentService: service("agents"),
      controlService: service("control"),
      auth: provider("auth"),
    } as unknown as OpenBotConfiguration["providers"];

    await reconcileDevelopmentInfrastructure({
      repositoryRoot: "/repository",
      environment: { COMPUTER_SERVICE_API_KEY: "x".repeat(32) },
      providers,
      report: vi.fn(),
    });

    expect(calls).toEqual([
      "computer.check",
      "computer.build",
      "agents.check",
      "agents.build",
      "control.check",
      "control.build",
      "auth.check",
      "auth.build",
      "computer.plan",
      "agents.plan",
      "control.plan",
      "auth.plan",
      "computer.configure",
      "agents.configure",
      "control.configure",
      "auth.configure",
      "computer.deploy",
      "agents.deploy",
      "auth.deploy",
      "control.deploy",
      "computer.workspaces",
    ]);
  });
});

function record(context: DeploymentContext, call: string, calls: string[]): undefined {
  expect(context.devMode).toBe(true);
  calls.push(call);
  return undefined;
}
