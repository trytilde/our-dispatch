import type { Platform, ProviderInitialization } from "@tryopenbot/runtime-provider";
import { createClient, type Client } from "@trytilde/sdk";
import { tildeFetch } from "./fetch.js";

export interface TildePlatformConfig {
  apiKey: string;
  orgId: string;
  teamId: string;
  baseUrl?: string;
}

const initialization: ProviderInitialization = {
  id: "tilde",
  label: "Tilde",
  description: "Connect OpenBot to one Tilde organization and team.",
  questions: [
    {
      id: "tilde-api-key",
      prompt: "Tilde API key",
      description: "API key used by OpenBot services to access the selected Tilde team.",
      input: "secret",
      required: true,
      destination: { kind: "secret", key: "TILDE_API_KEY" },
    },
    {
      id: "tilde-org-id",
      prompt: "Tilde organization ID",
      description: "Organization that owns this OpenBot installation's Tilde resources.",
      input: "text",
      required: true,
      destination: { kind: "environment", key: "TILDE_ORG_ID" },
    },
    {
      id: "tilde-team-id",
      prompt: "Tilde team ID",
      description: "Team that owns this OpenBot installation's agents, chats, tools, and skills.",
      input: "text",
      required: true,
      destination: { kind: "environment", key: "TILDE_TEAM_ID" },
    },
    {
      id: "openbot-deployment-name",
      prompt: "OpenBot deployment name",
      description: "Name shown to members of the selected Tilde team.",
      defaultValue: "OpenBot",
      input: "text",
      required: true,
      destination: { kind: "environment", key: "OPENBOT_DEPLOYMENT_NAME" },
    },
    {
      id: "tilde-base-url",
      prompt: "Tilde API base URL",
      description: "Optional alternate Tilde API origin.",
      defaultValue: "https://api.trytilde.ai",
      input: "text",
      destination: { kind: "environment", key: "TILDE_BASE_URL" },
    },
  ],
};

/** Tilde account and team shared by Tilde-backed domain providers. */
export class TildePlatform implements Platform {
  readonly id = "tilde";
  readonly initialization = initialization;
  readonly #config: TildePlatformConfig | undefined;
  #client: Client | undefined;

  constructor(config?: TildePlatformConfig) {
    this.#config = config;
  }

  connection(): TildePlatformConfig & { baseUrl: string } {
    if (!this.#config)
      throw new Error("TildePlatform connection is unavailable during initialization discovery");
    return {
      ...this.#config,
      baseUrl: this.#config.baseUrl ?? "https://api.trytilde.ai",
    };
  }

  client(signal?: AbortSignal): Client {
    const config = this.connection();
    const clientConfig = tildeClientConfig(config, signal);
    if (signal) return createClient(clientConfig);
    return (this.#client ??= createClient(clientConfig));
  }
}

/** Headers for the installation's single API-key credential. */
export function tildeAuthenticationHeaders(config: TildePlatformConfig): Headers {
  return new Headers({ "x-api-key": config.apiKey });
}

function tildeClientConfig(
  config: TildePlatformConfig & { baseUrl: string },
  signal?: AbortSignal,
) {
  const connection = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    orgId: config.orgId,
    teamId: config.teamId,
  };
  return {
    ...connection,
    orgSubdomain: false,
    headers: tildeAuthenticationHeaders(config),
    ...(signal ? { fetch: tildeFetch(signal) } : {}),
  };
}

export const tildePlatform = new TildePlatform();
