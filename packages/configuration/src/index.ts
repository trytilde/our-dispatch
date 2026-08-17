import { createHash } from "node:crypto";
import type { AgentProvider } from "@tryopenbot/agent-provider";
import type { AuthProvider } from "@tryopenbot/auth-provider";
import type { AgentServiceProvider } from "@tryopenbot/agent-service-provider";
import type { ComputerProvider } from "@tryopenbot/computer-provider";
import type { ControlServiceProvider } from "@tryopenbot/control-service-provider";
import type { InferenceProvider } from "@tryopenbot/inference-provider";

export interface ProviderPluginManifest {
  readonly id: string;
  readonly registrations: readonly unknown[];
}

export interface OpenBotProviders {
  auth: AuthProvider;
  controlService: ControlServiceProvider;
  agentService: AgentServiceProvider;
  agent: AgentProvider;
  computer: ComputerProvider;
  inference?: InferenceProvider;
}

export interface OpenBotConfiguration {
  providers: OpenBotProviders;
}

export type SopsOwnerIdentityConfiguration =
  | { kind: "onepassword"; reference: string }
  | { kind: "native-keychain"; platform: "darwin" | "linux" }
  | { kind: "aws-profile"; profile?: string }
  | { kind: "gcp-kms" }
  | { kind: "azure-key-vault" }
  | { kind: "vault-transit" };

/** User-local OpenBot settings. Stored at ~/.openbot/config.json, never in a fork. */
export interface UserConfiguration {
  version: 1;
  sops?: {
    ownerIdentity?: SopsOwnerIdentityConfiguration;
  };
}

export interface RepositoryManifest {
  configuration: OpenBotConfiguration;
  providerPlugins: readonly ProviderPluginManifest[];
  files: Readonly<Record<string, string>>;
  digest: string;
}

export function Configuration(configuration: OpenBotConfiguration): OpenBotConfiguration {
  return configuration;
}

export function repositoryDigest(files: Readonly<Record<string, string>>): string {
  const hash = createHash("sha256");
  for (const [path, content] of Object.entries(files).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    hash.update(path).update("\0").update(content).update("\0");
  }
  return hash.digest("hex");
}
