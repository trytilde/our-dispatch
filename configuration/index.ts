import { TildeAgentProvider } from "@tryopenbot/agent-provider";
import { ExeDevRuntimeServiceProvider } from "@tryopenbot/agent-service-provider";
import { TildeAuthProvider } from "@tryopenbot/auth-provider";
import { Configuration } from "@tryopenbot/configuration";
import { ExeDevComputerProvider } from "@tryopenbot/computer-service-provider";
import { CodeStorageGitProvider } from "@tryopenbot/git-provider";
import { ResourceAccessMode } from "@trytilde/sdk/api";
import { VercelInferenceProvider } from "@tryopenbot/inference-provider";
import { ExeDevPlatform, TildePlatform, VercelPlatform } from "@tryopenbot/platform-integrations";

const tilde = new TildePlatform({
  apiKey: process.env.TILDE_API_KEY!,
  baseUrl: process.env.TILDE_BASE_URL ?? "https://api.trytilde.ai",
  orgId: process.env.TILDE_ORG_ID!,
  teamId: process.env.TILDE_TEAM_ID!,
});
const vercel = new VercelPlatform();
const exe = new ExeDevPlatform();
const runtime = new ExeDevRuntimeServiceProvider({ platform: exe });

export default Configuration({
  providers: {
    auth: new TildeAuthProvider(tilde),
    controlService: runtime,
    agentService: runtime,
    agent: new TildeAgentProvider(tilde, {
      resourcePolicy: ({ id }) => ({
        authorization: {
          ownership: ResourceAccessMode.TEAM,
          visibility: ResourceAccessMode.TEAM,
        },
        ...(id === "computer"
          ? {
              enableExternalTools: false,
              enableMcpServer: false,
              enableSkillRegistry: false,
              enableTildeControlPlane: false,
            }
          : {}),
        permissions: {
          delegate_to_other_agents:
            id === "computer" ? { mode: "none" } : { mode: "only", ids: ["computer"] },
          create_multiplayer_sessions: {
            with_agents: { mode: "none" },
            with_users: { mode: "none" },
          },
        },
      }),
    }),
    computer: new ExeDevComputerProvider({ platform: exe }),
    inference: new VercelInferenceProvider(vercel),
    git: new CodeStorageGitProvider(),
  },
});
