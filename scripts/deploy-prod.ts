import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadDotenv, parse as parseDotenv } from "dotenv";
import { Sandbox } from "@vercel/sandbox";
import { desktopBootstrapScript, desktopStartScript } from "@openbot/providers";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const DEPLOY_DIRECTORY = resolve(".openbot-deploy");
const STATE_PATH = join(DEPLOY_DIRECTORY, "state.json");
const SETUP_CODE_PATH = join(DEPLOY_DIRECTORY, "setup-code");
const TURSO_INTEGRATION = "tursocloud";
const TURSO_PRODUCT = "tursocloud/database";
const TILDE_PRODUCTION_BASE_URL = "https://api.trytilde.ai";
const DEFAULT_SOPS_FILE = resolve(".openbot-deploy/secrets.enc.env");

export interface DeployOptions {
  yes: boolean;
  dryRun: boolean;
  resume: boolean;
  json: boolean;
}

interface StepRecord {
  status: "complete";
  completedAt: string;
}

interface DeployState {
  version: 1;
  project?: { id: string; name: string; teamId: string };
  turso?: { id?: string; name?: string };
  initialDeploymentUrl?: string;
  deploymentUrl?: string;
  publicOrigin?: string;
  tilde?: { agentId?: string; providerId?: string; runtimeMcpServerId?: string; skillRegistryId?: string };
  snapshotId?: string;
  steps: Record<string, StepRecord>;
}

interface CommandOptions {
  env?: NodeJS.ProcessEnv;
  input?: string;
  allowFailure?: boolean;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface TildeImportResource {
  id?: string;
  action?: string;
}

interface TildeImportResult {
  importId: string;
  status: string;
  resources: Record<string, TildeImportResource>;
  environment?: Record<string, string>;
}

const TILDE_PENDING_IMPORT_STATUSES = new Set([
  "queued",
  "validating",
  "applying",
  "rolling_back",
]);

const TILDE_FAILED_IMPORT_STATUSES = new Set(["failed", "rolled_back"]);

export function parseOptions(argv: readonly string[]): DeployOptions {
  argv = argv.filter((argument) => argument !== "--");
  const known = new Set(["--yes", "--dry-run", "--resume", "--json"]);
  const unknown = argv.filter((argument) => !known.has(argument));
  if (unknown.length) throw new Error(`Unknown deploy option: ${unknown.join(", ")}`);
  return {
    yes: argv.includes("--yes"),
    dryRun: argv.includes("--dry-run"),
    resume: argv.includes("--resume"),
    json: argv.includes("--json"),
  };
}

export function redact(value: string, secrets: Iterable<string>): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length >= 8) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted.replace(/(TILDE_(?:API_KEY|WEBHOOK_SIGNING_KEY)|OPENAI_API_KEY|OPENBOT_SETUP_CODE|DATABASE_AUTH_TOKEN)=([^\s]+)/g, "$1=[REDACTED]");
}

export function findMarketplaceResources(value: unknown): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, unknown>;
    const serialized = JSON.stringify(record).toLowerCase();
    if ((serialized.includes("tursocloud") || serialized.includes('"provider":"turso cloud"'))
      && (typeof record.id === "string" || typeof record.name === "string")) found.push(record);
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(value);
  return found;
}

async function main(): Promise<void> {
  loadDotenv({ path: resolve(".env.local"), override: false, quiet: true });
  loadDotenv({ path: resolve(".env"), override: false, quiet: true });
  await loadSopsEnvironment();
  const options = parseOptions(process.argv.slice(2));
  if (!options.yes && !options.dryRun) throw new Error("Production deployment requires --yes (or use --dry-run)");

  const required = ["VERCEL_TOKEN", "VERCEL_TEAM_ID", "TILDE_ORG_ID", "TILDE_TEAM_ID", "OPENAI_API_KEY"] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (!process.env.TILDE_BEARER_TOKEN && !process.env.TILDE_API_KEY) missing.push("TILDE_BEARER_TOKEN" as (typeof required)[number]);
  if (missing.length) throw new Error(`Missing production deployment variables: ${[...new Set(missing)].join(", ")}`);

  const env = {
    ...process.env,
    // Production automation must not inherit a developer's Tilde environment.
    TILDE_BASE_URL: TILDE_PRODUCTION_BASE_URL,
  } as unknown as NodeJS.ProcessEnv & Record<(typeof required)[number], string>;
  const projectName = process.env.VERCEL_PROJECT_NAME || "openbot";
  const state = await readState();
  if (!options.resume) {
    delete state.steps.validate;
    delete state.steps.deploy_initial;
    delete state.steps.deploy_final;
    delete state.steps.reconcile;
    delete state.steps.smoke;
  }

  const setupCode = await loadSetupCode(options);
  const secrets = new Set<string>([
    setupCode,
    env.VERCEL_TOKEN,
    env.OPENAI_API_KEY,
    process.env.TILDE_BEARER_TOKEN ?? "",
    process.env.TILDE_API_KEY ?? "",
    process.env.TILDE_WEBHOOK_SIGNING_KEY ?? "",
  ]);
  const report = (event: string, details: Record<string, unknown> = {}): void => {
    if (options.json) process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
    else process.stdout.write(`${event}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}\n`);
  };

  const step = async (name: string, action: () => Promise<void>, reusable = true): Promise<void> => {
    if (reusable && state.steps[name]) {
      report("step.reused", { step: name });
      return;
    }
    report(options.dryRun ? "step.planned" : "step.started", { step: name });
    if (options.dryRun) return;
    await action();
    state.steps[name] = { status: "complete", completedAt: new Date().toISOString() };
    await writeState(state);
    report("step.complete", { step: name });
  };

  await step("validate", async () => {
    await run("pnpm", ["check"], { env });
    await run("pnpm", ["build"], { env });
  }, false);

  await step("project", async () => {
    const inspect = await vercel(["project", "inspect", projectName, "--yes"], env, true);
    if (inspect.code !== 0) await vercel(["project", "add", projectName], env);
    await vercel(["link", "--yes", "--team", env.VERCEL_TEAM_ID, "--project", projectName], env);
    const linked = JSON.parse(await readFile(resolve(".vercel/project.json"), "utf8")) as { projectId: string; orgId: string; projectName?: string };
    state.project = { id: linked.projectId, name: linked.projectName || projectName, teamId: linked.orgId };
  });

  await step("turso", async () => {
    const listed = await vercel(["integration", "list", "--integration", TURSO_INTEGRATION, "--json"], env);
    const resources = findMarketplaceResources(parseJsonOutput(listed.stdout));
    let resource = resources[0];
    if (!resource) {
      const added = await vercel([
        "integration", "add", TURSO_PRODUCT,
        "--name", `${projectName}-db`,
        "--metadata", `region=${process.env.TURSO_PRIMARY_REGION || "iad1"}`,
        "--plan", process.env.TURSO_PLAN || "starter",
        "--environment", "production",
        "--no-env-pull",
        "--json",
        "--non-interactive",
      ], env);
      resource = findMarketplaceResources(parseJsonOutput(added.stdout))[0] ?? parseJsonOutput(added.stdout) as Record<string, unknown>;
    }
    state.turso = {
      ...(typeof resource.id === "string" ? { id: resource.id } : {}),
      ...(typeof resource.name === "string" ? { name: resource.name } : {}),
    };
    const temporary = await mkdtemp(join(tmpdir(), "openbot-vercel-env-"));
    try {
      const pulledPath = join(temporary, "production.env");
      await vercel(["env", "pull", pulledPath, "--environment", "production", "--yes"], env);
      const pulled = parseDotenv(await readFile(pulledPath));
      const databaseUrl = pulled.TURSO_DATABASE_URL ?? pulled.DATABASE_URL;
      const databaseToken = pulled.TURSO_AUTH_TOKEN ?? pulled.DATABASE_AUTH_TOKEN;
      if (!databaseUrl || !databaseToken) throw new Error("Turso did not expose TURSO_DATABASE_URL and TURSO_AUTH_TOKEN");
      secrets.add(databaseUrl);
      secrets.add(databaseToken);
      await setVercelEnvironment("DATABASE_URL", databaseUrl, env);
      await setVercelEnvironment("DATABASE_AUTH_TOKEN", databaseToken, env);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  await step("setup_code", async () => {
    if (!state.project) throw new Error("Vercel project is missing");
    await setVercelEnvironment("OPENBOT_SETUP_CODE", setupCode, env);
    await setVercelEnvironment("OPENBOT_VERCEL_API_TOKEN", env.VERCEL_TOKEN, env);
    await setVercelEnvironment("OPENBOT_VERCEL_PROJECT_ID", state.project.id, env);
    await setVercelEnvironment("OPENBOT_VERCEL_TEAM_ID", state.project.teamId, env);
    await setVercelEnvironment("ENABLE_EXPERIMENTAL_COREPACK", "1", env);
    await setVercelEnvironment("NODEJS_HELPERS", "0", env);
  });

  await step("deploy_initial", async () => {
    state.initialDeploymentUrl = await deployVercel(env);
    state.publicOrigin = await productionOrigin(state.initialDeploymentUrl, projectName, env);
  });

  await step("tilde_import", async () => {
    if (!state.publicOrigin) throw new Error("Initial deployment URL is missing");
    const source = await readFile(resolve("tilde.state.yaml"), "utf8");
    const rendered = renderTildeState(source, `${state.publicOrigin}/api/tilde/chatkit`);
    const importInput = {
      baseUrl: TILDE_PRODUCTION_BASE_URL,
      accessToken: env.TILDE_BEARER_TOKEN ?? env.TILDE_API_KEY!,
      orgId: env.TILDE_ORG_ID,
      teamId: env.TILDE_TEAM_ID,
      state: rendered,
    };
    let imported: TildeImportResult | undefined;
    for (let attempt = 0; attempt < 3 && !imported; attempt += 1) {
      try {
        imported = await importTildeState(importInput);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (process.env.TILDE_WEBHOOK_SIGNING_KEY) throw error;
        if (
          message.includes(
            "resource chatkit/agent/openbot-gateway conflicts with existing state",
          )
        ) {
          const agentId = await findExactTildeGatewayId({
            ...importInput,
            expectedEndpointUrl: `${state.publicOrigin}/api/tilde/chatkit`,
          });
          report("tilde.gateway_recovery.started", { agentId });
          await deleteExactTildeGateway({
            ...importInput,
            agentId,
            expectedEndpointUrl: `${state.publicOrigin}/api/tilde/chatkit`,
          });
          report("tilde.gateway_recovery.deleted", { agentId });
          continue;
        }
        if (
          message.includes(
            "resource chatkit/provider/openbot-web conflicts with existing state",
          )
        ) {
          const providerId = await findExactTildeProviderId(importInput);
          report("tilde.provider_recovery.started", { providerId });
          await deleteExactTildeProvider({ ...importInput, providerId });
          report("tilde.provider_recovery.deleted", { providerId });
          continue;
        }
        throw error;
      }
    }
    if (!imported) {
      throw new Error("Tilde state recovery did not converge after three attempts");
    }
    if (
      !imported.environment?.TILDE_API_KEY &&
      !process.env.TILDE_WEBHOOK_SIGNING_KEY
    ) {
      const agent = imported.resources["chatkit/agent/openbot-gateway"];
      if (agent?.action !== "unchanged" || !agent.id) {
        throw new Error(
          "Tilde created the gateway without returning its one-time application credentials",
        );
      }
      report("tilde.gateway_recovery.started", { agentId: agent.id });
      await deleteExactTildeGateway({
        ...importInput,
        agentId: agent.id,
        expectedEndpointUrl: `${state.publicOrigin}/api/tilde/chatkit`,
      });
      report("tilde.gateway_recovery.deleted", { agentId: agent.id });
      imported = await importTildeState(importInput);
    }
    const apiKey =
      imported.environment?.TILDE_API_KEY ??
      process.env.OPENBOT_TILDE_API_KEY;
    const webhookSigningKey =
      imported.environment?.TILDE_WEBHOOK_SIGNING_KEY ??
      process.env.OPENBOT_TILDE_WEBHOOK_SIGNING_KEY;
    if (!apiKey || !webhookSigningKey) throw new Error("Tilde import did not return TILDE_API_KEY and TILDE_WEBHOOK_SIGNING_KEY");
    secrets.add(apiKey);
    secrets.add(webhookSigningKey);
    process.env.OPENBOT_IMPORTED_TILDE_API_KEY = apiKey;
    process.env.OPENBOT_IMPORTED_TILDE_WEBHOOK_SIGNING_KEY = webhookSigningKey;
    state.tilde = {
      agentId: imported.resources["chatkit/agent/openbot-gateway"]?.id,
      providerId: imported.resources["chatkit/provider/openbot-web"]?.id,
    };
    if (!state.tilde.agentId || !state.tilde.providerId) {
      throw new Error("Tilde import did not return the OpenBot agent and provider IDs");
    }
    // Persist one-time application credentials before advancing the checkpoint.
    // If a later setup call fails, a resumed process can recover them through a
    // mode-0600 Vercel env pull instead of recreating healthy Tilde resources.
    await setVercelEnvironment("OPENBOT_TILDE_API_KEY", apiKey, env);
    await setVercelEnvironment(
      "OPENBOT_TILDE_WEBHOOK_SIGNING_KEY",
      webhookSigningKey,
      env,
    );
    await setVercelEnvironment("OPENBOT_TILDE_ORG_ID", env.TILDE_ORG_ID, env);
    await setVercelEnvironment("OPENBOT_TILDE_TEAM_ID", env.TILDE_TEAM_ID, env);
    await setVercelEnvironment(
      "OPENBOT_TILDE_AGENT_ID",
      state.tilde.agentId,
      env,
    );
    await setVercelEnvironment(
      "OPENBOT_TILDE_UI_PROVIDER_ID",
      state.tilde.providerId,
      env,
    );
  });

  await step("configure", async () => {
    if (!state.publicOrigin) throw new Error("Deployment origin is missing");
    let tildeApiKey =
      process.env.OPENBOT_IMPORTED_TILDE_API_KEY ??
      process.env.OPENBOT_TILDE_API_KEY;
    let signingKey =
      process.env.OPENBOT_IMPORTED_TILDE_WEBHOOK_SIGNING_KEY ??
      process.env.OPENBOT_TILDE_WEBHOOK_SIGNING_KEY;
    if (!tildeApiKey || !signingKey) {
      const persisted = await pullVercelProductionEnvironment(env);
      tildeApiKey ||= persisted.OPENBOT_TILDE_API_KEY;
      signingKey ||= persisted.OPENBOT_TILDE_WEBHOOK_SIGNING_KEY;
      if (tildeApiKey) secrets.add(tildeApiKey);
      if (signingKey) secrets.add(signingKey);
    }
    if (!tildeApiKey || !signingKey) {
      throw new Error(
        state.steps.tilde_import
          ? "Tilde import completed in an earlier process, but its one-time application credentials were intentionally not persisted. Resume with TILDE_API_KEY and TILDE_WEBHOOK_SIGNING_KEY set."
          : "Tilde application credentials are unavailable for setup",
      );
    }
    await configureInstallation(state.publicOrigin, setupCode, {
      tildeApiKey,
      tildeWebhookSigningKey: signingKey,
      tildeOrgId: env.TILDE_ORG_ID,
      tildeTeamId: env.TILDE_TEAM_ID,
      tildeAgentId: state.tilde?.agentId ?? "",
      tildeUiProviderId: state.tilde?.providerId ?? "",
      tildeRuntimeMcpServerId: state.tilde?.runtimeMcpServerId ?? process.env.TILDE_RUNTIME_MCP_SERVER_ID ?? "",
      tildeSkillRegistryId: state.tilde?.skillRegistryId ?? process.env.TILDE_SKILL_REGISTRY_ID ?? "",
      openaiApiKey: env.OPENAI_API_KEY,
      openaiModel: process.env.OPENAI_MODEL || "gpt-5.4",
      vercelApiToken: env.VERCEL_TOKEN,
    });
  });

  await step("snapshot", async () => {
    if (!state.project) throw new Error("Vercel project is missing");
    state.snapshotId = await provisionSnapshot({
      token: env.VERCEL_TOKEN,
      projectId: state.project.id,
      teamId: state.project.teamId,
    });
    await setVercelEnvironment("OPENBOT_VERCEL_SANDBOX_SNAPSHOT_ID", state.snapshotId, env);
  });

  await step("reconcile", async () => {
    if (!state.publicOrigin) throw new Error("Deployment origin is missing");
    const cookie = await unlock(state.publicOrigin, setupCode);
    const response = await fetch(`${state.publicOrigin}/api/admin/reconcile`, { method: "POST", headers: { cookie } });
    if (!response.ok) throw new Error(`Repository reconciliation failed (${response.status}): ${await response.text()}`);
  });

  await step("deploy_final", async () => {
    state.deploymentUrl = await deployVercel(env);
    state.publicOrigin = await productionOrigin(state.deploymentUrl, projectName, env);
  });

  await step("smoke", async () => {
    if (!state.publicOrigin) throw new Error("Final deployment origin is missing");
    await productionSmoke(state.publicOrigin, setupCode);
  });

  report("deployment.complete", {
    url: state.publicOrigin,
    projectId: state.project?.id,
    tursoResourceId: state.turso?.id,
    tildeAgentId: state.tilde?.agentId,
    tildeProviderId: state.tilde?.providerId,
    sandboxSnapshotId: state.snapshotId,
    setupCodePath: options.dryRun ? SETUP_CODE_PATH : basename(SETUP_CODE_PATH),
  });
}

export function mergeDecryptedEnvironment(
  source: string,
  target: NodeJS.ProcessEnv = process.env,
): void {
  for (const [name, value] of Object.entries(parseDotenv(source))) {
    if (!target[name]) target[name] = value;
  }
}

export function renderTildeState(source: string, endpointUrl: string): string {
  const document = parseYaml(source) as Record<string, unknown>;
  if (!document || typeof document !== "object") throw new Error("Tilde state must be a YAML object");
  const resources = document.resources;
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
    throw new Error("Tilde state is missing resources");
  }
  const gateway = (resources as Record<string, unknown>)["chatkit/agent/openbot-gateway"];
  if (!gateway || typeof gateway !== "object" || Array.isArray(gateway)) {
    throw new Error("Tilde state is missing chatkit/agent/openbot-gateway");
  }
  (gateway as Record<string, unknown>).endpointUrl = endpointUrl;
  // @trytilde/cli 0.1.0 sends raw state without a variables map. The checked-in
  // state retains the variable for the human Deploy Button; the temporary
  // automated import is fully rendered and therefore removes the declaration.
  delete document.variables;
  return stringifyYaml(document);
}

export function parseTildeImportSummary(value: unknown): TildeImportResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tilde state import returned an invalid response");
  }
  const summary = value as Record<string, unknown>;
  const importId = stringValue(summary.import_id);
  const status = stringValue(summary.status)?.toLowerCase();
  if (!importId || !status) throw new Error("Tilde state import response is missing its ID or status");

  if (TILDE_FAILED_IMPORT_STATUSES.has(status)) {
    const errors = Array.isArray(summary.errors)
      ? summary.errors.filter((error): error is string => typeof error === "string")
      : [];
    throw new Error(`Tilde state import ${status}${errors.length ? `: ${errors.join("; ")}` : ""}`);
  }
  if (status !== "applied") throw new Error(`Tilde state import stopped in unexpected status: ${status}`);

  const outputs = summary.outputs && typeof summary.outputs === "object" && !Array.isArray(summary.outputs)
    ? summary.outputs as Record<string, unknown>
    : {};
  const resourcesValue = outputs.resources;
  const resources: Record<string, TildeImportResource> = {};
  if (resourcesValue && typeof resourcesValue === "object" && !Array.isArray(resourcesValue)) {
    for (const [address, resource] of Object.entries(resourcesValue as Record<string, unknown>)) {
      if (resource && typeof resource === "object" && !Array.isArray(resource)) {
        const record = resource as Record<string, unknown>;
        const id = stringValue(record.id);
        const action = stringValue(record.action);
        resources[address] = {
          ...(id ? { id } : {}),
          ...(action ? { action } : {}),
        };
      }
    }
  }
  if (!Object.keys(resources).length) throw new Error("Tilde state import completed without resource outputs");

  const environmentFile = outputs.environment_file;
  const contents = environmentFile && typeof environmentFile === "object" && !Array.isArray(environmentFile)
    ? stringValue((environmentFile as Record<string, unknown>).contents)
    : undefined;
  return {
    importId,
    status,
    resources,
    ...(contents ? { environment: parseDotenv(contents) } : {}),
  };
}

async function importTildeState(input: {
  baseUrl: string;
  accessToken: string;
  orgId: string;
  teamId: string;
  state: string;
}): Promise<TildeImportResult> {
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${input.accessToken}`,
    "content-type": "application/json",
    "x-tilde-org-id": input.orgId,
  };
  const importPath = `/api/v1/team/${encodeURIComponent(input.teamId)}/state/import`;
  const started = await tildeJsonRequest(new URL(importPath, input.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({ state: input.state, format: "yaml", variables: {} }),
  });
  if (!started || typeof started !== "object" || Array.isArray(started)) {
    throw new Error("Tilde state import did not return an import ID");
  }
  const importId = stringValue((started as Record<string, unknown>).import_id);
  const initialStatus = stringValue((started as Record<string, unknown>).status)?.toLowerCase();
  if (!importId || !initialStatus) throw new Error("Tilde state import did not return an import ID or status");

  const deadline = Date.now() + 120_000;
  let summary: unknown = started;
  let status = initialStatus;
  while (TILDE_PENDING_IMPORT_STATUSES.has(status) && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    summary = await tildeJsonRequest(
      new URL(`${importPath}/${encodeURIComponent(importId)}`, input.baseUrl),
      { headers },
    );
    status = summary && typeof summary === "object" && !Array.isArray(summary)
      ? stringValue((summary as Record<string, unknown>).status)?.toLowerCase() ?? ""
      : "";
  }
  if (TILDE_PENDING_IMPORT_STATUSES.has(status)) {
    throw new Error(`Tilde state import ${importId} did not finish within 120 seconds`);
  }
  return parseTildeImportSummary(summary);
}

async function deleteExactTildeGateway(input: {
  baseUrl: string;
  accessToken: string;
  orgId: string;
  teamId: string;
  agentId: string;
  expectedEndpointUrl: string;
}): Promise<void> {
  const path = `/api/v1/team/${encodeURIComponent(input.teamId)}/chatkit/agents/${encodeURIComponent(input.agentId)}`;
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${input.accessToken}`,
    "x-tilde-org-id": input.orgId,
  };
  const existing = await tildeJsonRequest(new URL(path, input.baseUrl), {
    headers,
  });
  if (!isExactTildeGateway(existing, input.agentId, input.expectedEndpointUrl)) {
    throw new Error(
      "Refusing gateway recovery because the existing Tilde agent does not exactly match this OpenBot deployment",
    );
  }
  await tildeJsonRequest(new URL(path, input.baseUrl), {
    method: "DELETE",
    headers,
  });
}

async function findExactTildeGatewayId(input: {
  baseUrl: string;
  accessToken: string;
  orgId: string;
  teamId: string;
  expectedEndpointUrl: string;
}): Promise<string> {
  const path = `/api/v1/team/${encodeURIComponent(input.teamId)}/chatkit/agents?page_size=100`;
  const response = await tildeJsonRequest(new URL(path, input.baseUrl), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.accessToken}`,
      "x-tilde-org-id": input.orgId,
    },
  });
  const items =
    response && typeof response === "object" && !Array.isArray(response)
      ? (response as Record<string, unknown>).items
      : undefined;
  const matches = Array.isArray(items)
    ? items.filter((candidate) =>
        isExactTildeGateway(candidate, undefined, input.expectedEndpointUrl),
      )
    : [];
  if (matches.length !== 1) {
    throw new Error(
      `Refusing gateway recovery because exactly one matching Tilde agent was expected, found ${matches.length}`,
    );
  }
  const id = stringValue((matches[0] as Record<string, unknown>).id);
  if (!id) throw new Error("Refusing gateway recovery because the matching agent has no ID");
  return id;
}

function isExactTildeGateway(
  value: unknown,
  expectedId: string | undefined,
  expectedEndpointUrl: string,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const configuration =
    record.configuration &&
    typeof record.configuration === "object" &&
    !Array.isArray(record.configuration)
      ? (record.configuration as Record<string, unknown>)
      : {};
  return (
    (!expectedId || record.id === expectedId) &&
    configuration.display_name === "OpenBot Gateway" &&
    configuration.endpoint_url === expectedEndpointUrl
  );
}

async function findExactTildeProviderId(input: {
  baseUrl: string;
  accessToken: string;
  orgId: string;
  teamId: string;
}): Promise<string> {
  const path = `/api/v1/team/${encodeURIComponent(input.teamId)}/chatkit/channels?page_size=100`;
  const response = await tildeJsonRequest(new URL(path, input.baseUrl), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.accessToken}`,
      "x-tilde-org-id": input.orgId,
    },
  });
  const items =
    response && typeof response === "object" && !Array.isArray(response)
      ? (response as Record<string, unknown>).items
      : undefined;
  const matches = Array.isArray(items)
    ? items.filter(isExactTildeProvider)
    : [];
  if (matches.length !== 1) {
    throw new Error(
      `Refusing provider recovery because exactly one OpenBot Web provider was expected, found ${matches.length}`,
    );
  }
  const id = stringValue((matches[0] as Record<string, unknown>).id);
  if (!id) throw new Error("Refusing provider recovery because the matching provider has no ID");
  return id;
}

async function deleteExactTildeProvider(input: {
  baseUrl: string;
  accessToken: string;
  orgId: string;
  teamId: string;
  providerId: string;
}): Promise<void> {
  const path = `/api/v1/team/${encodeURIComponent(input.teamId)}/chatkit/channels/${encodeURIComponent(input.providerId)}`;
  await tildeJsonRequest(new URL(path, input.baseUrl), {
    method: "DELETE",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.accessToken}`,
      "x-tilde-org-id": input.orgId,
    },
  });
}

function isExactTildeProvider(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const configuration =
    record.configuration &&
    typeof record.configuration === "object" &&
    !Array.isArray(record.configuration)
      ? (record.configuration as Record<string, unknown>)
      : {};
  return (
    record.provider_id === "chatkit.channel.vercel-ui" &&
    configuration.display_name === "OpenBot Web"
  );
}

async function tildeJsonRequest(url: URL, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const candidate = parsed.message ?? parsed.error ?? parsed.detail;
      if (typeof candidate === "string") detail = candidate;
    } catch {}
    throw new Error(`Tilde API request failed (${response.status}): ${detail}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Tilde API returned a non-JSON response");
  }
}

export async function loadSopsEnvironment(
  path = process.env.OPENBOT_SOPS_FILE?.trim() || DEFAULT_SOPS_FILE,
): Promise<boolean> {
  try {
    await access(path);
  } catch {
    return false;
  }

  const result = await new Promise<CommandResult>((resolvePromise, reject) => {
    const sopsEnv = sopsEnvironment();
    const child = spawn("sops", ["decrypt", "--output-type", "dotenv", path], {
      cwd: process.cwd(),
      env: sopsEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
  if (result.code !== 0) {
    throw new Error(`Unable to decrypt ${path} with SOPS (${result.code}): ${result.stderr.trim() || "unknown error"}`);
  }
  mergeDecryptedEnvironment(result.stdout);
  return true;
}

export function sopsEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  const profile = source.OPENBOT_SOPS_AWS_PROFILE?.trim();
  if (profile) {
    env.AWS_PROFILE = profile;
    delete env.AWS_ACCESS_KEY_ID;
    delete env.AWS_SECRET_ACCESS_KEY;
    delete env.AWS_SESSION_TOKEN;
    delete env.AWS_SECURITY_TOKEN;
  }
  return env;
}

async function loadSetupCode(options: DeployOptions): Promise<string> {
  const fromEnvironment = process.env.OPENBOT_SETUP_CODE?.trim();
  if (fromEnvironment) {
    if (fromEnvironment.length < 16) throw new Error("OPENBOT_SETUP_CODE must contain at least 16 characters");
    if (!options.dryRun) await secureWrite(SETUP_CODE_PATH, `${fromEnvironment}\n`);
    return fromEnvironment;
  }
  try {
    const existing = (await readFile(SETUP_CODE_PATH, "utf8")).trim();
    if (existing.length >= 16) return existing;
  } catch {}
  const generated = randomBytes(32).toString("base64url");
  if (!options.dryRun) await secureWrite(SETUP_CODE_PATH, `${generated}\n`);
  return generated;
}

async function readState(): Promise<DeployState> {
  try {
    const value = JSON.parse(await readFile(STATE_PATH, "utf8")) as DeployState;
    if (value.version === 1 && value.steps) return value;
  } catch {}
  return { version: 1, steps: {} };
}

async function writeState(state: DeployState): Promise<void> {
  await mkdir(DEPLOY_DIRECTORY, { recursive: true, mode: 0o700 });
  await chmod(DEPLOY_DIRECTORY, 0o700);
  const temporary = `${STATE_PATH}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, STATE_PATH);
  await chmod(STATE_PATH, 0o600);
}

async function secureWrite(path: string, content: string): Promise<void> {
  await mkdir(DEPLOY_DIRECTORY, { recursive: true, mode: 0o700 });
  await chmod(DEPLOY_DIRECTORY, 0o700);
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function run(command: string, args: readonly string[], options: CommandOptions = {}): Promise<CommandResult> {
  const result = await new Promise<CommandResult>((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      cwd: process.cwd(),
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
  if (result.code !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.code}): ${result.stderr || result.stdout}`);
  }
  return result;
}

async function vercel(args: readonly string[], env: NodeJS.ProcessEnv, allowFailure = false): Promise<CommandResult> {
  return run("pnpm", ["exec", "vercel", ...args, "--scope", env.VERCEL_TEAM_ID!, "--non-interactive"], { env, allowFailure });
}

async function setVercelEnvironment(name: string, value: string, env: NodeJS.ProcessEnv): Promise<void> {
  await run("pnpm", [
    "exec", "vercel", "env", "add", name, "production",
    "--force", "--sensitive", "--yes",
    "--scope", env.VERCEL_TEAM_ID!, "--non-interactive",
  ], { env, input: `${value}\n` });
}

async function pullVercelProductionEnvironment(
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const temporary = await mkdtemp(join(tmpdir(), "openbot-vercel-env-"));
  try {
    const path = join(temporary, "production.env");
    await vercel(
      ["env", "pull", path, "--environment", "production", "--yes"],
      env,
    );
    return parseDotenv(await readFile(path));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function deployVercel(env: NodeJS.ProcessEnv): Promise<string> {
  const result = await vercel(["deploy", "--prod", "--yes"], env);
  const urls = `${result.stdout}\n${result.stderr}`.match(/https:\/\/[^\s]+\.vercel\.app/g);
  if (!urls?.length) throw new Error(`Vercel deploy did not return a URL: ${result.stdout || result.stderr}`);
  return urls.at(-1)!;
}

async function productionOrigin(deploymentUrl: string, projectName: string, env: NodeJS.ProcessEnv): Promise<string> {
  const inspected = await vercel(["inspect", deploymentUrl, "--wait", "--timeout", "10m", "--json"], env);
  const value = parseJsonOutput(inspected.stdout) as Record<string, unknown>;
  const aliases = Array.isArray(value.aliases) ? value.aliases.filter((alias): alias is string => typeof alias === "string") : [];
  const preferred = aliases.find((alias) => alias === `${projectName}.vercel.app`) ?? aliases[0];
  return preferred ? `https://${preferred.replace(/^https?:\/\//, "")}` : deploymentUrl;
}

export function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  try { return JSON.parse(trimmed); } catch {}
  const starts = [...trimmed.matchAll(/(?:^|\n)\s*(?=[{[])/g)]
    .map((match) => (match.index ?? 0) + match[0].length);
  for (const start of starts.reverse()) {
    try { return JSON.parse(trimmed.slice(start).trim()); } catch {}
  }
  throw new Error(`Expected JSON output, received: ${trimmed.slice(0, 500)}`);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function unlock(origin: string, setupCode: string): Promise<string> {
  const response = await fetch(`${origin}/api/setup/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ setupCode }),
  });
  if (!response.ok) throw new Error(`Setup unlock failed (${response.status}): ${await response.text()}`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Setup unlock did not issue a session cookie");
  return cookie;
}

async function connectJson(origin: string, service: string, method: string, body: unknown, cookie: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${origin}/rpc/openbot.v1.${service}/${method}`, {
    method: "POST",
    headers: {
      "connect-protocol-version": "1",
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${service}.${method} failed (${response.status}): ${await response.text()}`);
  return await response.json() as Record<string, unknown>;
}

async function configureInstallation(origin: string, setupCode: string, configuration: Record<string, string>): Promise<void> {
  const cookie = await unlock(origin, setupCode);
  await connectJson(origin, "InstallationService", "Configure", configuration, cookie);
}

async function provisionSnapshot(credentials: { token: string; projectId: string; teamId: string }): Promise<string> {
  const bundle = await readFile(resolve("apps/box-host/dist/index.js"));
  const sandbox = await Sandbox.create({
    ...credentials,
    image:
      process.env.OPENBOT_VERCEL_SANDBOX_IMAGE ||
      "vercel/sandbox/universal:latest",
    ports: [6080, 4101],
    timeout: 30 * 60 * 1000,
  });
  let snapshotted = false;
  try {
    await sandbox.writeFiles([
      { path: "/opt/openbot/bootstrap-openbot-desktop", content: desktopBootstrapScript, mode: 0o755 },
      { path: "/opt/openbot/start-openbot-desktop", content: desktopStartScript, mode: 0o755 },
      { path: "/opt/openbot/box-host.mjs", content: bundle, mode: 0o755 },
    ]);
    const bootstrap = await sandbox.runCommand({
      cmd: "bash",
      args: ["/opt/openbot/bootstrap-openbot-desktop"],
      sudo: true,
      timeoutMs: 20 * 60 * 1000,
    });
    if (bootstrap.exitCode !== 0) {
      const stdout = (await bootstrap.stdout()).trim();
      const stderr = (await bootstrap.stderr()).trim();
      throw new Error(
        `Vercel desktop bootstrap failed (${bootstrap.exitCode}): ${[stdout, stderr].filter(Boolean).join("\n").slice(-12_000)}`,
      );
    }
    const snapshot = await sandbox.snapshot();
    snapshotted = true;
    return snapshot.snapshotId;
  } finally {
    if (!snapshotted) await sandbox.stop().catch(() => undefined);
  }
}

async function productionSmoke(origin: string, setupCode: string): Promise<void> {
  const health = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(30_000) });
  if (!health.ok) throw new Error(`Health smoke failed (${health.status})`);
  const cookie = await unlock(origin, setupCode);
  await connectJson(origin, "InstallationService", "GetStatus", {}, cookie);

  const chat = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ messages: [{ id: "deploy-smoke", role: "user", parts: [{ type: "text", text: "Reply with exactly: openbot-ok" }] }] }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!chat.ok) throw new Error(`Tilde ChatKit smoke failed (${chat.status}): ${await chat.text()}`);
  const chatBody = await chat.json() as { sessionId?: unknown; messages?: unknown[] };
  if (typeof chatBody.sessionId !== "string" || !chatBody.messages?.length) throw new Error("Tilde ChatKit smoke returned no session or messages");

  const created = await connectJson(origin, "SandboxService", "CreateSandbox", {}, cookie);
  const sandboxId = stringValue(created.id);
  if (!sandboxId) throw new Error("Sandbox smoke did not return an ID");
  try {
    let action: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      action = await connectJson(origin, "SandboxService", "Exec", {
        command: "bash",
        arguments: [
          "-lc",
          "DISPLAY=:1 cua-driver call --socket /tmp/openbot-cua-driver.sock start_session '{\"session\":\"openbot-deploy-smoke\",\"capture_scope\":\"desktop\"}' >/dev/null && cua_result=$(DISPLAY=:1 cua-driver call --socket /tmp/openbot-cua-driver.sock click '{\"scope\":\"desktop\",\"x\":80,\"y\":80,\"session\":\"openbot-deploy-smoke\"}') && printf '%s\\n' \"$cua_result\" && printf '%s' \"$cua_result\" | jq -e '.route == \"global_input\"' >/dev/null && printf '\\nopenbot-cua-ok\\n'",
        ],
      }, cookie);
      if ((action.exitCode ?? 0) === 0 && String(action.stdout ?? "").includes("openbot-cua-ok")) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    }
    if (!action || (action.exitCode ?? 0) !== 0 || !String(action.stdout ?? "").includes("openbot-cua-ok")) {
      throw new Error(`Cua Driver action smoke failed: ${JSON.stringify(action)}`);
    }
    const desktop = await connectJson(origin, "SandboxService", "GetDesktop", {}, cookie);
    if (typeof desktop.url !== "string") throw new Error("Desktop smoke did not return a URL");
    const noVnc = await fetch(desktop.url, { signal: AbortSignal.timeout(30_000) });
    if (!noVnc.ok || !(await noVnc.text()).toLowerCase().includes("novnc")) throw new Error(`noVNC smoke failed (${noVnc.status})`);
  } finally {
    await connectJson(origin, "SandboxService", "StopSandbox", {}, cookie).catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    const knownSecrets = Object.entries(process.env)
      .filter(([name, value]) => Boolean(value) && /(?:TOKEN|SECRET|KEY|SETUP_CODE|PASSWORD)/.test(name))
      .map(([, value]) => value!);
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error), knownSecrets)}\n`);
    process.exitCode = 1;
  });
}
