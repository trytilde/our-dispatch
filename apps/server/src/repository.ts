import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { repositoryDigest, validateConfig, type OpenBotConfig } from "@openbot/config";
import type { ProviderPlugin, SandboxAsset, SkillRegistration } from "@openbot/provider-sdk";
import {
  repositoryAgentPaths,
  repositoryAgents,
  repositoryConfig,
  repositoryFilePaths,
  repositoryProviderPaths,
  repositoryProviderPlugins,
} from "./generated/repository.js";

export interface LoadedRepository {
  root: string;
  config: OpenBotConfig;
  digest: string;
  agents: readonly RepositoryAgent[];
  providerPlugins: readonly ProviderPlugin[];
  skills: readonly SkillRegistration[];
  sandbox: {
    assets: readonly SandboxAsset[];
    bootstrap?: string;
    secrets: Readonly<Record<string, string>>;
  };
}

export interface RepositoryAgentModule {
  POST(request: Request): Promise<Response> | Response;
  displayName?: string;
  description?: string;
  registration?: { provider?: string; streaming?: boolean; timeoutMs?: number };
}

export interface RepositoryAgent extends RepositoryAgentModule {
  id: string;
  displayName: string;
}

let loaded: Promise<LoadedRepository> | undefined;

export function loadRepository(): Promise<LoadedRepository> {
  const bundledRepositoryRoot = new URL("../../..", import.meta.url).pathname;
  loaded ??= loadRepositoryAt(resolve(process.env.OPENBOT_REPOSITORY_ROOT ?? bundledRepositoryRoot));
  return loaded;
}

export async function loadRepositoryAt(root: string): Promise<LoadedRepository> {
  const configErrors = validateConfig(repositoryConfig);
  if (configErrors.length) throw new Error(configErrors.join("\n"));
  const agents = loadAgents(repositoryAgents, repositoryAgentPaths);
  validateProviderPlugins(repositoryProviderPlugins, repositoryProviderPaths);
  const fileContents: Record<string, string> = {};
  for (const path of repositoryFilePaths) {
    const content = await readFile(resolveInside(root, path));
    fileContents[path] = content.toString("base64");
  }
  return {
    root,
    config: repositoryConfig,
    digest: repositoryDigest(fileContents),
    agents,
    providerPlugins: repositoryProviderPlugins,
    skills: await loadSkills(root, repositoryConfig.skills.directory),
    sandbox: await loadSandbox(root, repositoryConfig),
  };
}

function loadAgents(modules: readonly RepositoryAgentModule[], paths: readonly string[]): RepositoryAgent[] {
  const ids = new Set<string>();
  const agents = modules.map((module, index) => {
    const id = basename(paths[index] ?? "").replace(/\.[^.]+$/, "");
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) throw new Error(`Invalid agent filename: ${paths[index]}`);
    if (typeof module.POST !== "function") throw new Error(`Agent ${id} must export a POST(request) endpoint`);
    if (ids.has(id)) throw new Error(`Duplicate agent id: ${id}`);
    ids.add(id);
    const displayName = module.displayName?.trim() || id.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
    return { ...module, id, displayName };
  });
  if (!agents.length) throw new Error("At least one configuration/agents/<id>.ts endpoint is required");
  return agents;
}

function validateProviderPlugins(plugins: readonly ProviderPlugin[], paths: readonly string[]): void {
  const pluginIds = new Set<string>();
  const providerIds = new Set<string>();
  for (const [index, plugin] of plugins.entries()) {
    const expected = basename(dirname(paths[index] ?? ""));
    if (!plugin.id || plugin.id !== expected) throw new Error(`Provider plugin id ${plugin.id || "<empty>"} must match directory ${expected}`);
    if (pluginIds.has(plugin.id)) throw new Error(`Duplicate provider plugin id: ${plugin.id}`);
    pluginIds.add(plugin.id);
    for (const registration of plugin.registrations) {
      const key = `${registration.kind}:${registration.id}`;
      if (providerIds.has(key)) throw new Error(`Duplicate custom provider registration: ${key}`);
      providerIds.add(key);
    }
  }
}

async function loadSkills(root: string, directory: string): Promise<SkillRegistration[]> {
  const prefix = `${directory.replace(/\/$/, "")}/`;
  const paths = repositoryFilePaths.filter((path) => path.startsWith(prefix) && path.endsWith("/SKILL.md"));
  const skills: SkillRegistration[] = [];
  const names = new Set<string>();
  for (const sourcePath of paths) {
    const content = await readFile(resolveInside(root, sourcePath), "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
    if (!match) throw new Error(`Skill is missing YAML frontmatter: ${sourcePath}`);
    const metadata = parseYaml(match[1] ?? "") as { name?: unknown; description?: unknown };
    if (typeof metadata.name !== "string" || !/^[a-z0-9-]+$/.test(metadata.name)) throw new Error(`Skill has an invalid name: ${sourcePath}`);
    if (typeof metadata.description !== "string" || !metadata.description.trim()) throw new Error(`Skill has no description: ${sourcePath}`);
    if (names.has(metadata.name)) throw new Error(`Duplicate skill name: ${metadata.name}`);
    names.add(metadata.name);
    skills.push({
      name: metadata.name,
      description: metadata.description.trim(),
      content,
      sourcePath,
      digest: repositoryDigest({ [sourcePath]: content }),
    });
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function loadSandbox(root: string, config: OpenBotConfig): Promise<LoadedRepository["sandbox"]> {
  const assetPrefix = `${config.sandbox.assetsDirectory.replace(/\/$/, "")}/`;
  const assets: SandboxAsset[] = [];
  for (const sourcePath of repositoryFilePaths.filter((path) => path.startsWith(assetPrefix) && basename(path) !== ".gitkeep")) {
    const stat = await lstat(resolveInside(root, sourcePath));
    if (!stat.isFile()) throw new Error(`Sandbox asset is not a regular file: ${sourcePath}`);
    assets.push({
      path: sourcePath.slice(assetPrefix.length),
      contentBase64: (await readFile(resolveInside(root, sourcePath))).toString("base64"),
      executable: (stat.mode & 0o111) !== 0,
    });
  }
  const bootstrap = await optionalText(root, config.sandbox.bootstrap);
  const declared = parseSecretManifest(await optionalText(root, config.sandbox.secretsManifest));
  const localValues = parseLocalSecrets(await optionalText(root, join(dirname(config.sandbox.secretsManifest), "secrets.yaml")));
  const secrets: Record<string, string> = {};
  for (const name of declared) {
    const value = process.env[`OPENBOT_SANDBOX_SECRET_${name}`] ?? localValues[name];
    if (value !== undefined) secrets[name] = value;
  }
  return { assets, ...(bootstrap ? { bootstrap } : {}), secrets };
}

function parseSecretManifest(content: string | undefined): string[] {
  if (!content) return [];
  const value = parseYaml(content) as { secrets?: unknown };
  if (!value?.secrets || typeof value.secrets !== "object" || Array.isArray(value.secrets)) return [];
  const names = Object.keys(value.secrets);
  for (const name of names) if (!/^[A-Z][A-Z0-9_]{0,126}$/.test(name)) throw new Error(`Invalid sandbox secret name: ${name}`);
  return names.sort();
}

function parseLocalSecrets(content: string | undefined): Record<string, string> {
  if (!content) return {};
  const value = parseYaml(content) as { secrets?: unknown };
  if (!value?.secrets || typeof value.secrets !== "object" || Array.isArray(value.secrets)) return {};
  return Object.fromEntries(Object.entries(value.secrets).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

async function optionalText(root: string, path: string): Promise<string | undefined> {
  try { return await readFile(resolveInside(root, path), "utf8"); } catch { return undefined; }
}

function resolveInside(root: string, path: string): string {
  const resolved = resolve(root, path);
  const prefix = `${resolve(root)}${sep}`;
  if (resolved !== resolve(root) && !resolved.startsWith(prefix)) throw new Error(`Path escapes repository: ${path}`);
  return resolved;
}
