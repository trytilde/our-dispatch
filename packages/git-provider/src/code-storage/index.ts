import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitStorage, type CreateRepoOptions, type Repo } from "@pierre/storage";
import {
  persistEnvironment,
  type DeploymentContext,
  type DeploymentPlan,
  type ProviderInitialization,
  type ProviderInitializationContext,
} from "@tryopenbot/runtime-provider";
import type { GitProvider } from "../core.js";
import { GitProviderError } from "../core.js";

const execFileAsync = promisify(execFile);

export const codeStorageOrganizationEnvironmentName = "CODE_STORAGE_ORGANIZATION";
export const codeStorageRepositoryEnvironmentName = "CODE_STORAGE_REPOSITORY";
export const codeStorageRepositoryTokenSecretName = "CODE_STORAGE_REPOSITORY_TOKEN";
export const codeStorageSetupPrivateKeyTransientName = "CODE_STORAGE_SETUP_PRIVATE_KEY";
export const codeStorageGitHubSyncModeEnvironmentName = "CODE_STORAGE_GITHUB_SYNC_MODE";
export const codeStorageGitHubOwnerEnvironmentName = "CODE_STORAGE_GITHUB_OWNER";
export const codeStorageGitHubRepositoryEnvironmentName = "CODE_STORAGE_GITHUB_REPOSITORY";
export const codeStorageGitHubDefaultBranchEnvironmentName = "CODE_STORAGE_GITHUB_DEFAULT_BRANCH";

export const codeStorageGitProviderInitialization: ProviderInitialization = {
  id: "code-storage-git",
  label: "Code Storage",
  description: "Store this OpenBot fork in Code Storage using scoped Git-over-HTTPS JWTs.",
  questions: [
    {
      id: "code-storage-organization",
      prompt: "Code Storage organization",
      description:
        "Organization identifier shown beside the API key in the Code Storage dashboard.",
      input: "text",
      required: true,
      destination: { kind: "environment", key: codeStorageOrganizationEnvironmentName },
    },
    {
      id: "code-storage-repository",
      prompt: "Code Storage repository ID",
      description: "Stable repository path, such as team/openbot. It is created when missing.",
      defaultValue: "openbot",
      input: "text",
      required: true,
      destination: { kind: "environment", key: codeStorageRepositoryEnvironmentName },
    },
    {
      id: "code-storage-github-sync-mode",
      prompt: "GitHub synchronization",
      description:
        "Choose continuous GitHub App sync, a one-time public import, or an independent Code Storage repository.",
      input: "select",
      required: true,
      defaultValue: "github-app",
      choices: [
        {
          value: "github-app",
          label: "GitHub App (continuous)",
          description:
            "Continuously mirror pushes through the Code Storage GitHub App integration.",
        },
        {
          value: "public",
          label: "Public import",
          description: "Import a public GitHub repository once without credentials.",
        },
        {
          value: "none",
          label: "No GitHub sync",
          description: "Create an independent Code Storage repository.",
        },
      ],
      destination: { kind: "environment", key: codeStorageGitHubSyncModeEnvironmentName },
    },
    {
      id: "code-storage-github-owner",
      prompt: "GitHub repository owner (blank when sync is disabled)",
      input: "text",
      destination: { kind: "environment", key: codeStorageGitHubOwnerEnvironmentName },
    },
    {
      id: "code-storage-github-repository",
      prompt: "GitHub repository name (blank when sync is disabled)",
      input: "text",
      destination: { kind: "environment", key: codeStorageGitHubRepositoryEnvironmentName },
    },
    {
      id: "code-storage-github-default-branch",
      prompt: "GitHub default branch",
      defaultValue: "main",
      input: "text",
      destination: { kind: "environment", key: codeStorageGitHubDefaultBranchEnvironmentName },
    },
    {
      id: "code-storage-setup-private-key",
      prompt: "Code Storage organization API private key (setup only)",
      description:
        "PKCS8 PEM key used only now to create/reconcile the repository and mint its scoped credential. Leave blank on later setup runs while the repository credential is still valid.",
      input: "secret",
      destination: { kind: "transient", key: codeStorageSetupPrivateKeyTransientName },
    },
  ],
};

interface CodeStorageClient {
  findOne(options: { id: string }): Promise<Repo | null>;
  createRepo(options: CreateRepoOptions): Promise<Repo>;
}

export interface CodeStorageGitProviderOptions {
  /** Repository-only credential lifetime. Setup rotates it before expiry. */
  repositoryTokenTtlSeconds?: number;
  clientFactory?: (options: { name: string; key: string }) => CodeStorageClient;
  runGit?: (cwd: string, args: readonly string[]) => Promise<string>;
}

/**
 * Reconciles a Code Storage repository and configures standard Git-over-HTTPS access. The scoped
 * JWT lives only in the checkout's untracked .git/config and is rotated on every lifecycle run.
 */
export class CodeStorageGitProvider implements GitProvider {
  readonly initialization = codeStorageGitProviderInitialization;
  readonly environmentNames = { repository: codeStorageRepositoryEnvironmentName };
  readonly deployable = {
    plan: (context: DeploymentContext) => this.#plan(context),
    deploy: (context: DeploymentContext) => this.#deploy(context),
  };
  readonly #repositoryTokenTtlSeconds: number;
  readonly #clientFactory: NonNullable<CodeStorageGitProviderOptions["clientFactory"]>;
  readonly #runGit: NonNullable<CodeStorageGitProviderOptions["runGit"]>;

  constructor(options: CodeStorageGitProviderOptions = {}) {
    this.#repositoryTokenTtlSeconds = options.repositoryTokenTtlSeconds ?? 100 * 365 * 24 * 60 * 60;
    this.#clientFactory =
      options.clientFactory ?? ((clientOptions) => new GitStorage(clientOptions));
    this.#runGit =
      options.runGit ??
      (async (cwd, args) => {
        const result = await execFileAsync("git", [...args], { cwd });
        return result.stdout;
      });
  }

  async initialize(context: ProviderInitializationContext): Promise<void> {
    let repository = context.environment[codeStorageRepositoryEnvironmentName]?.trim();
    if (!repository) {
      repository = await this.#repositoryFromOrigin(context.repositoryRoot);
      if (repository)
        await context.setEnvironment(
          codeStorageRepositoryEnvironmentName,
          repository,
          "Code Storage repository ID holding this OpenBot fork.",
        );
    }
    const existingToken = context.environment[codeStorageRepositoryTokenSecretName]?.trim();
    const setupKey = context.environment[codeStorageSetupPrivateKeyTransientName]?.trim();
    if (existingToken && !setupKey) return;
    if (!setupKey)
      throw new GitProviderError(
        "invalid_configuration",
        "A Code Storage organization API private key is required for first-time setup or credential rotation",
      );
    const configured = repositoryConfiguration({
      ...context.environment,
      [codeStorageRepositoryEnvironmentName]: repository,
    });
    try {
      const client = this.#clientFactory({ name: configured.organization, key: setupKey });
      let repo = await client.findOne({ id: configured.repository });
      const created = !repo;
      if (!repo)
        repo = await client.createRepo(
          createRepositoryOptions(context.environment, configured.repository),
        );
      const authenticatedUrl = await repo.getRemoteURL({
        permissions: ["git:read", "git:write"],
        ttl: this.#repositoryTokenTtlSeconds,
        refPolicies: [{ pattern: "refs/heads/*", ops: ["no-force-push"] }],
      });
      const token = new URL(authenticatedUrl).password;
      if (!token) throw new Error("Code Storage returned a Git URL without a credential");
      await context.setSecret(
        codeStorageRepositoryTokenSecretName,
        decodeURIComponent(token),
        "Repository-scoped Code Storage Git credential for this OpenBot fork.",
      );
      context.report?.({
        event: "git.code-storage.initialized",
        details: {
          created,
          organization: configured.organization,
          repository: configured.repository,
          syncMode: syncMode(context.environment),
        },
      });
    } catch (error) {
      if (error instanceof GitProviderError) throw error;
      throw new GitProviderError(
        "provider_unavailable",
        `Unable to initialize Code Storage: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  }

  async #plan(context: DeploymentContext): Promise<DeploymentPlan> {
    const { organization, repository } = configuration(context.environment);
    return {
      summary: `Reconcile ${organization}.code.storage/${repository}`,
      steps: [
        "Use the persisted repository-only read/write credential",
        "Rotate the untracked origin credential and push the current branch",
      ],
    };
  }

  async #deploy(context: DeploymentContext): Promise<void> {
    const { organization, repository, repositoryToken } = configuration(context.environment);
    let authenticatedUrl: string | undefined;
    try {
      authenticatedUrl = authenticatedGitUrl(organization, repository, repositoryToken);
      const cleanUrl = `https://${organization}.code.storage/${repository}.git`;
      await this.#configureOrigin(context.repositoryRoot, cleanUrl, authenticatedUrl);
      const branch = (
        await this.#runGit(context.repositoryRoot, ["branch", "--show-current"])
      ).trim();
      if (!branch)
        throw new GitProviderError(
          "invalid_configuration",
          "Code Storage deployment requires a named current branch",
        );
      await this.#runGit(context.repositoryRoot, ["push", "--set-upstream", "origin", branch]);
      await persistEnvironment(
        context,
        codeStorageRepositoryEnvironmentName,
        repository,
        "Code Storage repository ID holding this OpenBot fork.",
      );
      context.report({
        event: "git.code-storage.reconciled",
        details: { branch, organization, repository },
      });
    } catch (error) {
      if (error instanceof GitProviderError) throw error;
      throw new GitProviderError(
        "provider_unavailable",
        `Unable to reconcile Code Storage: ${redactedError(error, authenticatedUrl)}`,
        true,
      );
    }
  }

  async #configureOrigin(
    repositoryRoot: string,
    cleanUrl: string,
    authenticatedUrl: string,
  ): Promise<void> {
    const current = await this.#optionalGit(repositoryRoot, ["remote", "get-url", "origin"]);
    if (current && stripCredentials(current) !== cleanUrl) {
      const upstream = await this.#optionalGit(repositoryRoot, ["remote", "get-url", "upstream"]);
      if (!upstream) await this.#runGit(repositoryRoot, ["remote", "add", "upstream", current]);
    }
    if (current)
      await this.#runGit(repositoryRoot, ["remote", "set-url", "origin", authenticatedUrl]);
    else await this.#runGit(repositoryRoot, ["remote", "add", "origin", authenticatedUrl]);
  }

  async #repositoryFromOrigin(repositoryRoot: string): Promise<string | undefined> {
    const origin = await this.#optionalGit(repositoryRoot, ["remote", "get-url", "origin"]);
    if (!origin) return undefined;
    try {
      const url = new URL(origin);
      if (url.hostname.endsWith(".code.storage"))
        return url.pathname.replace(/^\//, "").replace(/\.git$/, "");
      if (url.hostname === "github.com")
        return url.pathname.replace(/^\//, "").replace(/\.git$/, "");
    } catch {
      const match = /^git@github\.com:(.+?)(?:\.git)?$/.exec(origin);
      if (match) return match[1];
    }
    return undefined;
  }

  async #optionalGit(cwd: string, args: readonly string[]): Promise<string> {
    try {
      return (await this.#runGit(cwd, args)).trim();
    } catch {
      return "";
    }
  }
}

function configuration(environment: NodeJS.ProcessEnv): {
  organization: string;
  repository: string;
  repositoryToken: string;
} {
  const { organization, repository } = repositoryConfiguration(environment);
  const repositoryToken = environment[codeStorageRepositoryTokenSecretName]?.trim();
  if (!repositoryToken)
    throw new GitProviderError(
      "invalid_configuration",
      `${codeStorageRepositoryTokenSecretName} is required; rerun openbot init with the setup-only organization key`,
    );
  return { organization, repository, repositoryToken };
}

function repositoryConfiguration(environment: NodeJS.ProcessEnv): {
  organization: string;
  repository: string;
} {
  const organization = environment[codeStorageOrganizationEnvironmentName]?.trim();
  const repository = environment[codeStorageRepositoryEnvironmentName]?.trim();
  if (!organization || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(organization))
    throw new GitProviderError(
      "invalid_configuration",
      `${codeStorageOrganizationEnvironmentName} must be a valid Code Storage organization`,
    );
  if (!repository || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(repository))
    throw new GitProviderError(
      "invalid_configuration",
      `${codeStorageRepositoryEnvironmentName} must be a valid repository path`,
    );
  return { organization, repository };
}

function createRepositoryOptions(
  environment: NodeJS.ProcessEnv,
  repository: string,
): CreateRepoOptions {
  const mode = syncMode(environment);
  const defaultBranch =
    environment[codeStorageGitHubDefaultBranchEnvironmentName]?.trim() || "main";
  if (mode === "none") return { id: repository, defaultBranch };
  const owner = environment[codeStorageGitHubOwnerEnvironmentName]?.trim();
  const name = environment[codeStorageGitHubRepositoryEnvironmentName]?.trim();
  if (!owner || !name)
    throw new GitProviderError(
      "invalid_configuration",
      `${codeStorageGitHubOwnerEnvironmentName} and ${codeStorageGitHubRepositoryEnvironmentName} are required when GitHub sync is enabled`,
    );
  return {
    id: repository,
    defaultBranch,
    baseRepo: {
      owner,
      name,
      defaultBranch,
      ...(mode === "public" ? { auth: { authType: "public" as const } } : {}),
    },
  };
}

function syncMode(environment: NodeJS.ProcessEnv): "github-app" | "public" | "none" {
  const mode = environment[codeStorageGitHubSyncModeEnvironmentName]?.trim() || "none";
  if (mode === "github-app" || mode === "public" || mode === "none") return mode;
  throw new GitProviderError(
    "invalid_configuration",
    `${codeStorageGitHubSyncModeEnvironmentName} must be github-app, public, or none`,
  );
}

function authenticatedGitUrl(organization: string, repository: string, token: string): string {
  const url = new URL(`https://${organization}.code.storage/${repository}.git`);
  url.username = "t";
  url.password = token;
  return url.toString();
}

function stripCredentials(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value;
  }
}

function redactedError(error: unknown, authenticatedUrl: string | undefined): string {
  let message = error instanceof Error ? error.message : String(error);
  if (!authenticatedUrl) return message;
  const url = new URL(authenticatedUrl);
  const password = url.password;
  message = message.replaceAll(authenticatedUrl, "[REDACTED_CODE_STORAGE_URL]");
  if (password) message = message.replaceAll(password, "[REDACTED_CODE_STORAGE_TOKEN]");
  return message;
}
