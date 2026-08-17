import { closeSync, openSync, writeSync } from "node:fs";
import { chmod, lstat, mkdir, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { randomUUID } from "node:crypto";

const logRetentionMilliseconds = 3 * 24 * 60 * 60 * 1_000;

type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

export type CliRunLog = {
  readonly path: string;
  close(): void;
  installConsoleCapture(): () => void;
  write(level: string, ...values: unknown[]): void;
  writeError(error: unknown, context?: string): void;
};

export interface CliFailureDetails {
  message: string;
  stack: string;
}

/** Build the same redacted, cause-aware failure details for terminal and JSON output. */
export function cliFailureDetails(
  error: unknown,
  redact: (value: string) => string = (value) => value,
): CliFailureDetails {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    message: redact(normalized.message),
    stack: redact(errorStackWithCauses(normalized)),
  };
}

export async function createCliRunLog({
  homeDirectory = homedir(),
  now = Date.now(),
  randomId = randomUUID(),
  redact = (value) => value,
}: {
  homeDirectory?: string;
  now?: number;
  randomId?: string;
  redact?: (value: string) => string;
} = {}): Promise<CliRunLog> {
  const directory = join(homeDirectory, ".openbot", "logs");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await removeExpiredLogs(directory, now);

  const path = join(directory, `${randomId}.log`);
  const descriptor = openSync(path, "wx", 0o600);
  let closed = false;
  const writeLine = (level: string, values: readonly unknown[]) => {
    if (closed) return;
    const message = redact(values.map(formatLogValue).join(" "));
    writeSync(descriptor, `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`);
  };

  const log: CliRunLog = {
    path,
    close() {
      if (closed) return;
      writeLine("system", ["CLI run finished", `exitCode=${process.exitCode ?? 0}`]);
      closed = true;
      closeSync(descriptor);
    },
    installConsoleCapture() {
      const originals = new Map<ConsoleMethod, (...values: unknown[]) => void>();
      for (const method of ["debug", "error", "info", "log", "warn"] as const) {
        const original = console[method].bind(console);
        originals.set(method, original);
        console[method] = (...values: unknown[]) => {
          writeLine(
            method,
            method === "error" && !values.some((value) => value instanceof Error)
              ? [new Error(values.map(formatLogValue).join(" "))]
              : values,
          );
          // Debug and info are instrumentation. Keep them in the run log instead of
          // disturbing Ink's terminal UI; explicit operator output uses log/warn/error.
          if (method !== "debug" && method !== "info") original(...values);
        };
      }
      return () => {
        for (const [method, original] of originals) console[method] = original;
      };
    },
    write(level, ...values) {
      writeLine(level, values);
    },
    writeError(error, context) {
      const detail = error instanceof Error ? error : new Error(formatLogValue(error));
      writeLine("error", [...(context ? [context] : []), detail]);
    },
  };

  log.write("system", "OpenBot CLI run started", {
    command: process.argv[2] ?? "interactive",
    cwd: process.cwd(),
    node: process.version,
    pid: process.pid,
    platform: process.platform,
  });
  return log;
}

async function removeExpiredLogs(directory: string, now: number): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.name.endsWith(".log")) return;
      const path = join(directory, entry.name);
      try {
        const status = await lstat(path);
        if (status.isFile() && now - status.mtimeMs > logRetentionMilliseconds) await unlink(path);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;
      }
    }),
  );
}

function formatLogValue(value: unknown): string {
  if (value instanceof Error) return errorStackWithCauses(value);
  if (typeof value === "string") return value;
  return inspect(value, {
    breakLength: 120,
    colors: false,
    depth: 10,
    maxArrayLength: 100,
  });
}

function errorStackWithCauses(error: Error): string {
  const stacks: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    stacks.push(current.stack ?? `${current.name}: ${current.message}`);
    current = current.cause;
  }
  if (current !== undefined && !seen.has(current)) stacks.push(formatLogValue(current));
  return stacks.join("\nCaused by:\n");
}
