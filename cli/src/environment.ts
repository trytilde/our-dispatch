import { config } from "dotenv";
import { loadDeploymentConfiguration } from "./initialization.js";
import type { InitializationPrompts } from "./initialization.js";
import { repositoryRoot } from "./paths.js";

export async function loadLocalEnvironment(
  options: {
    prompts?: InitializationPrompts;
  } = {},
): Promise<NodeJS.ProcessEnv> {
  const deploymentEnvironment = process.env.DEPLOYMENT_ENV_FILE;
  if (deploymentEnvironment) config({ path: deploymentEnvironment, quiet: true });
  const environment =
    process.env.CONFIGURATION_LOADED === "1"
      ? process.env
      : (
          await loadDeploymentConfiguration(repositoryRoot, {
            environment: process.env,
            prompts: options.prompts,
          })
        ).environment;
  environment.CONFIGURATION_LOADED = "1";
  environment.PORT ||= environment.TUNNEL_PORT || environment.PORT || "4100";
  environment.WEB_PORT ||= "4173";
  Object.assign(process.env, environment);
  return environment;
}

/** Keep control-plane credentials in the Hono process and out of Vite/Electron children. */
export function publicDevelopmentEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|SOPS_AGE)/i.test(name),
    ),
  );
}
