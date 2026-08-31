import type { ControlServiceProvider } from "@tryopenbot/control-service-provider";
import { describe, expect, expectTypeOf, it, vi } from "vite-plus/test";
import { ExeDevPlatform } from "@tryopenbot/platform-integrations";
import { DeploymentOutputs, type DeploymentContext } from "@tryopenbot/runtime-provider";
import type { AgentServiceProvider } from "../index.js";
import { ExeDevRuntimeServiceProvider, type ExeDevCommandRunner } from "./exe-dev.js";

function context(devMode = false): DeploymentContext {
  return {
    devMode,
    repositoryRoot: "/source/openbot",
    environment: {
      CODE_STORAGE_ORGANIZATION: "tilde",
      CODE_STORAGE_REPOSITORY: "trytilde/openbot",
      CODE_STORAGE_REPOSITORY_TOKEN: "repository-only-token",
      TILDE_API_KEY: "tilde-secret",
      TILDE_BEARER_TOKEN: "human-deployment-token",
    },
    inputs: new DeploymentOutputs(),
    report: vi.fn(),
  };
}

describe("ExeDevRuntimeServiceProvider", () => {
  it("implements both consolidated service provider contracts", () => {
    const provider = new ExeDevRuntimeServiceProvider();
    expectTypeOf(provider).toMatchTypeOf<AgentServiceProvider>();
    expectTypeOf(provider).toMatchTypeOf<ControlServiceProvider>();
  });

  it("does no recursive remote work inside the watched VM", async () => {
    const run = vi.fn();
    const runner = { run } as unknown as ExeDevCommandRunner;
    const provider = new ExeDevRuntimeServiceProvider({
      platform: new ExeDevPlatform({ vm: "openbot", cpu: 2, memory: "8GB" }),
      runner,
    });
    const development = context(true);

    await provider.buildable.check(development);
    await provider.buildable.build(development);
    await provider.deployable.deploy(development);

    expect(run).not.toHaveBeenCalled();
  });

  it("sizes, publishes, seeds, and supervises one exe.dev VM without putting secrets in argv", async () => {
    const calls: { command: string; args: readonly string[]; input?: string }[] = [];
    const runner: ExeDevCommandRunner = {
      async run(command, args, options) {
        calls.push({ command, args, input: options?.input });
        return "";
      },
    };
    const provider = new ExeDevRuntimeServiceProvider({
      platform: new ExeDevPlatform({
        vm: "openbot",
        cpu: 2,
        memory: "8GB",
        remoteDirectory: "/home/exedev/openbot",
      }),
      runner,
      request: vi.fn().mockResolvedValue(Response.json({ ok: true })),
      currentBranch: async () => "main",
    });
    const deployment = context();

    await provider.deployable.configure(deployment);
    await provider.deployable.deploy(deployment);

    expect(calls[0]).toMatchObject({
      command: "ssh",
      args: ["exe.dev", "resize", "openbot", "--cpu=2", "--memory=8GB"],
    });
    expect(calls[1]?.args).toEqual(["exe.dev", "share", "port", "openbot", "4173"]);
    expect(calls[2]?.args).toEqual(["exe.dev", "share", "set-public", "openbot"]);
    expect(calls.flatMap((call) => call.args).join(" ")).not.toContain("repository-only-token");
    expect(calls[3]?.input).toContain('CODE_STORAGE_REPOSITORY_TOKEN="repository-only-token"');
    expect(calls[3]?.input).not.toContain("human-deployment-token");
    expect(calls.at(-1)?.input).toContain('cd "$remote_directory"');
    expect(calls.at(-1)?.input).toContain('XDG_RUNTIME_DIR="/run/user/$(id -u)"');
    expect(calls.at(-1)?.input).toContain("node_version=24.20.0");
    expect(calls.at(-1)?.input).toContain('PATH="/usr/local/bin:${PATH}"');
    expect(calls.at(-1)?.input).toContain("sops_version=3.9.1");
    expect(calls.at(-1)?.input).toContain('fuser -k -TERM "${port}/tcp"');
    expect(calls.at(-1)?.input).toContain("status --porcelain --untracked-files=no");
    expect(calls.at(-1)?.input).toContain(
      '"refs/heads/$source_branch:refs/remotes/origin/$source_branch"',
    );
    expect(calls.at(-1)?.input).toContain('switch "$source_branch"');
    expect(calls.at(-1)?.input).toContain(
      'switch --create "$source_branch" --no-track "origin/$source_branch"',
    );
    expect(calls.at(-1)?.input).toContain("sha256sum --check --strict");
    expect(calls.at(-1)?.input).toContain("repository-only-token");
    expect(deployment.environment.PUBLIC_ORIGIN).toBe("https://openbot.exe.xyz");
  });
});
