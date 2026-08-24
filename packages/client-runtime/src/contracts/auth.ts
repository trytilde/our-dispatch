import { z } from "zod";

export const AuthenticatedAccountContextSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().optional(),
});

export const AuthenticatedUserSchema = z.object({
  subject: z.string().min(1),
  name: z.string().min(1),
  email: z.string().optional(),
  avatar_url: z.string().url().optional(),
  organization: AuthenticatedAccountContextSchema.optional(),
  workspace: AuthenticatedAccountContextSchema.optional(),
});
export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;

export const AuthenticatedSessionSchema = z.object({
  authenticated: z.literal(true),
  user: AuthenticatedUserSchema,
});
export type AuthenticatedSession = z.infer<typeof AuthenticatedSessionSchema>;

export type AuthenticationStatus = "checking" | "authenticated" | "unauthenticated";

export interface ClientAuthAdapter {
  getSession(): Promise<AuthenticatedSession | null>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

export interface DesktopAuthBridge {
  authStatus(): Promise<AuthenticatedSession | null>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
