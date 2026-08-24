import { spawn } from "node:child_process";
import { relative } from "node:path";
import arg from "arg";
import type { ReactElement } from "react";
import { render } from "ink";
import { markDiagnosticExit } from "../diagnostics.js";
import { repositoryRoot } from "../paths.js";
import { Help, Success } from "../ui.js";
import { runProductionDeploy } from "./deploy.js";
import { runDevelopment } from "./dev.js";
import { runEnvironment } from "./env.js";
import { runInitialization } from "./init.js";
import { runNewAgent } from "./new-agent.js";
import { runOrchestrator } from "./orchestrate.js";
import { runSecrets } from "./secrets.js";
import { runDevelopmentServer } from "./serve.js";
import { runConnect } from "./connect.js";
import { runDesktop } from "./desktop/index.js";
import { runMobile } from "./mobile/index.js";
import { runRemote } from "./remote.js";
import { runTildeCommand } from "./tilde.js";
import { runTildePlugin } from "./plugin.js";
import { runSdk } from "./sdk.js";

export interface CliInvocation {
  command: string;
  rest: string[];
}

export function parseInvocation(argv: readonly string[]): CliInvocation {
  const parsed = arg(
    {
      "--help": Boolean,
      "-h": "--help",
    },
    {
      argv: argv.filter((value) => value !== "--"),
      stopAtPositional: true,
    },
  );
  if (parsed["--help"]) return { command: "help", rest: [] };
  const [command = "help", ...rest] = parsed._;
  return { command, rest };
}

export async function runCommand(command: string, args: readonly string[]): Promise<void> {
  if (["help", "--help", "-h"].includes(command)) return show(<Help />);
  if (command === "init") {
    const result = await runInitialization(args);
    if (result.kind === "help") {
      process.stdout.write(`${JSON.stringify(result.schema, null, 2)}\n`);
      return;
    }
    if (result.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, command: "init", mode: result.mode, repository: repositoryRoot })}\n`,
      );
      return;
    }
    return show(<Success title="OpenBot configuration initialized" />);
  }
  if (command === "new-agent") {
    const result = await runNewAgent(args);
    const { agent } = result;
    const agentPath = relative(repositoryRoot, agent.directory).replaceAll("\\", "/");
    if (result.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, command: "new-agent", agent: { id: agent.id, name: agent.name }, path: agentPath })}\n`,
      );
      return;
    }
    return show(<Success title={`Agent ${agent.name} created at ${agentPath}`} />);
  }
  if (command === "dev") {
    rejectArguments(command, args);
    if (process.stdout.isTTY) show(<Success title="Starting OpenBot development" />);
    return runDevelopment();
  }
  if (command === "orchestrate") {
    rejectArguments(command, args);
    return runOrchestrator();
  }
  if (command === "_serve") {
    rejectArguments(command, args);
    return runDevelopmentServer();
  }
  if (command === "deploy") return runProductionDeploy(args);
  if (command === "secrets") {
    const result = await runSecrets(args);
    if (result.json)
      process.stdout.write(
        `${JSON.stringify({ ok: true, command: "secrets", operation: result.operation, name: result.name })}\n`,
      );
    return;
  }
  if (command === "env") {
    const result = await runEnvironment(args);
    if (result.json)
      process.stdout.write(
        `${JSON.stringify({ ok: true, command: "env", operation: result.operation, name: result.name })}\n`,
      );
    return;
  }
  if (command === "auth" || command === "state" || command === "tunnel")
    return runTildeCommand(command, args);
  if (command === "plugin") return reportedExit(await runTildePlugin(args));
  if (command === "sdk") return runSdk(args);
  if (command === "check" || command === "build" || command === "test")
    return delegate(command, args);
  if (command === "e2e") return delegate("test:e2e", args);
  if (command === "desktop") return reportedExit(await runDesktop(args));
  // These delegate to a child with inherited stdio, or print their own explanation.
  // A non-zero result is therefore already reported, so the run-log crash notice
  // would only point at a log holding nothing but the run's start and finish.
  if (command === "mobile") return reportedExit(await runMobile(args));
  if (command === "connect") return reportedExit(await runConnect(args));
  if (command === "remote") return reportedExit(await runRemote(args));
  throw new Error(`Unknown command: ${[command, ...args].join(" ")}`);
}

function reportedExit(code: number): void {
  if (code === 0) return;
  process.exitCode = code;
  markDiagnosticExit();
}

function rejectArguments(command: string, args: readonly string[]): void {
  if (args.length) throw new Error(`Unknown ${command} option: ${args.join(", ")}`);
}

function show(view: ReactElement): void {
  const app = render(view);
  app.unmount();
}

async function delegate(script: string, args: readonly string[]): Promise<void> {
  if (process.stdout.isTTY) show(<Success title={`Starting pnpm ${script}`} />);
  return spawnPnpm([script, ...args]);
}

// Package-filtered delegation for workflows that are not root scripts.
async function delegateFilter(
  packageName: string,
  script: string,
  args: readonly string[],
): Promise<void> {
  return spawnPnpm(["--filter", packageName, script, ...args]);
}

async function spawnPnpm(pnpmArguments: readonly string[]): Promise<void> {
  const child = spawn("pnpm", [...pnpmArguments], {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: { ...process.env, NODE_OPTIONS: undefined },
  });
  const code = await new Promise<number>((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => resolveCode(value ?? 1));
  });
  reportedExit(code);
}
