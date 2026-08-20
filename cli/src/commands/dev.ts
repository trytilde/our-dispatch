import { resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { OpenBotConfiguration } from "@tryopenbot/configuration";
import { waitForHealth } from "@tryopenbot/control-service-provider";
import { runLocalRuntimeTunnelCommand } from "@trytilde/cli";
import { formatAgentLifecycleProgress, reconcileAgentResources } from "../agent-lifecycle.js";
import { loadConfigurationModule } from "../configuration-loader.js";
import {
  reconcileDevelopmentInfrastructure,
  watchDevelopmentComputer,
} from "../development-lifecycle.js";
import { developmentChildEnvironment, loadLocalEnvironment } from "../environment.js";
import { repositoryRoot } from "../paths.js";
import { run, runChecked, supervise } from "../processes.js";
import { createStreamingProgress } from "../ui.js";
import { inkPrompts } from "./init.js";

export async function runDevelopment(): Promise<never> {
  // Snapshot the shell before loadLocalEnvironment merges the decrypted deployment configuration
  // into process.env. Development children inherit this and the wiring named below, nothing else.
  const shellEnvironment = { ...process.env };
  const env = await loadLocalEnvironment({
    prompts: process.stdin.isTTY && process.stdout.isTTY ? inkPrompts : undefined,
  });
  const serverPort = env.PORT ?? "4100";
  const configuration = await loadDevelopmentConfiguration(env);
  const infrastructureProgress = createStreamingProgress(
    "Preparing OpenBot development infrastructure",
  );
  try {
    await reconcileDevelopmentInfrastructure({
      repositoryRoot,
      environment: env,
      providers: configuration.providers,
      report: ({ event, details }) => {
        if (event === "provider.command.output" && typeof details?.output === "string") {
          infrastructureProgress.write(details.output);
          return;
        }
        const label = developmentProgressLabel(event, details?.providerId);
        if (label) infrastructureProgress.setLabel(label);
      },
    });
    infrastructureProgress.succeed("OpenBot development infrastructure ready");
  } catch (error) {
    infrastructureProgress.fail("OpenBot development infrastructure failed");
    throw error;
  }
  await runChecked("pnpm", ["contracts:generate"], env);
  const computerWatcher = await watchDevelopmentComputer({
    repositoryRoot,
    environment: env,
    providers: configuration.providers,
    onRebuildStarted: () => console.log("Computer image changed; rebuilding Microsandbox"),
    onRebuildComplete: () => console.log("Computer restarted with the updated image"),
    onRebuildError: (error) =>
      console.error(
        `Computer rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
  });
  process.once("exit", () => computerWatcher.close());

  const webPort = env.WEB_PORT ?? "4173";
  console.log(`OpenBot web: http://127.0.0.1:${webPort}`);
  console.log(`OpenBot control and agent HMR server: http://127.0.0.1:${serverPort}`);

  const [serverCommand, serverArguments] = developmentServerCommand();
  const server = await startTunneledAgentService(serverCommand, serverArguments, env);
  try {
    await reconcileAgentResources({
      repositoryRoot,
      environment: env,
      providers: configuration.providers,
      devMode: true,
      agentServiceOrigin: server.agentServiceOrigin,
      report: (event) => {
        const line = formatAgentLifecycleProgress(event);
        if (line) console.log(line);
      },
    });
  } catch (error) {
    server.stop();
    throw error;
  }
  const web = run(
    "pnpm",
    developmentPackageCommand("@tryopenbot/web", "dev", ["--port", webPort]),
    developmentChildEnvironment(shellEnvironment, { OPENBOT_CONTROL_PORT: serverPort }),
  );
  const children = [server.child, web];

  const canLaunchDesktop =
    env.NO_DESKTOP !== "1" &&
    (process.platform === "darwin" || Boolean(env.DISPLAY || env.WAYLAND_DISPLAY));
  if (canLaunchDesktop) {
    // The desktop discovers its OIDC configuration from the control service, so it needs only
    // the origins to reach.
    const desktopEnv = developmentChildEnvironment(shellEnvironment, {
      CONTROL_ORIGIN: `http://127.0.0.1:${serverPort}`,
      DESKTOP_DEV_URL: `http://127.0.0.1:${webPort}`,
    });
    children.push(run("pnpm", developmentPackageCommand("@tryopenbot/desktop", "dev"), desktopEnv));
  } else {
    console.log(
      "OpenBot desktop: skipped (set DISPLAY/WAYLAND_DISPLAY, or run on macOS; NO_DESKTOP=1 disables it explicitly)",
    );
  }

  return supervise(children, {
    onStop: () => {
      computerWatcher.close();
      server.stop();
    },
  });
}

export async function loadDevelopmentConfiguration(
  environment: NodeJS.ProcessEnv,
): Promise<OpenBotConfiguration> {
  const path = resolve(repositoryRoot, "configuration/index.ts");
  const module = await loadConfigurationModule<{ default?: OpenBotConfiguration }>(
    path,
    environment,
  );
  if (!module.default)
    throw new Error("configuration/index.ts must export the OpenBot configuration as default");
  return module.default;
}

export function developmentServerCommand(): readonly [string, readonly string[]] {
  return ["pnpm", ["exec", "tsx", "watch", resolve(repositoryRoot, "cli/src/index.tsx"), "_serve"]];
}

export function developmentPackageCommand(
  packageName: string,
  script: string,
  arguments_: readonly string[] = [],
): readonly string[] {
  return ["--reporter=silent", "--filter", packageName, script, ...arguments_];
}

export function developmentServerEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nodeOptions = environment.NODE_OPTIONS?.trim();
  return {
    ...environment,
    NODE_OPTIONS: [nodeOptions, "--conditions=development"].filter(Boolean).join(" "),
  };
}

export function developmentTunnelOptions(
  command: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
):
  | {
      baseUrl: string;
      apiKey: string;
      orgId: string;
      teamId: string;
      command: string[];
      port: number;
    }
  | undefined {
  const apiKey = environment.TILDE_API_KEY?.trim();
  const orgId = environment.TILDE_ORG_ID?.trim();
  const teamId = environment.TILDE_TEAM_ID?.trim();
  if (!apiKey || !orgId || !teamId) return undefined;
  const port = Number(environment.PORT ?? "4100");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error(`Invalid OpenBot development server port: ${environment.PORT}`);
  return {
    baseUrl: environment.TILDE_BASE_URL?.trim() || "https://api.trytilde.ai",
    apiKey,
    orgId,
    teamId,
    command: [command, ...arguments_],
    port,
  };
}

export async function startTunneledAgentService(
  command: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<DevelopmentServer> {
  const serverEnvironment = developmentServerEnvironment(environment);
  const tunnelOptions = developmentTunnelOptions(command, arguments_, environment);
  if (!tunnelOptions) {
    const child = run(command, arguments_, serverEnvironment);
    // Dependent traffic (agent reconciliation, Vite proxying) starts as soon as this resolves,
    // so wait for the service to answer instead of surfacing transient connection refusals.
    try {
      await waitForHealth(fetch, `http://127.0.0.1:${environment.PORT ?? "4100"}`);
    } catch (error) {
      child.kill("SIGTERM");
      throw error;
    }
    return {
      child,
      agentServiceOrigin: `http://127.0.0.1:${environment.PORT ?? "4100"}`,
      stop: () => child.kill("SIGTERM"),
    };
  }

  const previousNodeOptions = process.env.NODE_OPTIONS;
  const previousTunnelLogLevel = process.env.TUNNEL_LOGLEVEL;
  const previousTunnelTransportLogLevel = process.env.TUNNEL_TRANSPORT_LOGLEVEL;
  process.env.NODE_OPTIONS = serverEnvironment.NODE_OPTIONS;
  // cloudflared reports canceled streams as errors during its otherwise healthy SIGTERM path.
  // Keep development shutdown quiet while preserving fatal connector failures.
  process.env.TUNNEL_LOGLEVEL ??= "fatal";
  process.env.TUNNEL_TRANSPORT_LOGLEVEL ??= "fatal";
  let tunnel;
  try {
    tunnel = await runLocalRuntimeTunnelCommand({
      ...tunnelOptions,
      command: tunnelOptions.command,
    });
  } finally {
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    if (previousTunnelLogLevel === undefined) delete process.env.TUNNEL_LOGLEVEL;
    else process.env.TUNNEL_LOGLEVEL = previousTunnelLogLevel;
    if (previousTunnelTransportLogLevel === undefined) delete process.env.TUNNEL_TRANSPORT_LOGLEVEL;
    else process.env.TUNNEL_TRANSPORT_LOGLEVEL = previousTunnelTransportLogLevel;
  }
  process.once("exit", () => tunnel.stop());
  void tunnel.closed.then(() => {
    if (!tunnel.command.killed) tunnel.command.kill("SIGTERM");
  });
  console.log("Tilde local-runtime tunnel: connected");
  try {
    await waitForHealth(fetch, `http://127.0.0.1:${environment.PORT ?? "4100"}`);
  } catch (error) {
    tunnel.command.kill("SIGTERM");
    tunnel.stop();
    throw error;
  }
  return {
    child: tunnel.command,
    agentServiceOrigin: tunnel.connector.tunnel_origin,
    stop: () => {
      tunnel.command.kill("SIGTERM");
      tunnel.stop();
    },
  };
}

export interface DevelopmentServer {
  child: ChildProcess;
  agentServiceOrigin: string;
  stop(): void;
}

function developmentProgressLabel(event: string, providerId: unknown): string | undefined {
  const provider = typeof providerId === "string" ? providerId : "provider";
  if (event === "build.provider.check.started") return `Checking ${provider}`;
  if (event === "build.provider.build.started") return `Building ${provider}`;
  if (event === "deployment.provider.plan.started") return `Planning ${provider}`;
  if (event === "deployment.provider.configure.started") return `Configuring ${provider}`;
  if (event === "deployment.provider.deploy.started") return `Starting ${provider}`;
  return undefined;
}
