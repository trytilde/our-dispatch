import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { materializeFileTemplate, workspaceSourceInputOptions } from "@tryopenbot/utilities";
import type { DeploymentContext, DeploymentResult } from "@tryopenbot/runtime-provider";
import type { CommandRunner } from "../command.js";

export const controlVercelArtifact = ".openbot-deploy/vercel/control";
const entryTemplate = fileURLToPath(new URL("./assets/entry.ts.hbs", import.meta.url));
const functionConfigTemplate = fileURLToPath(
  new URL("./assets/function-config.json.hbs", import.meta.url),
);
const outputConfigTemplate = fileURLToPath(
  new URL("./assets/output-config.json.hbs", import.meta.url),
);
export const vercelProjectTemplate = fileURLToPath(
  new URL("./assets/vercel.json.hbs", import.meta.url),
);

export async function buildVercelControlService(
  context: DeploymentContext,
  runner: CommandRunner,
): Promise<DeploymentResult> {
  const { build } = await import("tsdown");
  await runner.run("pnpm", ["--filter", "@tryopenbot/web", "build"], {
    cwd: context.repositoryRoot,
    environment: context.environment,
  });
  const root = resolve(context.repositoryRoot, controlVercelArtifact);
  const output = resolve(root, ".vercel/output");
  const functionDirectory = resolve(output, "functions/control.func");
  const generatedEntry = resolve(
    context.repositoryRoot,
    ".openbot-deploy/generated/control-service-vercel.ts",
  );
  await rm(root, { recursive: true, force: true });
  await mkdir(functionDirectory, { recursive: true });
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
    outDir: functionDirectory,
    clean: false,
    minify: true,
    sourcemap: true,
    inputOptions: workspaceSourceInputOptions(),
    outputOptions: {
      entryFileNames: "index.mjs",
      sourcemapExcludeSources: true,
    },
  });
  await Promise.all([
    cp(resolve(context.repositoryRoot, "apps/web/dist"), resolve(output, "static"), {
      recursive: true,
    }),
    materializeFileTemplate(functionConfigTemplate, resolve(functionDirectory, ".vc-config.json")),
    materializeFileTemplate(outputConfigTemplate, resolve(output, "config.json")),
  ]);
  return { outputs: { "control-service.artifact": root } };
}
