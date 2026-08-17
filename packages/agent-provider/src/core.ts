import type { DeployableProvider } from "@tryopenbot/runtime-provider";

export type AgentProviderErrorCode =
  | "invalid_configuration"
  | "invalid_request"
  | "not_supported"
  | "not_found"
  | "deadline_exceeded"
  | "provider_unavailable"
  | "permission_denied"
  | "internal";

export class AgentProviderError extends Error {
  constructor(
    readonly code: AgentProviderErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AgentProviderError";
  }
}

/** Reconciles authored agents and their external runtime endpoints through deployment lifecycle. */
export interface AgentProvider extends DeployableProvider {
  readonly deployable: NonNullable<DeployableProvider["deployable"]>;
}
