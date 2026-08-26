import { createCopyFromComputerTool, type MediaUploader } from "@tryopenbot/computer-tools";

// An agent-specific computer overrides the shared computer, e.g. the factory agent's
// trusted development sandbox.
const baseUrl = () =>
  process.env.AGENT_TASSA2_COMPUTER_SERVICE_URL ?? process.env.COMPUTER_SERVICE_URL!;

export default function copyFromComputer(uploadMedia: MediaUploader) {
  return createCopyFromComputerTool({ agentId: "tassa2", baseUrl, uploadMedia });
}
