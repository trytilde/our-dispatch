import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import React, { type ReactElement } from "react";
import { createDatabase, agentPublications, agentRegistrations, skillRegistrations } from "@openbot/db";
import { render, Text } from "ink";
import config from "../openbot.config.js";
import { loadRepository } from "../apps/server/src/repository.js";
import { providerStatuses } from "../apps/server/src/provider-registry.js";
import { reconcileRepository } from "../apps/server/src/reconcile.js";
import { agentSource, publishAgent } from "../apps/server/src/publishing.js";
import { CommandMenu, DoctorResult, Failure, Help, Progress, ProviderTable, RepositorySummary, StatusResult, Success, SyncResult, type RepositoryCounts } from "./openbot-ui.js";

export interface CliInvocation { command: string; rest: string[] }

export function parseInvocation(argv: readonly string[]): CliInvocation {
  const values = argv.filter((value) => value !== "--");
  return { command: values[0] ?? "help", rest: values.slice(1) };
}

export function wantsJson(args: readonly string[]): boolean {
  return args.includes("--json");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((value) => value !== "--");
  const invocation = argv.length === 0 && process.stdin.isTTY && process.stdout.isTTY
    ? { command: await interactiveCommand(), rest: [] }
    : parseInvocation(argv);
  if (!invocation.command) return;
  if (["help", "--help", "-h"].includes(invocation.command)) return show(<Help />);
  if (invocation.command === "setup") return setup(invocation.rest);
  if (invocation.command === "generate") return delegate("openbot:generate", invocation.rest);
  if (invocation.command === "dev") return delegate("dev", invocation.rest);
  if (invocation.command === "deploy") return delegate("deploy:prod", invocation.rest);
  if (invocation.command === "check") return check(invocation.rest);
  if (invocation.command === "doctor") return doctor(invocation.rest);
  if (invocation.command === "sync") return sync(invocation.rest);
  if (invocation.command === "status") return status(invocation.rest);
  if (invocation.command === "providers") return providers(invocation.rest);
  if (invocation.command === "agent" && invocation.rest[0] === "create") return createAgent(invocation.rest.slice(1));
  throw new Error(`Unknown command: ${[invocation.command, ...invocation.rest].join(" ")}`);
}

async function interactiveCommand(): Promise<string> {
  let selected = "";
  const app = render(<CommandMenu onSelect={(command) => { selected = command; }} />, { alternateScreen: true });
  await app.waitUntilExit();
  return selected;
}

async function setup(rest: readonly string[]): Promise<void> {
  const directories = [config.agents.directory, config.providers.directory, config.skills.directory, config.sandbox.assetsDirectory];
  await withProgress("Preparing repository directories", () => Promise.all(directories.map((directory) => mkdir(resolve(directory), { recursive: true }))));
  const result = { directories, next: "Configure .env, then run `pnpm openbot doctor` and `pnpm openbot dev`." };
  if (wantsJson(rest)) return printJson(result);
  show(<Success title="Repository directories are ready"><TextLines lines={[...directories, result.next]} /></Success>);
}

async function check(rest: readonly string[]): Promise<void> {
  const repository = await withProgress("Validating repository configuration", loadRepository);
  const summary = repositorySummary(repository);
  if (wantsJson(rest)) return printJson(summary);
  show(<RepositorySummary repository={summary} />);
}

async function doctor(rest: readonly string[]): Promise<void> {
  const [repository, statuses] = await withProgress("Checking configuration and providers", () => Promise.all([loadRepository(), providerStatuses()]));
  const output = { repository: repositorySummary(repository), providers: statuses };
  if (wantsJson(rest)) return printJson(output);
  show(<DoctorResult repository={output.repository} providers={statuses} />);
}

async function providers(rest: string[]): Promise<void> {
  const args = rest.filter((value) => value !== "--json");
  if ((args[0] ?? "list") !== "list") throw new Error("Use `pnpm openbot providers list`");
  const statuses = await withProgress("Inspecting providers", providerStatuses);
  if (wantsJson(rest)) return printJson(statuses);
  show(<ProviderTable providers={statuses} />);
}

async function sync(rest: string[]): Promise<void> {
  const prune = rest.includes("--prune");
  if (prune && !rest.includes("--yes")) throw new Error("--prune disables removed remote agents and requires --yes");
  const report = await withProgress("Synchronizing agents and skills", () => reconcileRepository({ prune }));
  if (wantsJson(rest)) printJson(report);
  else show(<SyncResult report={report} />);
  if (report.errors.length) process.exitCode = 1;
}

async function status(rest: readonly string[]): Promise<void> {
  const db = createDatabase();
  const result = await withProgress("Loading repository registrations", async () => {
    const [agents, skills, publications] = await Promise.all([db.select().from(agentRegistrations), db.select().from(skillRegistrations), db.select().from(agentPublications)]);
    return { agents, skills, publications };
  });
  if (wantsJson(rest)) return printJson(result);
  show(<StatusResult {...result} />);
}

async function createAgent(rest: string[]): Promise<void> {
  const id = option(rest, "--id");
  const displayName = option(rest, "--name");
  const description = option(rest, "--description");
  if (!id || !displayName) throw new Error("agent create requires --id and --name");
  const input = { id, displayName, ...(description ? { description } : {}) };
  if (rest.includes("--publish")) {
    const publication = await withProgress(`Publishing ${id}`, () => publishAgent(input));
    if (wantsJson(rest)) return printJson(publication);
    show(<Success title={`Published ${displayName}`}><TextLines lines={[`Agent: ${id}`, "A pull request and deployment have been requested."]} /></Success>);
    return;
  }
  const repository = await withProgress("Loading repository configuration", loadRepository);
  const target = resolve(repository.config.agents.directory, `${id}.ts`);
  await writeFile(target, agentSource(input), { encoding: "utf8", flag: "wx" });
  const result = { id, path: target };
  if (wantsJson(rest)) return printJson(result);
  show(<Success title={`Created ${displayName}`}><TextLines lines={[target, "Review it, run `pnpm openbot check`, then commit it."]} /></Success>);
}

function TextLines({ lines }: { lines: readonly string[] }) {
  return <>{lines.map((line) => <Text key={line}>{line}</Text>)}</>;
}

function repositorySummary(repository: Awaited<ReturnType<typeof loadRepository>>): RepositoryCounts {
  return { digest: repository.digest, agents: repository.agents.length, skills: repository.skills.length, providers: repository.providerPlugins.length };
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function show(view: ReactElement): void {
  const app = render(view);
  app.unmount();
}

async function withProgress<T>(label: string, action: () => Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) return action();
  const app = render(<Progress label={label} />);
  try {
    return await action();
  } finally {
    app.clear();
    app.unmount();
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function delegate(script: string, args: readonly string[]): Promise<void> {
  if (process.stdout.isTTY) show(<Success title={`Starting pnpm ${script}`} />);
  const child = spawn("pnpm", [script, ...args], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: undefined } });
  const code = await new Promise<number>((resolveCode, reject) => { child.once("error", reject); child.once("exit", (value) => resolveCode(value ?? 1)); });
  if (code) process.exitCode = code;
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv.includes("--json")) printJson({ error: message });
  else show(<Failure message={message} />);
  process.exitCode = 1;
});
