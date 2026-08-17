import { AgentProviderError } from "../core.js";

export interface SkillReconciliationContext {
  requestId: string;
  deadline?: Date;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export interface SkillRegistry {
  id: string;
  name: string;
}

export interface ListSkillRegistriesRequest {
  namePrefix?: string;
}

export interface RegisterSkillsRequest {
  registryId?: string;
  name: string;
  description: string;
  skillIds: readonly string[];
}

export function reconciliationSignal(
  context: SkillReconciliationContext,
  fallbackMs = 30_000,
): AbortSignal {
  if (context.signal) return context.signal;
  const remaining = context.deadline ? context.deadline.valueOf() - Date.now() : fallbackMs;
  if (remaining <= 0)
    throw new AgentProviderError(
      "deadline_exceeded",
      "The skill reconciliation deadline has elapsed",
      true,
    );
  return AbortSignal.timeout(Math.min(remaining, fallbackMs));
}
