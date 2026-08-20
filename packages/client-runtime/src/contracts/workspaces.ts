import { z } from "zod";

export const ClientWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  control_origin: z.url(),
  client_origin: z.url().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  created_at: z.string(),
});
export type ClientWorkspace = z.infer<typeof ClientWorkspaceSchema>;

export const ClientWorkspaceRegistrySchema = z.object({
  version: z.literal(1),
  active_workspace_id: z.string().nullable(),
  workspaces: z.array(ClientWorkspaceSchema),
});
export type ClientWorkspaceRegistry = z.infer<typeof ClientWorkspaceRegistrySchema>;

export interface ClientWorkspaceStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}
