import { describe, expect, it, vi } from "vite-plus/test";
import { DeploymentOutputs, type DeploymentContext } from "@tryopenbot/runtime-provider";
import {
  CodeStorageGitProvider,
  codeStorageGitHubDefaultBranchEnvironmentName,
  codeStorageGitHubOwnerEnvironmentName,
  codeStorageGitHubRepositoryEnvironmentName,
  codeStorageGitHubSyncModeEnvironmentName,
  codeStorageOrganizationEnvironmentName,
  codeStorageRepositoryEnvironmentName,
  codeStorageRepositoryTokenSecretName,
  codeStorageSetupPrivateKeyTransientName,
} from "./index.js";

function context(environment: NodeJS.ProcessEnv): DeploymentContext {
  return {
    devMode: false,
    repositoryRoot: "/repo",
    environment,
    inputs: new DeploymentOutputs(),
    report: vi.fn(),
  };
}

describe("CodeStorageGitProvider", () => {
  it("uses the setup-only organization key to create a synced repo and persist only its token", async () => {
    const getRemoteURL = vi
      .fn()
      .mockResolvedValue("https://t:repository-jwt@tilde.code.storage/trytilde/openbot.git");
    const createRepo = vi.fn().mockResolvedValue({ getRemoteURL });
    const setSecret = vi.fn();
    const provider = new CodeStorageGitProvider({
      clientFactory: () => ({ findOne: vi.fn().mockResolvedValue(null), createRepo }),
    });

    await provider.initialize({
      repositoryRoot: "/repo",
      environment: {
        [codeStorageOrganizationEnvironmentName]: "tilde",
        [codeStorageRepositoryEnvironmentName]: "trytilde/openbot",
        [codeStorageSetupPrivateKeyTransientName]: "organization-private-key",
        [codeStorageGitHubSyncModeEnvironmentName]: "github-app",
        [codeStorageGitHubOwnerEnvironmentName]: "trytilde",
        [codeStorageGitHubRepositoryEnvironmentName]: "openbot",
        [codeStorageGitHubDefaultBranchEnvironmentName]: "main",
      },
      setEnvironment: vi.fn(),
      setSecret,
      report: vi.fn(),
    });

    expect(createRepo).toHaveBeenCalledWith({
      id: "trytilde/openbot",
      defaultBranch: "main",
      baseRepo: { owner: "trytilde", name: "openbot", defaultBranch: "main" },
    });
    expect(getRemoteURL).toHaveBeenCalledWith({
      permissions: ["git:read", "git:write"],
      ttl: 3_153_600_000,
      refPolicies: [{ pattern: "refs/heads/*", ops: ["no-force-push"] }],
    });
    expect(setSecret).toHaveBeenCalledWith(
      codeStorageRepositoryTokenSecretName,
      "repository-jwt",
      expect.stringContaining("Repository-scoped"),
    );
    expect(setSecret).not.toHaveBeenCalledWith(
      codeStorageSetupPrivateKeyTransientName,
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not require the organization key after a repository token exists", async () => {
    const clientFactory = vi.fn();
    const provider = new CodeStorageGitProvider({ clientFactory });

    await provider.initialize({
      repositoryRoot: "/repo",
      environment: {
        [codeStorageOrganizationEnvironmentName]: "tilde",
        [codeStorageRepositoryEnvironmentName]: "openbot",
        [codeStorageRepositoryTokenSecretName]: "repository-jwt",
      },
      setEnvironment: vi.fn(),
      setSecret: vi.fn(),
    });

    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("configures and pushes origin using only the repository token", async () => {
    const calls: string[][] = [];
    const provider = new CodeStorageGitProvider({
      runGit: async (_cwd, args) => {
        calls.push([...args]);
        if (args.join(" ") === "remote get-url origin")
          return "https://github.com/acme/openbot.git\n";
        if (args.join(" ") === "remote get-url upstream") return "";
        if (args.join(" ") === "branch --show-current") return "main\n";
        return "";
      },
    });
    const deployment = context({
      [codeStorageOrganizationEnvironmentName]: "tilde",
      [codeStorageRepositoryEnvironmentName]: "trytilde/openbot",
      [codeStorageRepositoryTokenSecretName]: "repository-jwt",
    });

    await provider.deployable.deploy(deployment);

    expect(calls).toContainEqual([
      "remote",
      "set-url",
      "origin",
      "https://t:repository-jwt@tilde.code.storage/trytilde/openbot.git",
    ]);
    expect(calls).toContainEqual(["push", "--set-upstream", "origin", "main"]);
  });

  it("derives a repository path from the existing GitHub origin", async () => {
    const setEnvironment = vi.fn();
    const provider = new CodeStorageGitProvider({
      runGit: async () => "git@github.com:trytilde/openbot.git\n",
    });

    await provider.initialize({
      repositoryRoot: "/repo",
      environment: { [codeStorageRepositoryTokenSecretName]: "repository-jwt" },
      setEnvironment,
      setSecret: vi.fn(),
    });
    expect(setEnvironment).toHaveBeenCalledWith(
      codeStorageRepositoryEnvironmentName,
      "trytilde/openbot",
      expect.any(String),
    );
  });

  it("never includes the repository credential in provider failures", async () => {
    const provider = new CodeStorageGitProvider({
      runGit: async (_cwd, args) => {
        if (args.join(" ") === "remote get-url origin") return "";
        throw new Error("failed https://t:repository-jwt@tilde.code.storage/openbot.git");
      },
    });

    await expect(
      provider.deployable.deploy(
        context({
          [codeStorageOrganizationEnvironmentName]: "tilde",
          [codeStorageRepositoryEnvironmentName]: "openbot",
          [codeStorageRepositoryTokenSecretName]: "repository-jwt",
        }),
      ),
    ).rejects.not.toThrow(/repository-jwt/);
  });
});
