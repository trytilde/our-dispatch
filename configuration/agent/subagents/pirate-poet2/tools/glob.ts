import { createGlobTool } from "@tryopenbot/computer-tools";

// An agent-specific computer overrides the shared computer, e.g. the factory agent's
// trusted development sandbox.
const baseUrl = () =>
  process.env.AGENT_PIRATE_POET2_COMPUTER_SERVICE_URL ?? process.env.COMPUTER_SERVICE_URL!;

export default createGlobTool({ agentId: "pirate-poet2", baseUrl });
