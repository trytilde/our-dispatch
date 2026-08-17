#!/usr/bin/env node

import React, { type ReactElement } from "react";
import { render } from "ink";
import { redact } from "./commands/deploy.js";
import { parseInvocation, runCommand } from "./commands/index.js";
import { cliFailureDetails, createCliRunLog, type CliRunLog } from "./logging.js";
import { runWithTypeScriptLoader } from "./typescript-loader.js";
import { CommandMenu, Failure } from "./ui.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((value) => value !== "--");
  const invocation =
    argv.length === 0 && process.stdin.isTTY && process.stdout.isTTY
      ? { command: await interactiveCommand(), rest: [] }
      : parseInvocation(argv);
  if (!invocation.command) return;
  await runCommand(invocation.command, invocation.rest);
}

async function interactiveCommand(): Promise<string> {
  let selected = "";
  const app = render(
    <CommandMenu
      onSelect={(command) => {
        selected = command;
      }}
    />,
    { alternateScreen: true },
  );
  await app.waitUntilExit();
  return selected;
}

function show(view: ReactElement): void {
  const app = render(view);
  app.unmount();
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function runLoggedCli(): Promise<void> {
  if (isHelpInvocation(process.argv.slice(2))) {
    await main();
    return;
  }
  const secrets = sensitiveEnvironmentValues(process.env);
  const log = await createCliRunLog({ redact: (value) => redact(value, secrets) });
  const restoreConsole = log.installConsoleCapture();
  const monitorError = (error: Error, origin: NodeJS.UncaughtExceptionOrigin) =>
    log.writeError(error, `Uncaught exception (${origin})`);
  const recordWarning = (warning: Error) => log.writeError(warning, "Process warning");
  let failureReferenced = false;
  const closeLog = (code: number) => {
    if (code !== 0 && !failureReferenced) referenceUnexpectedExit(log);
    log.close();
  };
  process.on("uncaughtExceptionMonitor", monitorError);
  process.on("warning", recordWarning);
  process.once("exit", closeLog);

  try {
    await main();
  } catch (error) {
    log.writeError(error, "Command failed");
    showFailure(error, log);
    failureReferenced = true;
    process.exitCode = 1;
  } finally {
    process.off("uncaughtExceptionMonitor", monitorError);
    process.off("warning", recordWarning);
    process.off("exit", closeLog);
    if ((process.exitCode ?? 0) !== 0 && !failureReferenced) referenceUnexpectedExit(log);
    restoreConsole();
    log.close();
  }
}

function isHelpInvocation(argv: readonly string[]): boolean {
  const values = argv.filter((value) => value !== "--");
  return values[0] === "help" || values.includes("--help") || values.includes("-h");
}

function referenceUnexpectedExit(log: CliRunLog): void {
  if (process.argv.includes("--json"))
    printJson({ error: "Command exited unsuccessfully", log: log.path });
  else process.stderr.write(`OpenBot exited unsuccessfully. Full details: ${log.path}\n`);
}

function showFailure(error: unknown, log: CliRunLog): void {
  const secrets = sensitiveEnvironmentValues(process.env);
  const failure = cliFailureDetails(error, (value) => redact(value, secrets));
  if (process.argv.includes("--json"))
    printJson({ error: failure.message, stack: failure.stack, log: log.path });
  else show(<Failure message={failure.message} stack={failure.stack} logPath={log.path} />);
}

function sensitiveEnvironmentValues(environment: NodeJS.ProcessEnv): string[] {
  return Object.entries(environment)
    .filter(
      ([name, value]) =>
        value &&
        value.length >= 8 &&
        /(api[_-]?key|credential|password|private[_-]?key|secret|token)/i.test(name),
    )
    .map(([, value]) => value!);
}

runWithTypeScriptLoader(runLoggedCli).catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`OpenBot CLI failed before logging could start:\n${message}\n`);
  process.exitCode = 1;
});
