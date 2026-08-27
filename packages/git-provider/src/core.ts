import type { DeployableProvider } from "@tryopenbot/runtime-provider";

export type GitProviderErrorCode =
  | "invalid_configuration"
  | "invalid_request"
  | "not_supported"
  | "not_found"
  | "deadline_exceeded"
  | "provider_unavailable"
  | "permission_denied"
  | "internal";

export class GitProviderError extends Error {
  constructor(
    readonly code: GitProviderErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "GitProviderError";
  }
}

/** Names of environment values a reconciled git provider persists for other lifecycles. */
export interface GitProviderEnvironment {
  /** Provider-specific repository locator holding this OpenBot fork. */
  readonly repository: string;
  /** Reverse-proxy profile ID fronting the hosting provider's REST API, when applicable. */
  readonly restProxyProfileId?: string;
  /** Reverse-proxy profile ID fronting authenticated git transport, when applicable. */
  readonly gitProxyProfileId?: string;
}

/**
 * Reconciles hosted git access for the installation: the brokered hosting credential plus the
 * proxied REST and git-over-HTTPS transports consumed by sandboxes and agent tools.
 */
export interface GitProvider extends DeployableProvider {
  readonly deployable: NonNullable<DeployableProvider["deployable"]>;
  /** Environment names this provider persists once the hosting credential is connected. */
  readonly environmentNames: GitProviderEnvironment;
}
