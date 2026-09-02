import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { DeploymentContext, DeploymentResult } from "@tryopenbot/runtime-provider";
import type { TildePlatform } from "./index.js";

const execute = promisify(execFile);
type HostedService = "control" | "agents";
interface ReleaseFile {
  path: string;
  sha1: string;
  size: number;
  mode: number;
  absolutePath: string;
}
interface HostedRelease {
  id: string;
  status: "uploading" | "deploying" | "ready" | "failed";
  deployment_url?: string | null;
  error_message?: string | null;
}

/** Deploy a prebuilt OpenBot service through its instance-scoped Tilde release capability. */
export async function deployHostedOpenBotRelease(
  platform: TildePlatform,
  context: DeploymentContext,
  service: HostedService,
  artifactRoot: string,
): Promise<DeploymentResult> {
  const instanceId = required(context.environment, "OPENBOT_HOSTED_INSTANCE_ID");
  const files = await deploymentFiles(artifactRoot);
  if (!files.length) throw new Error(`Hosted OpenBot ${service} artifact is empty`);
  await configureInstance(platform, context, instanceId);
  let release = await requestJson<HostedRelease>(platform, instanceId, "/releases", {
    method: "POST",
    body: JSON.stringify({
      service,
      source_revision: (
        await execute("git", ["rev-parse", "HEAD"], { cwd: context.repositoryRoot })
      ).stdout.trim(),
      files: files.map(({ path, sha1, size, mode }) => ({ path, sha1, size, mode })),
    }),
  });
  const byDigest = new Map(files.map((file) => [file.sha1, file]));
  for (const file of byDigest.values()) {
    const response = await request(
      platform,
      instanceId,
      `/releases/${release.id}/files/${file.sha1}`,
      {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: await readFile(file.absolutePath),
      },
    );
    if (!response.ok)
      throw new Error(
        `Hosted OpenBot file upload failed (${response.status}): ${await response.text()}`,
      );
  }
  release = await requestJson(platform, instanceId, `/releases/${release.id}/finalize`, {
    method: "POST",
  });
  const deadline = Date.now() + 10 * 60_000;
  while (release.status === "deploying" && Date.now() < deadline) {
    await delay(2_000);
    release = await requestJson(platform, instanceId, `/releases/${release.id}`, { method: "GET" });
  }
  if (release.status !== "ready" || !release.deployment_url)
    throw new Error(
      release.error_message || `Hosted OpenBot ${service} release did not become ready`,
    );
  const output =
    service === "control" ? "control-service.deployment-url" : "agent-service.deployment-url";
  return { outputs: { [output]: release.deployment_url, "hosted-openbot.release-id": release.id } };
}

async function configureInstance(
  platform: TildePlatform,
  context: DeploymentContext,
  instanceId: string,
) {
  const environment = Object.fromEntries(
    Object.entries(context.configuration ?? {}).filter(
      ([name, value]) => value !== undefined && allowedRuntimeName(name),
    ),
  );
  await requestJson(platform, instanceId, "/configuration", {
    method: "PUT",
    body: JSON.stringify({ environment }),
  });
}

function allowedRuntimeName(name: string): boolean {
  return /^(?:TILDE_(?:API_KEY|ORG_ID|TEAM_ID|BASE_URL)|OPENBOT_(?:DEPLOYMENT_NAME|HOSTED_INSTANCE_ID|HOSTED_INFERENCE_BILLING|OIDC_[A-Z_]+)|COMPUTER_(?:SERVICE_API_KEY|SERVICE_URL|ID)|PUBLIC_ORIGIN|AGENT_SERVICE_ORIGIN|INFERENCE_PROVIDER|AI_MODEL|AGENT_[A-Z0-9_]+)$/.test(
    name,
  );
}

async function deploymentFiles(root: string): Promise<ReleaseFile[]> {
  const paths = await walk(resolve(root, ".vercel/output"));
  return Promise.all(
    paths.map(async (absolutePath) => {
      const [content, metadata] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
      return {
        path: relative(root, absolutePath).replaceAll("\\", "/"),
        sha1: createHash("sha1").update(content).digest("hex"),
        size: content.length,
        mode: metadata.mode & 0o111 ? 0o100755 : 0o100644,
        absolutePath,
      };
    }),
  );
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? walk(path) : Promise.resolve(entry.isFile() ? [path] : []);
      }),
    )
  ).flat();
}

async function requestJson<T>(
  platform: TildePlatform,
  instanceId: string,
  suffix: string,
  init: RequestInit,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const response = await request(platform, instanceId, suffix, {
    ...init,
    headers,
  });
  if (!response.ok)
    throw new Error(
      `Hosted OpenBot release API failed (${response.status}): ${await response.text()}`,
    );
  return (await response.json()) as T;
}

function request(
  platform: TildePlatform,
  instanceId: string,
  suffix: string,
  init: RequestInit,
): Promise<Response> {
  const connection = platform.connection();
  const headers = new Headers(init.headers);
  headers.set("x-api-key", connection.apiKey);
  return fetch(
    `${connection.baseUrl.replace(/\/$/, "")}/api/v1/team/${encodeURIComponent(connection.teamId)}/identity/openbot/instances/${encodeURIComponent(instanceId)}${suffix}`,
    {
      ...init,
      headers,
    },
  );
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for Tilde-hosted OpenBot deployment`);
  return value;
}
