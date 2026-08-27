import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DeploymentOutputs, type DeploymentContext } from "@tryopenbot/runtime-provider";
import { describe, expect, it } from "vite-plus/test";
import { LocalGitProvider } from "./index.js";

const execFileAsync = promisify(execFile);

describe("LocalGitProvider", () => {
  it("creates an idempotent bare origin and pushes the current branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-local-git-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "OpenBot Test"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "openbot@example.test"], { cwd: root });
    await writeFile(join(root, "README.md"), "OpenBot\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
    const environment: NodeJS.ProcessEnv = {};
    const persisted: Record<string, string> = {};
    const context: DeploymentContext = {
      devMode: false,
      repositoryRoot: root,
      environment,
      inputs: new DeploymentOutputs(),
      persistence: {
        async setEnvironment(name, value) {
          persisted[name] = value;
        },
        async setSecret() {},
        async unsetEnvironment() {},
        async unsetSecret() {},
      },
      report: () => undefined,
    };
    const provider = new LocalGitProvider();
    await provider.deployable.deploy(context);
    await provider.deployable.deploy(context);
    expect(persisted.GIT_LOCAL_REPOSITORY).toMatch(/^file:\/\//);
    expect((await readFile(join(root, ".openbot/git/openbot.git/HEAD"), "utf8")).trim()).toBe(
      "ref: refs/heads/master",
    );
    const remoteHead = (
      await execFileAsync("git", [
        "--git-dir",
        join(root, ".openbot/git/openbot.git"),
        "rev-parse",
        "refs/heads/main",
      ])
    ).stdout.trim();
    const localHead = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })
    ).stdout.trim();
    expect(remoteHead).toBe(localHead);
  });
});
