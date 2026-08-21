import { stepCountIs } from "ai";
import type { ToolSet } from "@ai-sdk/provider-utils";

export async function prepareInference(tools: ToolSet, _abortSignal?: AbortSignal) {
  return {
    model: process.env.AI_MODEL ?? "openai/gpt-5.6-sol",
    reasoning: "medium" as const,
    // Connector configuration chains discovery and control-plane mutations.
    stopWhen: stepCountIs(24),
    tools,
  };
}
