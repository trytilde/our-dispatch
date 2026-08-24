import {
  createClientAuthAdapter,
  createOpenBotClient,
  createOpenBotRuntime,
  type AgentSetupState,
  type ClientAuthAdapter,
} from "@tryopenbot/client-runtime";

const client = createOpenBotClient();

const auth: ClientAuthAdapter = window.openbotDesktop
  ? {
      getSession: () => window.openbotDesktop!.authStatus(),
      signIn: () => window.openbotDesktop!.signIn(),
      signOut: () => window.openbotDesktop!.signOut(),
    }
  : createClientAuthAdapter(client, {
      async signIn() {
        window.location.assign("/auth/login");
      },
    });

const agentSetupStorageKey = "openbot:agent-setup";

const agentSetupPersistence = {
  load(): AgentSetupState | null {
    try {
      const value = JSON.parse(
        sessionStorage.getItem(agentSetupStorageKey) ?? "null",
      ) as Partial<AgentSetupState> | null;
      if (
        value?.status !== "setting_up" ||
        typeof value.jobId !== "string" ||
        typeof value.agent?.id !== "string" ||
        typeof value.agent.name !== "string"
      )
        return null;
      return {
        status: "setting_up",
        jobId: value.jobId,
        agent: value.agent,
        avatarId: typeof value.avatarId === "string" ? value.avatarId : "",
        error: "",
      };
    } catch {
      return null;
    }
  },
  save(state: AgentSetupState | null): void {
    if (state) sessionStorage.setItem(agentSetupStorageKey, JSON.stringify(state));
    else sessionStorage.removeItem(agentSetupStorageKey);
  },
};

export const openBotRuntime = createOpenBotRuntime({ client, auth, agentSetupPersistence });
