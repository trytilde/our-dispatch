import { z } from "zod";

export const CreatedAgentSchema = z.object({ id: z.string(), name: z.string() });
export type CreatedAgent = z.infer<typeof CreatedAgentSchema>;

export const AgentSetupStartedSchema = z.object({
  status: z.literal("setting_up"),
  job_id: z.string().uuid(),
  agent: CreatedAgentSchema,
});
export type AgentSetupStarted = z.infer<typeof AgentSetupStartedSchema>;

export const AgentSetupStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("setting_up") }),
  z.object({ status: z.literal("ready"), agent: CreatedAgentSchema }),
  z.object({ status: z.literal("failed"), error: z.string() }),
]);
export type AgentSetupStatus = z.infer<typeof AgentSetupStatusSchema>;
