import { z } from "zod";

// Onboarding is a persisted, cross-client state interaction: it survives reload, it
// decides whether a client shows first-run at all, and the agent it describes is read
// by other surfaces. Per ADR-0017 it therefore belongs here rather than in a renderer,
// and the platform supplies storage so no client is tied to localStorage.

// Avatar shapes are registered by name in the UI's shape registry rather than fixed in
// a union, so the contract validates that a name is present and leaves the set open.
// A closed enum here would reject a shape the renderer legitimately supports.
export const agentAvatarShapeSchema = z.string().min(1);

export const onboardingResultSchema = z.object({
  name: z.string(),
  color: z.string(),
  shape: agentAvatarShapeSchema,
  tools: z.array(z.string()),
});

export const onboardingStateSchema = z.object({
  completed: z.boolean(),
  result: onboardingResultSchema.optional(),
});

export type AgentAvatarShape = z.infer<typeof agentAvatarShapeSchema>;
export type OnboardingResult = z.infer<typeof onboardingResultSchema>;
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

/**
 * The slice of a key/value store onboarding needs. Sync-or-async returns so web
 * `localStorage` and Electron's bridge both satisfy it unchanged.
 */
export interface OnboardingStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}
