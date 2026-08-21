import { fileURLToPath } from "node:url";
import { VercelPlatform } from "@tryopenbot/platform-integrations";
import type {
  ProviderInitialization,
  ProviderInitializationContext,
} from "@tryopenbot/runtime-provider";
import type { InferenceProvider } from "./core.js";

const AI_GATEWAY_API_KEY = "AI_GATEWAY_API_KEY";
const AI_GATEWAY_KEY_NAME = "VERCEL_AI_GATEWAY_API_KEY_NAME";
const AI_MODEL = "AI_MODEL";
const INFERENCE_PROVIDER = "INFERENCE_PROVIDER";

export const VERCEL_INFERENCE_PROVIDER = "vercel-ai-gateway";
export const DEFAULT_VERCEL_MODEL = "openai/gpt-5.6-sol";

export const vercelInferenceProviderInitialization: ProviderInitialization = {
  id: "vercel-ai-gateway-inference",
  label: "Vercel AI Gateway",
  description: "Provision the AI Gateway credential used by authored OpenBot agents.",
  questions: [
    {
      id: "vercel-ai-gateway-api-key-name",
      prompt: "Vercel AI Gateway API key name",
      description: "Human-readable label for the API key created for this OpenBot installation.",
      input: "text",
      required: true,
      destination: { kind: "environment", key: AI_GATEWAY_KEY_NAME },
    },
  ],
};

export class VercelInferenceProvider implements InferenceProvider {
  readonly initialization = vercelInferenceProviderInitialization;
  readonly agentTemplate = {
    files: [
      {
        path: "inference.ts.hbs",
        source: fileURLToPath(new URL("./vercel/assets/inference.ts.hbs", import.meta.url)),
      },
    ],
  } as const;
  readonly platforms;

  constructor(private readonly platform = new VercelPlatform()) {
    this.platforms = [platform];
  }

  async initialize(context: ProviderInitializationContext): Promise<void> {
    await context.setEnvironment(
      INFERENCE_PROVIDER,
      VERCEL_INFERENCE_PROVIDER,
      "Inference implementation used by authored agents.",
    );
    if (!context.environment[AI_MODEL]?.trim())
      await context.setEnvironment(
        AI_MODEL,
        DEFAULT_VERCEL_MODEL,
        "Default Vercel AI Gateway model used by authored agents.",
      );
    if (context.environment[AI_GATEWAY_API_KEY]?.trim()) return;
    const name = context.environment[AI_GATEWAY_KEY_NAME]?.trim();
    if (!name) throw new Error(`${AI_GATEWAY_KEY_NAME} is required`);
    const created = await this.platform.createAiGatewayApiKey({
      token: context.environment.VERCEL_TOKEN,
      teamId: context.environment.VERCEL_TEAM_ID,
      name,
      request: context.request,
    });
    await context.setSecret(
      AI_GATEWAY_API_KEY,
      created.value,
      "Vercel AI Gateway API key used by authored agents.",
    );
  }
}
