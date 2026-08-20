import { spawn, type ChildProcess } from "node:child_process";
import { repositoryRoot } from "./paths.js";

export function run(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): ChildProcess {
  return spawn(command, [...args], {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
}

export async function runChecked(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const child = run(command, args, env);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed${result.signal ? ` with ${result.signal}` : ` with exit code ${result.code ?? "unknown"}`}`,
    );
  }
}

export interface SupervisionOptions {
  onStop?: () => void | Promise<void>;
}

export async function superviseProcesses(
  children: readonly ChildProcess[],
  options: SupervisionOptions = {},
): Promise<number> {
  let stopping = false;
  let requestedStop = false;
  let cleanup: Promise<void> | undefined;
  const stop = () => {
    if (stopping) return cleanup!;
    stopping = true;
    cleanup = Promise.resolve(options.onStop?.()).then(() => undefined);
    for (const child of children) if (!child.killed) child.kill("SIGTERM");
    return cleanup;
  };
  const onInterrupt = () => {
    requestedStop = true;
    void stop();
  };
  const onTerminate = () => {
    requestedStop = true;
    void stop();
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);

  try {
    const result = await Promise.race(
      children.map(
        (child) =>
          new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", (code, signal) => resolve({ code, signal }));
          }),
      ),
    );
    await stop();
    return requestedStop ? 0 : (result.code ?? (result.signal ? 1 : 0));
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}

export async function supervise(
  children: readonly ChildProcess[],
  options: SupervisionOptions = {},
): Promise<never> {
  process.exit(await superviseProcesses(children, options));
}
