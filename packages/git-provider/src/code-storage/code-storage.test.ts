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
      .mockResolvedValue("https://t:repository-jwt@tilde.code.storage/trytilde/dispatch.git");
    const createRepo = vi.fn().mockResolvedValue({ getRemoteURL });
    const setSecret = vi.fn();
    const provider = new CodeStorageGitProvider({
      clientFactory: () => ({ findOne: vi.fn().mockResolvedValue(null), createRepo }),
    });

    await provider.initialize({
      repositoryRoot: "/repo",
      environment: {
        [codeStorageOrganizationEnvironmentName]: "tilde",
        [codeStorageRepositoryEnvironmentName]: "trytilde/dispatch",
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
      id: "trytilde/dispatch",
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

  it("keeps origin clean and supplies the repository token only to the push", async () => {
    const calls: { args: string[]; environment?: NodeJS.ProcessEnv }[] = [];
    const provider = new CodeStorageGitProvider({
      runGit: async (_cwd, args, environment) => {
        calls.push({ args: [...args], environment });
        if (args.join(" ") === "remote get-url origin")
          return "https://github.com/acme/openbot.git\n";
        if (args.join(" ") === "remote get-url upstream") return "";
        if (args.join(" ") === "branch --show-current") return "main\n";
        return "";
      },
    });
    const deployment = context({
      [codeStorageOrganizationEnvironmentName]: "tilde",
      [codeStorageRepositoryEnvironmentName]: "trytilde/dispatch",
      [codeStorageRepositoryTokenSecretName]: "repository-jwt",
    });

    await provider.deployable.deploy(deployment);

    expect(calls.map(({ args }) => args)).toContainEqual([
      "remote",
      "set-url",
      "origin",
      "https://tilde.code.storage/trytilde/dispatch.git",
    ]);
    const push = calls.find(({ args }) => args.includes("push"));
    expect(push?.args).toContain("credential.helper=");
    expect(push?.args.join(" ")).toContain("$CODE_STORAGE_REPOSITORY_TOKEN");
    expect(push?.args.join(" ")).not.toContain("repository-jwt");
    expect(push?.environment).toEqual({ CODE_STORAGE_REPOSITORY_TOKEN: "repository-jwt" });
    expect(calls.map(({ args }) => args)).toContainEqual([
      "config",
      "--local",
      "--add",
      "credential.https://tilde.code.storage.helper",
      expect.stringContaining("$CODE_STORAGE_REPOSITORY_TOKEN"),
    ]);
    expect(calls.flatMap(({ args }) => args).join(" ")).not.toContain("repository-jwt");
  });

  it("derives a repository path from the existing GitHub origin", async () => {
    const setEnvironment = vi.fn();
    const provider = new CodeStorageGitProvider({
      runGit: async () => "git@github.com:trytilde/dispatch.git\n",
    });

    await provider.initialize({
      repositoryRoot: "/repo",
      environment: { [codeStorageRepositoryTokenSecretName]: "repository-jwt" },
      setEnvironment,
      setSecret: vi.fn(),
    });
    expect(setEnvironment).toHaveBeenCalledWith(
      codeStorageRepositoryEnvironmentName,
      "trytilde/dispatch",
      expect.any(String),
    );
  });

  it("removes a legacy credential from the Code Storage origin", async () => {
    const calls: string[][] = [];
    const provider = new CodeStorageGitProvider({
      runGit: async (_cwd, args) => {
        calls.push([...args]);
        if (args.join(" ") === "remote get-url origin")
          return "https://t:legacy-jwt@tilde.code.storage/our-dispatch.git\n";
        if (args.join(" ") === "branch --show-current") return "main\n";
        return "";
      },
    });

    await provider.deployable.deploy(
      context({
        [codeStorageOrganizationEnvironmentName]: "tilde",
        [codeStorageRepositoryEnvironmentName]: "our-dispatch",
        [codeStorageRepositoryTokenSecretName]: "current-jwt",
      }),
    );

    expect(calls).toContainEqual([
      "remote",
      "set-url",
      "origin",
      "https://tilde.code.storage/our-dispatch.git",
    ]);
    expect(calls.some((args) => args.includes("upstream"))).toBe(false);
    expect(calls.flat().join(" ")).not.toMatch(/legacy-jwt|current-jwt/);
  });

  it("never includes the repository credential in provider failures", async () => {
    const provider = new CodeStorageGitProvider({
      runGit: async (_cwd, args) => {
        if (args.join(" ") === "remote get-url origin") return "";
        throw new Error("failed with repository-jwt");
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
