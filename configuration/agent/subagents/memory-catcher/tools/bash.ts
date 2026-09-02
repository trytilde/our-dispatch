import { createBashTool } from "@tryopenbot/computer-tools";

// An agent-specific computer overrides the shared computer, e.g. the factory agent's
// trusted development sandbox.
const baseUrl = () =>
  process.env.AGENT_MEMORY_CATCHER_COMPUTER_SERVICE_URL ?? process.env.COMPUTER_SERVICE_URL!;

export default createBashTool({ agentId: "memory-catcher", baseUrl });
