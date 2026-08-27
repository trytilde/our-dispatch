import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  persistEnvironment,
  type DeploymentContext,
  type DeploymentPlan,
  type ProviderInitialization,
} from "@tryopenbot/runtime-provider";
import type { GitProvider } from "../core.js";
import { GitProviderError } from "../core.js";

const execFileAsync = promisify(execFile);

export const localGitRepositoryEnvironmentName = "GIT_LOCAL_REPOSITORY";
export const defaultLocalGitRepository = ".openbot/git/openbot.git";

export const localGitProviderInitialization: ProviderInitialization = {
  id: "local-git",
  label: "Sandbox-local Git",
  description:
    "Keep the installation repository entirely on this Computer's persistent filesystem.",
  questions: [
    {
      id: "openbot-hosted-instance-id",
      prompt: "Tilde hosted OpenBot instance ID",
      description: "Instance capability boundary used for managed releases.",
      input: "text",
      required: true,
      destination: { kind: "environment", key: "OPENBOT_HOSTED_INSTANCE_ID" },
    },
    {
      id: "openbot-hosted-computer-id",
      prompt: "Tilde hosted OpenBot computer ID",
      input: "text",
      required: true,
      destination: { kind: "environment", key: "COMPUTER_ID" },
    },
    {
      id: "openbot-hosted-computer-service-url",
      prompt: "Tilde hosted OpenBot computer service URL",
      input: "text",
      required: true,
      destination: { kind: "environment", key: "COMPUTER_SERVICE_URL" },
    },
  ],
};

/**
 * Owns an installation-local bare Git repository. This is intended for managed Computers where
 * the persistent filesystem is the source-control boundary and no external forge is required.
 */
export class LocalGitProvider implements GitProvider {
  readonly initialization = localGitProviderInitialization;
  readonly environmentNames = { repository: localGitRepositoryEnvironmentName };
  readonly deployable = {
    plan: (context: DeploymentContext) => this.#plan(context),
    deploy: (context: DeploymentContext) => this.#deploy(context),
  };

  constructor(private readonly repositoryPath = defaultLocalGitRepository) {}

  async #plan(context: DeploymentContext): Promise<DeploymentPlan> {
    return {
      summary: "Reconcile the sandbox-local Git repository",
      steps: [
        `Create ${this.#absoluteRepositoryPath(context)} as a bare repository when missing`,
        "Point origin at the local repository and push the current branch",
      ],
    };
  }

  async #deploy(context: DeploymentContext): Promise<void> {
    const repository = this.#absoluteRepositoryPath(context);
    try {
      await mkdir(dirname(repository), { recursive: true, mode: 0o700 });
      await this.#git(context.repositoryRoot, ["init", "--bare", repository]);
      const origin = `file://${repository}`;
      const currentOrigin = await this.#optionalGit(context.repositoryRoot, [
        "remote",
        "get-url",
        "origin",
      ]);
      if (currentOrigin.trim() !== origin) {
        const upstream = await this.#optionalGit(context.repositoryRoot, [
          "remote",
          "get-url",
          "upstream",
        ]);
        if (currentOrigin.trim() && !upstream.trim())
          await this.#git(context.repositoryRoot, [
            "remote",
            "add",
            "upstream",
            currentOrigin.trim(),
          ]);
        if (currentOrigin.trim())
          await this.#git(context.repositoryRoot, ["remote", "set-url", "origin", origin]);
        else await this.#git(context.repositoryRoot, ["remote", "add", "origin", origin]);
      }
      const branch = (await this.#git(context.repositoryRoot, ["branch", "--show-current"])).trim();
      if (!branch)
        throw new GitProviderError(
          "invalid_configuration",
          "Sandbox-local Git requires a named current branch",
        );
      await this.#git(context.repositoryRoot, ["push", "--set-upstream", "origin", branch]);
      await persistEnvironment(
        context,
        localGitRepositoryEnvironmentName,
        origin,
        "Sandbox-local bare Git repository URL.",
      );
      context.report({ event: "git.local.reconciled", details: { branch, repository } });
    } catch (error) {
      if (error instanceof GitProviderError) throw error;
      throw new GitProviderError(
        "internal",
        `Could not reconcile sandbox-local Git: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  #absoluteRepositoryPath(context: DeploymentContext): string {
    return resolve(context.repositoryRoot, this.repositoryPath);
  }

  async #git(cwd: string, args: readonly string[]): Promise<string> {
    const result = await execFileAsync("git", [...args], { cwd });
    return result.stdout;
  }

  async #optionalGit(cwd: string, args: readonly string[]): Promise<string> {
    try {
      return await this.#git(cwd, args);
    } catch {
      return "";
    }
  }
}
