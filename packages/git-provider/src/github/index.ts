import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { TildePlatform } from "@tryopenbot/platform-integrations";
import { tildeErrorMessage } from "@tryopenbot/platform-integrations/tilde/errors";
import type {
  DeploymentContext,
  DeploymentPlan,
  DeploymentReporter,
  ProviderInitialization,
  ProviderInitializationContext,
} from "@tryopenbot/runtime-provider";
import { persistEnvironment } from "@tryopenbot/runtime-provider";
import {
  autoProvisionToolGroupInstance,
  createTildeApiClient,
  listToolGroupInstances,
  reverseProxyCreateProfile,
  reverseProxyListProfiles,
  reverseProxyUpdateProfile,
  startProviderAppProvisioning,
  type ProviderProvisioningNextAction,
  type ReverseProxyProfile,
  type ToolGroupInstanceSerialized,
} from "@trytilde/api-client";
import type { GitProvider } from "../core.js";
import { GitProviderError } from "../core.js";

export const githubRepositoryEnvironmentName = "GIT_GITHUB_REPOSITORY";
export const githubAppNameEnvironmentName = "GIT_GITHUB_APP_NAME";
export const githubAppOrganizationEnvironmentName = "GIT_GITHUB_APP_ORGANIZATION";
export const githubCredentialEnvironmentName = "GIT_GITHUB_CREDENTIAL_ID";
export const githubToolGroupEnvironmentName = "GIT_GITHUB_TOOL_GROUP_ID";
export const githubRestProxyEnvironmentName = "GIT_GITHUB_REST_PROXY_PROFILE_ID";
export const githubGitProxyEnvironmentName = "GIT_GITHUB_GIT_PROXY_PROFILE_ID";

export const githubToolGroupSourceTypeId = "github";
const githubCredentialSourceTypeId = "server_token_exchange";
const githubProviderProvisionerId = "provider_provisioner.github";
const restProxyProfileId = "openbot-github-rest";
const gitProxyProfileId = "openbot-github-git";
const restProxyProviderId = "github";
const gitProxyProviderId = "github_git_https";

export const gitHubGitProviderInitialization: ProviderInitialization = {
  id: "github-git",
  label: "GitHub",
  description: "Connect the GitHub repository that holds this OpenBot fork.",
  questions: [
    {
      id: "github-app-name",
      prompt: "GitHub App name",
      description:
        "Name of the GitHub App created for this installation. GitHub App names are globally unique, so include something identifying; GitHub lets you adjust it on the creation page.",
      defaultValue: "OpenBot",
      input: "text",
      required: true,
      destination: { kind: "environment", key: githubAppNameEnvironmentName },
    },
    {
      id: "github-app-organization",
      prompt: "GitHub organization for the App (blank for your personal account)",
      description:
        "GitHub organization that will own and install the App. Leave blank to create it on the authorizing user's account.",
      input: "text",
      destination: { kind: "environment", key: githubAppOrganizationEnvironmentName },
    },
  ],
};

/**
 * Reconciles GitHub access through Tilde: a brokered GitHub App credential (no raw token enters
 * the repository or a sandbox) plus reverse-proxy profiles for the REST API and git-over-HTTPS.
 */
export class GitHubGitProvider implements GitProvider {
  readonly platform: TildePlatform;
  readonly platforms: readonly TildePlatform[];
  readonly initialization = gitHubGitProviderInitialization;
  readonly environmentNames = {
    repository: githubRepositoryEnvironmentName,
    restProxyProfileId: githubRestProxyEnvironmentName,
    gitProxyProfileId: githubGitProxyEnvironmentName,
  };
  readonly deployable = {
    plan: (context: DeploymentContext) => this.#plan(context),
    deploy: (context: DeploymentContext) => this.#deploy(context),
  };
  readonly #pollIntervalMs: number;
  readonly #authorizationTimeoutMs: number;

  constructor(
    platform: TildePlatform,
    options: { pollIntervalMs?: number; authorizationTimeoutMs?: number } = {},
  ) {
    this.platform = platform;
    this.platforms = [platform];
    this.#pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.#authorizationTimeoutMs = options.authorizationTimeoutMs ?? 600_000;
  }

  /**
   * Derive the fork repository from the checkout's origin remote instead of asking again, then
   * start GitHub App provisioning so the owner can authorize while still at the terminal.
   * Deployment remains the idempotent finisher for skipped or incomplete authorizations.
   */
  async initialize(context: ProviderInitializationContext): Promise<void> {
    if (!context.environment[githubRepositoryEnvironmentName]?.trim()) {
      const repository = await originGitHubRepository(context.repositoryRoot);
      if (repository)
        await context.setEnvironment(
          githubRepositoryEnvironmentName,
          repository,
          "GitHub repository (owner/name) holding this OpenBot fork.",
        );
    }
    const report = context.report ?? (() => undefined);
    const connection = tildeConnectionFromEnvironment(context.environment);
    if (!connection) return;
    try {
      const api = createTildeApiClient({
        ...connection,
        throwOnError: true,
        ...(context.request ? { fetch: context.request } : {}),
      });
      const request: GitHubProvisioningRequest = {
        api,
        teamId: connection.teamId,
        environment: context.environment,
        report,
        interactive: context.interactive === true,
        actions: [],
      };
      let group = await ensureGitHubAppProvisioning(request);
      if (group)
        await context.setEnvironment(
          githubToolGroupEnvironmentName,
          group.id,
          "Tilde GitHub tool group instance ID.",
        );
      const action = request.actions.at(-1);
      if (group && !group.resource_server_credential_id && request.interactive && action) {
        group = await this.#interactiveAuthorization(request, action);
        if (group?.resource_server_credential_id)
          report({ event: "git.github.authorized", details: { toolGroupId: group.id } });
        else
          report({
            event: "git.github.pending",
            details: { reason: "GitHub authorization has not completed yet" },
          });
      }
    } catch (error) {
      // GitHub provisioning is finished by the deployment lifecycle; never fail init on it.
      report({
        event: "git.github.initialize.skipped",
        details: { reason: tildeErrorMessage(error, "unknown error") },
      });
    }
  }

  /** Serve the authorization action locally and poll until the credential connects. */
  async #interactiveAuthorization(
    request: GitHubProvisioningRequest,
    action: ProviderProvisioningNextAction,
  ): Promise<ToolGroupInstanceSerialized | undefined> {
    let close: (() => void) | undefined;
    let url: string | undefined;
    if (action.type === "redirect") {
      url = action.url;
    } else if (action.type === "render_form_post") {
      const page = authorizationFormPage(
        organizationActionUrl(action.action_url, request.environment),
        action.fields,
      );
      const served = await serveAuthorizationPage(page);
      close = served.close;
      url = served.url;
    }
    if (!url) return undefined;
    request.report({ event: "git.github.authorization.required", details: { url } });
    request.report({
      event: "git.github.authorization.waiting",
      details: { timeoutMs: this.#authorizationTimeoutMs },
    });
    try {
      const deadline = Date.now() + this.#authorizationTimeoutMs;
      while (Date.now() < deadline) {
        await delay(this.#pollIntervalMs);
        const group = await findGitHubToolGroup(request.api, request.teamId);
        if (group?.resource_server_credential_id) return group;
      }
      return undefined;
    } finally {
      close?.();
    }
  }

  async #plan(_context: DeploymentContext): Promise<DeploymentPlan> {
    return {
      summary: "Reconcile brokered GitHub access through Tilde",
      steps: [
        "Provision the Tilde GitHub tool group and its GitHub App credential when missing",
        "Surface the pending GitHub authorization action to the owner",
        "Reconcile the GitHub REST reverse-proxy profile",
        "Reconcile the GitHub git-over-HTTPS reverse-proxy profile",
      ],
    };
  }

  async #deploy(context: DeploymentContext): Promise<void> {
    const api = this.#api();
    const teamId = this.platform.connection().teamId;
    try {
      let group = await ensureGitHubAppProvisioning({
        api,
        teamId,
        environment: context.environment,
        report: context.report,
        interactive: false,
        actions: [],
      });
      if (!group) {
        context.report({
          event: "git.github.pending",
          details: { reason: "The Tilde GitHub tool group has not been created yet" },
        });
        return;
      }
      await persistEnvironment(
        context,
        githubToolGroupEnvironmentName,
        group.id,
        "Tilde GitHub tool group instance ID.",
      );
      if (!group.resource_server_credential_id) group = await findGitHubToolGroup(api, teamId);
      const credentialId = group?.resource_server_credential_id;
      if (!credentialId) {
        context.report({
          event: "git.github.pending",
          details: { reason: "GitHub authorization has not completed yet" },
        });
        return;
      }
      await persistEnvironment(
        context,
        githubCredentialEnvironmentName,
        credentialId,
        "Tilde resource server credential ID for GitHub.",
      );
      const profiles = await listProfiles(api, teamId);
      const rest = await this.#reconcileProfile(api, teamId, profiles, {
        id: restProxyProfileId,
        providerId: restProxyProviderId,
        credentialId,
      });
      const git = await this.#reconcileProfile(api, teamId, profiles, {
        id: gitProxyProfileId,
        providerId: gitProxyProviderId,
        credentialId,
      });
      await persistEnvironment(
        context,
        githubRestProxyEnvironmentName,
        rest.id,
        "Tilde reverse-proxy profile ID for the GitHub REST API.",
      );
      await persistEnvironment(
        context,
        githubGitProxyEnvironmentName,
        git.id,
        "Tilde reverse-proxy profile ID for GitHub git-over-HTTPS.",
      );
    } catch (error) {
      if (error instanceof GitProviderError) throw error;
      throw gitError("reconcile GitHub access", error);
    }
  }

  async #reconcileProfile(
    api: TildeApi,
    teamId: string,
    profiles: readonly ReverseProxyProfile[],
    desired: { id: string; providerId: string; credentialId: string },
  ): Promise<ReverseProxyProfile> {
    const existing = profiles.find((profile) => profile.id === desired.id);
    if (!existing) {
      const { data } = await reverseProxyCreateProfile({
        client: api,
        path: { team_id: teamId },
        body: {
          id: desired.id,
          provider_id: desired.providerId,
          resource_server_credential_id: desired.credentialId,
          enabled: true,
        },
        throwOnError: true,
      });
      return data;
    }
    if (existing.enabled && existing.resource_server_credential_id === desired.credentialId)
      return existing;
    const { data } = await reverseProxyUpdateProfile({
      client: api,
      path: { team_id: teamId, profile_id: existing.id },
      body: { enabled: true, resource_server_credential_id: desired.credentialId },
      throwOnError: true,
    });
    return data;
  }

  #api(): TildeApi {
    const connection = this.platform.connection();
    return createTildeApiClient({
      baseUrl: connection.baseUrl,
      apiKey: connection.apiKey,
      orgId: connection.orgId,
      throwOnError: true,
    });
  }
}

type TildeApi = ReturnType<typeof createTildeApiClient>;

interface GitHubProvisioningRequest {
  api: TildeApi;
  teamId: string;
  environment: NodeJS.ProcessEnv;
  report: DeploymentReporter;
  /** When an owner is present, pending actions are handled locally instead of only reported. */
  interactive: boolean;
  /** Pending authorization actions captured for interactive handling. */
  actions: ProviderProvisioningNextAction[];
}

/**
 * Find the brokered GitHub tool group, provisioning the GitHub App and surfacing the pending
 * authorization action when needed. Shared by initialization and the deployment lifecycle.
 */
async function ensureGitHubAppProvisioning(
  request: GitHubProvisioningRequest,
): Promise<ToolGroupInstanceSerialized | undefined> {
  let group = await findGitHubToolGroup(request.api, request.teamId);
  if (!group) {
    await provisionGitHubApp(request);
    group = await findGitHubToolGroup(request.api, request.teamId);
  } else if (!group.resource_server_credential_id) {
    await resumeGitHubAppProvisioning(request, group);
  }
  return group;
}

async function provisionGitHubApp(request: GitHubProvisioningRequest): Promise<void> {
  const { data } = await autoProvisionToolGroupInstance({
    client: request.api,
    path: {
      team_id: request.teamId,
      tool_group_source_type_id: githubToolGroupSourceTypeId,
      credential_source_type_id: githubCredentialSourceTypeId,
    },
    body: {
      app_display_name: githubAppDisplayName(request.environment),
      provider_id: githubProviderProvisionerId,
      public_base_url: tildePublicBaseUrl(request.environment),
    },
    throwOnError: true,
  });
  await surfaceProvisioningAction(request, data.provider_provisioning_response.next_action);
}

/** The GitHub App Manifest flow resumes with a fresh provisioning session for the same owner. */
async function resumeGitHubAppProvisioning(
  request: GitHubProvisioningRequest,
  group: ToolGroupInstanceSerialized,
): Promise<void> {
  const { data } = await startProviderAppProvisioning({
    client: request.api,
    path: { team_id: request.teamId },
    body: {
      app_display_name: githubAppDisplayName(request.environment),
      owner_id: group.id,
      owner_type: "tool_group_instance",
      provider_id: githubProviderProvisionerId,
      target_provider_id: githubToolGroupSourceTypeId,
      public_base_url: tildePublicBaseUrl(request.environment),
    },
    throwOnError: true,
  });
  await surfaceProvisioningAction(request, data.next_action);
}

function githubAppDisplayName(environment: NodeJS.ProcessEnv): string {
  const configured = environment[githubAppNameEnvironmentName]?.trim();
  if (configured) return configured;
  return `${environment.OPENBOT_DEPLOYMENT_NAME?.trim() || "OpenBot"} GitHub`;
}

/** GitHub's manifest flow targets an organization through its dedicated creation URL. */
export function organizationActionUrl(actionUrl: string, environment: NodeJS.ProcessEnv): string {
  const organization = environment[githubAppOrganizationEnvironmentName]?.trim();
  if (!organization) return actionUrl;
  try {
    const url = new URL(actionUrl);
    if (url.hostname !== "github.com" || url.pathname !== "/settings/apps/new") return actionUrl;
    url.pathname = `/organizations/${organization}/settings/apps/new`;
    return url.toString();
  } catch {
    return actionUrl;
  }
}

function tildePublicBaseUrl(environment: NodeJS.ProcessEnv): string {
  return environment.TILDE_BASE_URL?.trim() || "https://api.trytilde.ai";
}

/** Tilde connection values collected by the shared platform's initialization questions. */
function tildeConnectionFromEnvironment(
  environment: NodeJS.ProcessEnv,
): { baseUrl: string; apiKey: string; orgId: string; teamId: string } | undefined {
  const apiKey = environment.TILDE_API_KEY?.trim();
  const orgId = environment.TILDE_ORG_ID?.trim();
  const teamId = environment.TILDE_TEAM_ID?.trim();
  if (!apiKey || !orgId || !teamId) return undefined;
  return {
    baseUrl: environment.TILDE_BASE_URL?.trim() || "https://api.trytilde.ai",
    apiKey,
    orgId,
    teamId,
  };
}

async function findGitHubToolGroup(
  api: TildeApi,
  teamId: string,
): Promise<ToolGroupInstanceSerialized | undefined> {
  const { data } = await listToolGroupInstances({
    client: api,
    path: { team_id: teamId },
    query: {
      page_size: 100,
      tool_group_source_type_id: githubToolGroupSourceTypeId,
      include_global: false,
    },
    throwOnError: true,
  });
  return data.items.find((item) => item.tool_group_source_type_id === githubToolGroupSourceTypeId);
}

async function listProfiles(
  api: TildeApi,
  teamId: string,
): Promise<readonly ReverseProxyProfile[]> {
  const { data } = await reverseProxyListProfiles({
    client: api,
    path: { team_id: teamId },
    query: { page_size: 100 },
    throwOnError: true,
  });
  return data.items;
}

async function surfaceProvisioningAction(
  request: GitHubProvisioningRequest,
  action: ProviderProvisioningNextAction,
): Promise<void> {
  request.actions.push(action);
  if (request.interactive && action.type !== "render_instructions") return;
  if (action.type === "redirect") {
    request.report({ event: "git.github.authorization.required", details: { url: action.url } });
  } else if (action.type === "render_instructions") {
    request.report({
      event: "git.github.authorization.required",
      details: { instructions: action.markdown },
    });
  } else if (action.type === "render_form_post") {
    // A browser form POST cannot be followed from a log line; point the owner at init.
    request.report({
      event: "git.github.authorization.required",
      details: {
        url: action.action_url,
        hint: "Run openbot init in an interactive terminal to complete the GitHub App authorization.",
      },
    });
  }
}

/** Auto-submitting page for GitHub's App Manifest form POST. */
export function authorizationFormPage(actionUrl: string, fields: unknown): string {
  const entries = Object.entries((fields ?? {}) as Record<string, unknown>);
  const inputs = entries
    .map(([name, value]) => {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      return `    <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(serialized)}" />`;
    })
    .join("\n");
  return [
    "<!doctype html>",
    '<meta charset="utf-8" />',
    "<title>Authorize the OpenBot GitHub App</title>",
    '<body onload="document.forms[0].submit()">',
    "  <p>Redirecting to GitHub to create and install the OpenBot GitHub App…</p>",
    `  <form method="post" action="${escapeHtml(actionUrl)}">`,
    inputs,
    '    <button type="submit">Continue to GitHub</button>',
    "  </form>",
    "</body>",
    "",
  ].join("\n");
}

/** Serve one authorization page on an ephemeral loopback port. */
async function serveAuthorizationPage(page: string): Promise<{ url: string; close: () => void }> {
  const server = createServer((incoming, response) => {
    if ((incoming.url ?? "/") === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(page);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}/`, close: () => void server.close() };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const runGit = promisify(execFile);

async function originGitHubRepository(repositoryRoot: string): Promise<string | undefined> {
  let url: string;
  try {
    const { stdout } = await runGit("git", ["-C", repositoryRoot, "remote", "get-url", "origin"], {
      encoding: "utf8",
    });
    url = stdout.trim();
  } catch {
    return undefined;
  }
  return parseGitHubRepository(url);
}

/** Extract owner/name from a GitHub HTTPS or SSH remote URL; undefined for other hosts. */
export function parseGitHubRepository(url: string): string | undefined {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  return match?.[1];
}

function gitError(operation: string, error: unknown): GitProviderError {
  return new GitProviderError(
    "provider_unavailable",
    `Unable to ${operation}: ${tildeErrorMessage(error, "unknown error")}`,
    true,
  );
}
