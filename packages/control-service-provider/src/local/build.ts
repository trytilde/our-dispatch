import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeploymentContext, DeploymentResult } from "@tryopenbot/runtime-provider";
import { materializeFileTemplate, workspaceSourceInputOptions } from "@tryopenbot/utilities";
import type { CommandRunner } from "../command.js";

export const controlLocalArtifact = ".openbot-deploy/control-service/service.mjs";
const entryTemplate = fileURLToPath(new URL("./assets/entry.ts.hbs", import.meta.url));

export async function buildLocalControlService(
  context: DeploymentContext,
  runner: CommandRunner,
): Promise<DeploymentResult> {
  const { build } = await import("tsdown");
  await runner.run("pnpm", ["--filter", "@tryopenbot/web", "build"], {
    cwd: context.repositoryRoot,
    environment: context.environment,
  });
  const outfile = resolve(context.repositoryRoot, controlLocalArtifact);
  const generatedEntry = resolve(
    context.repositoryRoot,
    ".openbot-deploy/generated/control-service-local.ts",
  );
  await mkdir(dirname(outfile), { recursive: true });
  await materializeFileTemplate(entryTemplate, generatedEntry, {
    CONTROL_SOURCE: JSON.stringify(
      resolve(context.repositoryRoot, "apps/control-service/src/app.ts"),
    ),
    CONFIGURATION_SOURCE: JSON.stringify(resolve(context.repositoryRoot, "configuration/index.ts")),
  });
  await build({
    cwd: context.repositoryRoot,
    entry: [generatedEntry],
    format: ["esm"],
    platform: "node",
    target: "node24",
    outDir: dirname(outfile),
    clean: true,
    minify: false,
    sourcemap: true,
    inputOptions: workspaceSourceInputOptions(),
    outputOptions: {
      entryFileNames: "service.mjs",
      sourcemapExcludeSources: true,
    },
  });
  return { outputs: { "control-service.artifact": outfile } };
}
