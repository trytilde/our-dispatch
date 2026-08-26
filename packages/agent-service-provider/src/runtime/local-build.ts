import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import type { DeploymentContext, DeploymentResult } from "@tryopenbot/runtime-provider";
import { materializeFileTemplate } from "@tryopenbot/utilities";
import type { CommandRunner } from "@tryopenbot/control-service-provider";
import { bundleOptions } from "../build.js";
import { discoverAgents } from "../discovery.js";
import { digestAgents, localAgentTemplateValues } from "../local/build.js";

export const localRuntimeArtifact = ".openbot-deploy/runtime/service.mjs";
const entryTemplate = fileURLToPath(new URL("./assets/local-entry.ts.hbs", import.meta.url));

export async function buildLocalRuntimeService(
  context: DeploymentContext,
  runner: CommandRunner,
): Promise<DeploymentResult> {
  const { build } = await import("tsdown");
  await runner.run("pnpm", ["--filter", "@tryopenbot/web", "build"], {
    cwd: context.repositoryRoot,
    environment: context.environment,
  });
  const agents = await discoverAgents(context.repositoryRoot);
  const generated = resolve(context.repositoryRoot, ".openbot-deploy/generated/runtime-local.ts");
  const outfile = resolve(context.repositoryRoot, localRuntimeArtifact);
  const values = localAgentTemplateValues(context.repositoryRoot, agents);
  await mkdir(dirname(outfile), { recursive: true });
  await materializeFileTemplate(entryTemplate, generated, {
    NODE_SERVER: JSON.stringify(fileURLToPath(import.meta.resolve("@hono/node-server"))),
    HONO: JSON.stringify(fileURLToPath(import.meta.resolve("hono"))),
    CONTROL_SOURCE: JSON.stringify(
      resolve(context.repositoryRoot, "apps/control-service/src/app.ts"),
    ),
    CONFIGURATION_SOURCE: JSON.stringify(resolve(context.repositoryRoot, "configuration/index.ts")),
    AGENT_IMPORTS: values.imports,
    AGENT_INITIALIZERS: values.initializers,
    AGENT_ROUTES: values.routes,
  });
  await build(
    bundleOptions(context.repositoryRoot, generated, dirname(outfile), "service.mjs", false),
  );
  return {
    outputs: {
      "control-service.artifact": outfile,
      "agent-service.artifact": outfile,
      "agent-service.target": "local",
      "agent-service.count": String(agents.length),
      "agent-service.digest": await digestAgents(agents),
      "runtime.artifact": outfile,
    },
  };
}
