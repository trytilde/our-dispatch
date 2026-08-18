import { createScreenshotTool } from "@tryopenbot/computer-tools";

// An agent-specific computer overrides the shared computer, e.g. the factory agent's
// trusted development sandbox.
const baseUrl = () =>
  process.env.AGENT_FACTORY_COMPUTER_SERVICE_URL ?? process.env.COMPUTER_SERVICE_URL!;

export default createScreenshotTool({ agentId: "factory", baseUrl });
