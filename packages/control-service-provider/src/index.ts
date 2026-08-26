import type {
  Buildable,
  Deployable,
  DeploymentContext,
  InitializableProvider,
} from "@tryopenbot/runtime-provider";

export type ControlServiceProvider = Buildable &
  Deployable &
  InitializableProvider & {
    /** Stable public URL used by dependent lifecycle providers. */
    baseUrl(context: Pick<DeploymentContext, "devMode" | "environment">): URL;
  };
export { LocalControlServiceProvider } from "./local/index.js";
export {
  VercelControlServiceProvider,
  deploymentUrl,
  ensureVercelProject,
} from "./vercel/index.js";
export type { LocalControlServiceProviderOptions } from "./local/index.js";
export type { VercelControlServiceProviderOptions } from "./vercel/index.js";
export type { CommandRunner, CommandResult } from "./command.js";
export { processRunner } from "./command.js";
export { installLocalService, retireLocalService, waitForHealth } from "./local-service.js";
export { buildVercelControlService } from "./vercel/build.js";
