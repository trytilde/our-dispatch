import { VercelPlatform } from "@tryopenbot/platform-integrations";
import type {
  ProviderInitialization,
  ProviderInitializationContext,
} from "@tryopenbot/runtime-provider";
import type { InferenceProvider } from "./core.js";

const AI_GATEWAY_API_KEY = "AI_GATEWAY_API_KEY";
const AI_GATEWAY_KEY_NAME = "VERCEL_AI_GATEWAY_API_KEY_NAME";

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
  readonly platforms;

  constructor(private readonly platform = new VercelPlatform()) {
    this.platforms = [platform];
  }

  async initialize(context: ProviderInitializationContext): Promise<void> {
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
