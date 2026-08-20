import { createScreenshotTool, type MediaUploader } from "@tryopenbot/computer-tools";

// An agent-specific computer overrides the shared computer, e.g. the factory agent's
// trusted development sandbox.
const baseUrl = () =>
  process.env.AGENT_FACTORY_COMPUTER_SERVICE_URL ?? process.env.COMPUTER_SERVICE_URL!;

/**
 * Screenshots are uploaded as ChatKit attachments, and every attachment route is session-scoped,
 * so this tool is built per turn with that turn's uploader rather than once at module load.
 */
export default function screenshot(uploadMedia: MediaUploader) {
  return createScreenshotTool({ agentId: "factory", baseUrl, uploadMedia });
}
