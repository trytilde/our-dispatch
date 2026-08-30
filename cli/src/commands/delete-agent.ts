import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import arg from "arg";
import {
  discoverAgents,
  primaryAgentId,
  subagentDirectory,
} from "@tryopenbot/agent-service-provider";
import { removeAgentResources } from "../agent-lifecycle.js";
import { loadLocalEnvironment } from "../environment.js";
import { readLiveAgentServiceOrigin } from "../live-agent-service.js";
import { repositoryRoot } from "../paths.js";
import { loadDevelopmentConfiguration } from "./dev.js";

export interface DeleteAgentRunResult {
  agent: { id: string; name: string; directory: string };
  json: boolean;
}

export async function runDeleteAgent(args: readonly string[] = []): Promise<DeleteAgentRunResult> {
  const parsed = arg({ "--yes": Boolean, "--json": Boolean }, { argv: [...args] });
  const [agentId, ...extra] = parsed._;
  if (!agentId || extra.length > 0) throw new Error("openbot delete-agent requires one agent ID");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(agentId))
    throw new Error(`Invalid agent ID: ${agentId}`);
  if (agentId === primaryAgentId) throw new Error("The primary Factory agent cannot be deleted");
  if (!parsed["--yes"]) throw new Error("openbot delete-agent requires --yes");
  const source = (await discoverAgents(repositoryRoot)).find((agent) => agent.slug === agentId);
  const directory = source?.directory ?? resolve(repositoryRoot, subagentDirectory, agentId);
  const environment = await loadLocalEnvironment();
  const prefix = `AGENT_${agentId.replaceAll("-", "_").toUpperCase()}`;
  const name = environment[`${prefix}_NAME`] ?? agentId;
  const configuration = await loadDevelopmentConfiguration(environment);
  const liveAgentServiceOrigin =
    (await readLiveAgentServiceOrigin(repositoryRoot)) ?? environment.AGENT_SERVICE_ORIGIN?.trim();
  await removeAgentResources({
    repositoryRoot,
    environment,
    providers: configuration.providers,
    devMode: true,
    agentId,
    agentPath: directory,
    ...(liveAgentServiceOrigin ? { agentServiceOrigin: liveAgentServiceOrigin } : {}),
  });
  await rm(directory, { recursive: true, force: true });
  return {
    agent: {
      id: agentId,
      name,
      directory,
    },
    json: parsed["--json"] ?? false,
  };
}
