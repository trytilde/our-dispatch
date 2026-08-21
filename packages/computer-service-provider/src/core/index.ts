import type {
  DeployableProvider,
  DeploymentContext,
  DeploymentReporter,
  DeploymentResult,
} from "@tryopenbot/runtime-provider";
export type { Deployable } from "@tryopenbot/runtime-provider";

export type ComputerState = "creating" | "running" | "sleeping" | "failed";

export interface ComputerCallContext {
  requestId: string;
  /** Routes runtime calls through the provider's development implementation when available. */
  devMode?: boolean;
  /** Provider credentials available to lifecycle calls; ordinary runtime calls use process.env. */
  environment?: NodeJS.ProcessEnv;
  agentId?: string;
  signal?: AbortSignal;
  deadline?: Date;
  idempotencyKey?: string;
  /** Streams provider-owned command progress during lifecycle execution. */
  report?: DeploymentReporter;
}

export class ComputerProviderError extends Error {
  constructor(
    readonly code:
      | "invalid_configuration"
      | "not_supported"
      | "not_found"
      | "deadline_exceeded"
      | "provider_unavailable"
      | "permission_denied"
      | "internal",
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ComputerProviderError";
  }
}

export interface ComputerSeedFile {
  path: string;
  content: Uint8Array;
  executable?: boolean;
}

export interface ComputerSeedSymlink {
  path: string;
  target: string;
}

/** Seeded repository entry, which the trusted development sandbox may express as a symlink. */
export type ComputerSeedEntry = ComputerSeedFile | ComputerSeedSymlink;

export interface ComputerLifecycleScript {
  id: string;
  path: string;
  phases: readonly ("create" | "wake")[];
}

export interface ComputerSpec {
  id?: string;
  image?: string;
  labels?: Readonly<Record<string, string>>;
  environment?: Readonly<Record<string, string>>;
  files?: readonly ComputerSeedFile[];
  lifecycle?: readonly ComputerLifecycleScript[];
}

export interface ComputerHandle {
  id: string;
  providerId: string;
  state: ComputerState;
  createdAt: Date;
  image?: string;
}

export interface ComputerExecRequest {
  command: string;
  args?: readonly string[];
  cwd?: string;
  timeoutMs?: number;
  environment?: Readonly<Record<string, string>>;
}

export interface ComputerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ComputerVncEndpoint {
  url: URL;
  expiresAt: Date;
}

export interface ComputerAgentWorkspace {
  agentId: string;
  files: readonly ComputerSeedFile[];
}

export interface DeployAgentWorkspacesRequest {
  computerId: string;
  workspaces: readonly ComputerAgentWorkspace[];
}

export interface DeployDevelopmentSandboxRequest {
  computerId: string;
  /** Agent workspace roots to prepare so those agents can run tools in this sandbox. */
  agentWorkspaceIds?: readonly string[];
}

export interface ComputerImageSpec {
  sourceDigest: string;
  contextDirectory: string;
  dockerfilePath: string;
  repository: string;
  tagPrefix?: string;
  buildArguments?: Readonly<Record<string, string>>;
}

export interface BuiltComputerImage {
  sourceDigest: string;
  localReference: string;
}

export interface PublishedComputerImage extends BuiltComputerImage {
  reference: string;
  publishedAt: Date;
}

export interface ComputerProvider extends DeployableProvider {
  previewAgentDesktop(agentId: string, context: ComputerCallContext): Promise<ComputerVncEndpoint>;
  deployAgentWorkspaces(
    request: DeployAgentWorkspacesRequest,
    context: DeploymentContext,
  ): Promise<DeploymentResult>;
  deployDevelopmentSandbox(
    request: DeployDevelopmentSandboxRequest,
    context: DeploymentContext,
  ): Promise<DeploymentResult>;
}
