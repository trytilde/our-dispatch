import { spawn } from "node:child_process";

const loaderEnvironment = "OPENBOT_CLI_TYPESCRIPT_LOADER";

/** Re-exec the standalone CLI with tsx so generated .js specifiers resolve TypeScript files. */
export async function runWithTypeScriptLoader(run: () => Promise<void>): Promise<void> {
  if (typescriptLoaderIsActive()) {
    await run();
    return;
  }
  const entrypoint = process.argv[1];
  if (!entrypoint) throw new Error("OpenBot CLI entrypoint is unavailable");
  const child = spawn(
    process.execPath,
    [
      "--conditions=development",
      "--import",
      import.meta.resolve("tsx"),
      entrypoint,
      ...process.argv.slice(2),
    ],
    {
      env: { ...process.env, [loaderEnvironment]: "1" },
      stdio: "inherit",
    },
  );
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  process.exitCode = result.code ?? (result.signal ? 1 : 0);
}

function typescriptLoaderIsActive(): boolean {
  if (process.env[loaderEnvironment] === "1") {
    delete process.env[loaderEnvironment];
    return true;
  }
  return process.execArgv.some(
    (argument, index, arguments_) =>
      (arguments_[index - 1] === "--import" || argument.startsWith("--import=")) &&
      argument.includes("tsx"),
  );
}
