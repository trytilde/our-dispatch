import { AgentProviderError } from "../core.js";

export interface ToolReconciliationContext {
  requestId: string;
  deadline?: Date;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export interface ToolServer {
  id: string;
}

export interface EnsureToolServerRequest {
  id: string;
  name: string;
  dynamicToolDiscovery?: boolean;
}

export function reconciliationSignal(
  context: ToolReconciliationContext,
  fallbackMs = 30_000,
): AbortSignal {
  if (context.signal?.aborted)
    throw new AgentProviderError("deadline_exceeded", "The tool reconciliation was aborted", true);
  if (context.signal) return context.signal;
  const remaining = context.deadline ? context.deadline.valueOf() - Date.now() : fallbackMs;
  if (remaining <= 0)
    throw new AgentProviderError(
      "deadline_exceeded",
      "The tool reconciliation deadline has elapsed",
      true,
    );
  return AbortSignal.timeout(Math.min(remaining, fallbackMs));
}
