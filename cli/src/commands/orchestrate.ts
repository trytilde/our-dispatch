import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { formatAgentLifecycleProgress, reconcileAgentResources } from "../agent-lifecycle.js";
import { loadLocalEnvironment } from "../environment.js";
import { setEnvironmentValue } from "../initialization.js";
import { repositoryRoot } from "../paths.js";
import { runChecked } from "../processes.js";
import {
  developmentServerCommand,
  loadDevelopmentConfiguration,
  startTunneledAgentService,
} from "./dev.js";
import { runProductionDeploy } from "./deploy.js";
import { inkPrompts } from "./init.js";

export const SANDBOX_EDITS_BRANCH = "openbot/sandbox-edits";

const settleMs = 30_000;
const watchedDirectories = ["configuration", "packages", "apps", "cli"] as const;
const ignoredSegments = new Set([".git", "node_modules", "dist", ".openbot-deploy", ".cache"]);
// Lifecycle metadata the pipeline itself persists; watching it would make deploys self-trigger.
const ignoredRepositoryPaths = new Set([
  "configuration/.env",
  "configuration/secrets.enc.yaml",
  "configuration/.sops.yaml",
]);

type RuntimeState = "deployed" | "live" | "publishing";

/**
 * Background SDLC reconciliation: agents never decide their own lifecycle. The first edit in the
 * checkout flips every agent to the local-runtime tunnel (whole-repo — shared files affect every
 * agent). Once edits settle, the pipeline verifies, publishes the tree to the sandbox-edits
 * branch, deploys agent services, and flips every agent back to the deployed endpoint.
 */
export async function runOrchestrator(): Promise<never> {
  const env = await loadLocalEnvironment({
    prompts: process.stdin.isTTY && process.stdout.isTTY ? inkPrompts : undefined,
  });
  const configuration = await loadDevelopmentConfiguration(env);
  const [serverCommand, serverArguments] = developmentServerCommand();
  const server = await startTunneledAgentService(serverCommand, serverArguments, env);
  console.log(`Agent HMR server: ${server.agentServiceOrigin}`);
  await setEnvironmentValue(
    repositoryRoot,
    "AGENT_SERVICE_ORIGIN",
    server.agentServiceOrigin,
    "Live agent service origin served from the development sandbox tunnel.",
  );
  env.AGENT_SERVICE_ORIGIN = server.agentServiceOrigin;

  let state: RuntimeState = "deployed";
  let flipInFlight: Promise<void> | undefined;
  let epoch = 0;
  let settleTimer: NodeJS.Timeout | undefined;

  const reconcile = async (devMode: boolean): Promise<void> => {
    await reconcileAgentResources({
      repositoryRoot,
      environment: env,
      providers: configuration.providers,
      devMode,
      ...(devMode ? { agentServiceOrigin: server.agentServiceOrigin } : {}),
      report: (event) => {
        const line = formatAgentLifecycleProgress(event);
        if (line) console.log(line);
      },
    });
  };

  const flipLive = async (): Promise<void> => {
    if (state === "live") return;
    if (flipInFlight) return await flipInFlight;
    flipInFlight = (async () => {
      console.log("Edits detected: routing every agent through the local-runtime tunnel");
      try {
        await reconcile(true);
        state = "live";
        console.log("All agents live on the tunnel (hot reload active)");
      } catch (error) {
        state = "deployed";
        console.error(`Tunnel flip failed: ${message(error)}`);
      }
    })();
    try {
      await flipInFlight;
    } finally {
      flipInFlight = undefined;
    }
  };

  const runPipeline = async (startedEpoch: number): Promise<void> => {
    const aborted = () => epoch !== startedEpoch;
    state = "publishing";
    try {
      console.log("Edits settled: verifying the project");
      await runChecked("pnpm", ["--filter", "openbot", "typecheck"], env);
      if (aborted()) return;
      console.log(`Publishing to ${SANDBOX_EDITS_BRANCH}`);
      await publishSandboxEdits(env);
      if (aborted()) return;
      console.log("Deploying agent services");
      await runProductionDeploy(["--service", "agents", "--yes"]);
      if (aborted()) return;
      state = "deployed";
      console.log("All agents back on deployed endpoints");
    } catch (error) {
      console.error(`Publish pipeline failed; agents stay on the tunnel: ${message(error)}`);
    } finally {
      if (state !== "deployed") state = "live";
    }
  };

  const onEdit = (path: string): void => {
    if (isIgnoredPath(path)) return;
    epoch += 1;
    void flipLive();
    if (settleTimer) clearTimeout(settleTimer);
    const startedEpoch = epoch;
    settleTimer = setTimeout(() => void runPipeline(startedEpoch), settleMs);
  };

  const watchers: FSWatcher[] = [];
  for (const directory of watchedDirectories) {
    const absolute = resolve(repositoryRoot, directory);
    try {
      const watcher = watch(absolute, { recursive: true }, (_event, filename) =>
        onEdit(filename ? resolve(absolute, filename.toString()) : absolute),
      );
      watcher.on("error", (error) => console.error(`Watcher error: ${message(error)}`));
      watchers.push(watcher);
    } catch {
      // Missing directories (e.g. a fork without apps/) are simply not watched.
    }
  }
  process.once("exit", () => {
    for (const watcher of watchers) watcher.close();
    if (settleTimer) clearTimeout(settleTimer);
    server.stop();
  });

  console.log(
    `Orchestrator ready: watching ${watchedDirectories.join(", ")} (settle ${settleMs / 1000}s)`,
  );
  await new Promise<void>((_resolve, reject) => {
    server.child.once("exit", (code) =>
      reject(new Error(`The agent service process exited with code ${code ?? "unknown"}`)),
    );
  });
  throw new Error("unreachable");
}

const executeFile = promisify(execFile);

/** Commit the working tree and push it to the sandbox-edits branch through the git proxy. */
async function publishSandboxEdits(env: NodeJS.ProcessEnv): Promise<void> {
  const git = (args: readonly string[]) =>
    executeFile("git", [...args], { cwd: repositoryRoot, env, encoding: "utf8" });
  const { stdout: status } = await git(["status", "--porcelain"]);
  if (status.trim()) {
    await git(["add", "--all"]);
    // The pipeline's verify stage is the gate; hooks would rewrite watched files mid-publish
    // and retrigger the orchestrator against its own deploy.
    await git(["commit", "--quiet", "--no-verify", "--message", "chore(live): sandbox edits"]);
  }
  await git(["push", "--force-with-lease", "origin", `HEAD:${SANDBOX_EDITS_BRANCH}`]);
}

function isIgnoredPath(path: string): boolean {
  const relativePath = relative(repositoryRoot, path);
  if (ignoredRepositoryPaths.has(relativePath.replaceAll(sep, "/"))) return true;
  return relativePath.split(sep).some((segment) => ignoredSegments.has(segment));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
