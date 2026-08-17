import type { Platform, ProviderInitialization } from "@tryopenbot/runtime-provider";
import { createVercelAiGatewayApiKey, type VercelAiGatewayApiKey } from "./ai-gateway.js";

export interface VercelPlatformConfig {
  request?: typeof fetch;
}

const initialization: ProviderInitialization = {
  id: "vercel",
  label: "Vercel",
  description: "Connect OpenBot's selected services and computer runtime to one Vercel account.",
  questions: [
    {
      id: "vercel-token",
      prompt: "Vercel token",
      description:
        "Vercel personal or team access token used to create projects, configure deployment variables, publish services, and access Vercel Container Registry.",
      input: "secret",
      required: true,
      destination: { kind: "secret", key: "VERCEL_TOKEN" },
    },
    {
      id: "vercel-team-id",
      prompt: "Vercel team ID (leave blank for your personal account)",
      description: "Optional Vercel team scope shared by all OpenBot Vercel resources.",
      input: "text",
      destination: { kind: "environment", key: "VERCEL_TEAM_ID" },
    },
  ],
};

/** Vercel account scope shared by Vercel-backed domain providers. */
export class VercelPlatform implements Platform {
  readonly id = "vercel";
  readonly initialization = initialization;

  constructor(private readonly config: VercelPlatformConfig = {}) {}

  createAiGatewayApiKey(options: {
    token?: string;
    teamId?: string;
    name: string;
    request?: typeof fetch;
  }): Promise<VercelAiGatewayApiKey> {
    return createVercelAiGatewayApiKey({
      ...options,
      request: options.request ?? this.config.request,
    });
  }
}

export const vercelPlatform = new VercelPlatform();
