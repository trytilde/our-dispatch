import arg from "arg";
import { formatAgentLifecycleProgress, reconcileAgentResources } from "../agent-lifecycle.js";
import { scaffoldAgent, type ScaffoldedAgent } from "../agent-scaffold.js";
import { loadLocalEnvironment } from "../environment.js";
import { setEnvironmentValue } from "../initialization.js";
import { repositoryRoot } from "../paths.js";
import { loadDevelopmentConfiguration } from "./dev.js";
import { inkPrompts } from "./init.js";

export interface NewAgentRunResult {
  agent: ScaffoldedAgent;
  json: boolean;
}

export async function runNewAgent(args: readonly string[] = []): Promise<NewAgentRunResult> {
  const parsed = arg({ "--json": Boolean }, { argv: [...args] });
  const suppliedName = parsed._.join(" ").trim();
  if (!suppliedName && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error(
      'openbot new-agent requires a name in non-interactive use, for example: openbot new-agent "Research Agent"',
    );
  }
  const name = suppliedName || (await inkPrompts.input("Agent name", { required: true }));
  const agent = await scaffoldAgent(repositoryRoot, name, { existing: "preserve" });
  await setEnvironmentValue(
    repositoryRoot,
    `AGENT_${agent.id.replaceAll("-", "_").toUpperCase()}_NAME`,
    agent.name,
    `Display name for the ${agent.id} agent.`,
  );
  const environment = await loadLocalEnvironment({
    prompts: process.stdin.isTTY && process.stdout.isTTY ? inkPrompts : undefined,
  });
  const configuration = await loadDevelopmentConfiguration(environment);
  const liveAgentServiceOrigin = environment.AGENT_SERVICE_ORIGIN?.trim();
  await reconcileAgentResources({
    repositoryRoot,
    agentIds: [agent.id],
    environment,
    providers: configuration.providers,
    devMode: true,
    ...(liveAgentServiceOrigin ? { agentServiceOrigin: liveAgentServiceOrigin } : {}),
    report: parsed["--json"]
      ? undefined
      : (event) => {
          const line = formatAgentLifecycleProgress(event);
          if (line) console.log(line);
        },
  });
  return { agent, json: parsed["--json"] ?? false };
}
