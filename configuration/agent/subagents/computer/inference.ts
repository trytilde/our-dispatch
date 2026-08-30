import { stepCountIs } from "ai";
import type { ToolSet } from "@ai-sdk/provider-utils";

export async function prepareInference(tools: ToolSet, _abortSignal?: AbortSignal) {
  return {
    model: "zai/glm-5.3-flash",
    reasoning: "low" as const,
    // Leave room for substantial tool work while bounding faulty or cyclic runs.
    stopWhen: stepCountIs(50),
    tools,
  };
}
