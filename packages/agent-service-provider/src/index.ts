import type {
  Buildable,
  Deployable,
  DeploymentContext,
  InitializableProvider,
} from "@tryopenbot/runtime-provider";

export type AgentServiceProvider = Buildable &
  Deployable &
  InitializableProvider & {
    /** Stable base URL used when reconciling authored agent endpoints. */
    baseUrl(context: Pick<DeploymentContext, "devMode" | "environment">): URL;
    /** Optional compatibility contraction after the external endpoint cutover succeeds. */
    finalizeEndpointCutover?(context: DeploymentContext): Promise<void>;
  };
export { createAgentServiceApp } from "./development.js";
export {
  authoredAgentPaths,
  discoverAgents,
  primaryAgentDirectory,
  primaryAgentId,
  subagentDirectory,
} from "./discovery.js";
export { discoverAgentWorkspaces } from "./workspaces.js";
export { LocalAgentServiceProvider } from "./local/index.js";
export { VercelAgentServiceProvider } from "./vercel/index.js";
export { LocalRuntimeServiceProvider } from "./runtime/local.js";
export { VercelRuntimeServiceProvider } from "./runtime/vercel.js";
export type { LocalAgentServiceProviderOptions } from "./local/index.js";
export type { VercelAgentServiceProviderOptions } from "./vercel/index.js";
export type { LocalRuntimeServiceProviderOptions } from "./runtime/local.js";
export type { VercelRuntimeServiceProviderOptions } from "./runtime/vercel.js";
