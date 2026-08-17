import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Code, ConnectError } from "@connectrpc/connect";
import type { AgentCommand } from "./agent.js";

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface BackgroundExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  jobId: string;
  running: boolean;
}

interface BackgroundJobMetadata {
  readonly agentId: string;
  readonly jobId: string;
  readonly pid: number;
}

/**
 * Durable background command registry. Commands detach from computer-service and
 * write their own exit status beneath the persistent computer workspace.
 */
export class BackgroundExecRegistry {
  constructor(
    readonly stateRoot = process.env.BACKGROUND_JOBS_DIRECTORY ?? "/workspace/.openbot/jobs",
  ) {}

  async start(
    agentId: string,
    command: AgentCommand,
    timeoutMilliseconds: number,
  ): Promise<BackgroundExecResult> {
    const jobId = randomUUID();
    const directory = join(this.stateRoot, jobId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stdout = await open(join(directory, "stdout"), "a", 0o600);
    const stderr = await open(join(directory, "stderr"), "a", 0o600);
    const exitFile = join(directory, "exit-code");
    const timeout = timeoutMilliseconds > 0 ? [`${timeoutMilliseconds / 1_000}s`] : [];
    const script = timeout.length
      ? 'timeout --signal=TERM "$1" "${@:2}"; code=$?; printf "%s\\n" "$code" > "$JOB_EXIT_FILE"'
      : '"$@"; code=$?; printf "%s\\n" "$code" > "$JOB_EXIT_FILE"';
    const child = spawn(
      "/bin/bash",
      ["-c", script, "--", ...timeout, command.command, ...command.arguments],
      {
        cwd: command.cwd,
        detached: true,
        env: { ...command.environment, JOB_EXIT_FILE: exitFile },
        stdio: ["ignore", stdout.fd, stderr.fd],
      },
    );
    if (child.pid === undefined)
      throw new ConnectError("Could not start background shell job", Code.Internal);
    await writeFile(
      join(directory, "job.json"),
      JSON.stringify({ agentId, jobId, pid: child.pid } satisfies BackgroundJobMetadata),
      { mode: 0o600 },
    );
    child.unref();
    await stdout.close();
    await stderr.close();
    return { exitCode: 0, stdout: "", stderr: "", jobId, running: true };
  }

  async wait(
    agentId: string,
    jobId: string,
    timeoutMilliseconds: number,
    signal: AbortSignal,
  ): Promise<BackgroundExecResult> {
    const directory = join(this.stateRoot, jobId);
    const metadata = await loadMetadata(directory);
    if (!metadata || metadata.agentId !== agentId || metadata.jobId !== jobId) {
      throw new ConnectError("Background shell job not found", Code.NotFound);
    }
    const deadline = Date.now() + Math.max(0, timeoutMilliseconds);
    while (!signal.aborted) {
      const exitCode = await loadExitCode(directory);
      if (exitCode !== undefined) return output(directory, jobId, exitCode, false);
      if (!processRunning(metadata.pid))
        return output(
          directory,
          jobId,
          1,
          false,
          "Background process ended without recording its exit status",
        );
      if (timeoutMilliseconds <= 0 || Date.now() >= deadline)
        return output(directory, jobId, 0, true);
      await abortableDelay(Math.min(50, deadline - Date.now()), signal);
    }
    throw signal.reason ?? new Error("Request aborted");
  }
}

async function loadMetadata(directory: string): Promise<BackgroundJobMetadata | undefined> {
  try {
    const value = JSON.parse(
      await readFile(join(directory, "job.json"), "utf8"),
    ) as Partial<BackgroundJobMetadata>;
    if (
      typeof value.agentId === "string" &&
      typeof value.jobId === "string" &&
      typeof value.pid === "number"
    )
      return value as BackgroundJobMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return undefined;
}

async function loadExitCode(directory: string): Promise<number | undefined> {
  try {
    const value = Number.parseInt(
      (await readFile(join(directory, "exit-code"), "utf8")).trim(),
      10,
    );
    return Number.isSafeInteger(value) ? value : 1;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function output(
  directory: string,
  jobId: string,
  exitCode: number,
  running: boolean,
  appendedError = "",
): Promise<BackgroundExecResult> {
  const [stdout, stderr] = await Promise.all([
    readOutput(join(directory, "stdout")),
    readOutput(join(directory, "stderr")),
  ]);
  return {
    exitCode,
    stdout,
    stderr: appendedError
      ? `${stderr}${stderr && !stderr.endsWith("\n") ? "\n" : ""}${appendedError}`
      : stderr,
    jobId,
    running,
  };
}

async function readOutput(path: string): Promise<string> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_OUTPUT_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

function processRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, Math.max(0, milliseconds));
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new Error("Request aborted"));
    };
    function finish() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}
