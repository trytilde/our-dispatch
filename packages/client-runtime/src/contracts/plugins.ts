import { z } from "zod";
import { ConnectorAccountSchema, ConnectorProviderSchema } from "./connectors.js";

export const PluginToolAccountSchema = ConnectorAccountSchema.extend({
  assigned_agent_ids: z.array(z.string()),
});
export type PluginToolAccount = z.infer<typeof PluginToolAccountSchema>;

export const PluginToolProviderSchema = z.object({
  provider: ConnectorProviderSchema,
  accounts: z.array(PluginToolAccountSchema),
});
export type PluginToolProvider = z.infer<typeof PluginToolProviderSchema>;

export const PluginSkillSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  assigned_agent_ids: z.array(z.string()),
});
export type PluginSkill = z.infer<typeof PluginSkillSchema>;

export const PluginSkillProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  categories: z.array(z.string().min(1)),
  icon_url: z.string().optional(),
  icon_key: z.string().optional(),
  skills: z.array(PluginSkillSchema),
});
export type PluginSkillProvider = z.infer<typeof PluginSkillProviderSchema>;

export const PluginsCatalogSchema = z.object({
  tools: z.array(PluginToolProviderSchema),
  skills: z.array(PluginSkillProviderSchema),
});
export type PluginsCatalog = z.infer<typeof PluginsCatalogSchema>;

export const PluginMutationResultSchema = z.object({ ok: z.literal(true) });
