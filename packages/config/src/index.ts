import { createHash } from "node:crypto";
import type { ProviderPlugin } from "@openbot/provider-sdk";

export interface OpenBotConfig {
  providers: {
    directory: string;
    ai: string;
    agents: string;
    chat: string;
    skills: string;
    sandbox: string;
    environment: string;
    sourceControl: string;
    deployment: string;
    options?: Readonly<Record<string, unknown>>;
  };
  skills: { directory: string; registryName: string; registryDescription?: string };
  agents: { directory: string; routePrefix: string };
  sandbox: { assetsDirectory: string; bootstrap: string; secretsManifest: string };
  publishing: { mode: "pull-request"; deploymentBranch: string };
}

export interface RepositoryManifest {
  config: OpenBotConfig;
  providerPlugins: readonly ProviderPlugin[];
  files: Readonly<Record<string, string>>;
  digest: string;
}

export function defineConfig(config: OpenBotConfig): OpenBotConfig {
  return config;
}

export function repositoryDigest(files: Readonly<Record<string, string>>): string {
  const hash = createHash("sha256");
  for (const [path, content] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(path).update("\0").update(content).update("\0");
  }
  return hash.digest("hex");
}

export function validateConfig(config: OpenBotConfig): string[] {
  const errors: string[] = [];
  const paths = [config.providers.directory, config.skills.directory, config.agents.directory, config.sandbox.assetsDirectory, config.sandbox.bootstrap, config.sandbox.secretsManifest];
  for (const path of paths) {
    if (!path || path.startsWith("/") || path.split(/[\\/]/).includes("..")) errors.push(`Configuration path must stay inside the repository: ${path}`);
  }
  if (!config.agents.routePrefix.startsWith("/api/") || config.agents.routePrefix.endsWith("/")) {
    errors.push("agents.routePrefix must start with /api/ and must not end with /");
  }
  if (!/^[a-zA-Z0-9._ -]+$/.test(config.skills.registryName)) errors.push("skills.registryName contains unsupported characters");
  const serialized = JSON.stringify(config);
  if (/(api[_-]?key|token|password|secret)["']?\s*:/i.test(serialized)) errors.push("Configuration must not contain secret-shaped keys");
  return errors;
}
