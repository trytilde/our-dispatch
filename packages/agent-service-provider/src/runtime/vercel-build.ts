import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { DeploymentContext, DeploymentResult } from "@tryopenbot/runtime-provider";
import {
  buildVercelControlService,
  type CommandRunner,
} from "@tryopenbot/control-service-provider";
import { buildVercelAgentService } from "../vercel/build.js";

export async function buildVercelRuntimeService(
  context: DeploymentContext,
  runner: CommandRunner,
): Promise<DeploymentResult> {
  const agentResult = await buildVercelAgentService(context);
  const controlResult = await buildVercelControlService(context, runner);
  const agentRoot = agentResult.outputs?.["agent-service.artifact"];
  const runtimeRoot = controlResult.outputs?.["control-service.artifact"];
  if (!agentRoot || !runtimeRoot) throw new Error("Runtime component build omitted its artifact");

  const source = resolve(agentRoot, ".vercel/output/functions/api/agents");
  const destination = resolve(runtimeRoot, ".vercel/output/functions/api/agents");
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });

  return {
    outputs: {
      ...agentResult.outputs,
      ...controlResult.outputs,
      "agent-service.artifact": runtimeRoot,
      "runtime.artifact": runtimeRoot,
    },
  };
}
