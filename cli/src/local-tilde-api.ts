// # DO NOT UPSTREAM
// #reason: Fork-only integration with the private trytilde/api submodule and its make dev workflow.
import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { repositoryRoot } from "./paths.js";

const localTildeApiPath = "third-party/tilde-api";
const localTildeApiStartupTimeoutMs = 15 * 60 * 1_000;

export interface LocalTildeApiOptions {
  tildeBaseUrl?: string;
}

export function defaultLocalTildeApiOrigin(platform = process.platform): string {
  return platform === "darwin" ? "https://api.tilde.test:8443" : "https://api.tilde.test";
}

export function parseLocalTildeApiOptions(args: readonly string[]): LocalTildeApiOptions {
  const options: LocalTildeApiOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--local-tilde-api") {
      const candidate = args[index + 1];
      if (candidate && !candidate.startsWith("-")) {
        options.tildeBaseUrl = normalizeLocalTildeApiOrigin(candidate);
        index += 1;
      } else options.tildeBaseUrl = defaultLocalTildeApiOrigin();
      continue;
    }
    if (argument?.startsWith("--local-tilde-api=")) {
      options.tildeBaseUrl = normalizeLocalTildeApiOrigin(
        argument.slice("--local-tilde-api=".length),
      );
      continue;
    }
    throw new Error(`Unknown dev option: ${argument}`);
  }
  return options;
}

export function localTildeApiEnvironment(
  environment: NodeJS.ProcessEnv,
  options: LocalTildeApiOptions,
): NodeJS.ProcessEnv {
  return options.tildeBaseUrl
    ? { ...environment, TILDE_BASE_URL: options.tildeBaseUrl }
    : environment;
}

export function normalizeLocalTildeApiOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid local Tilde API origin: ${value}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(`Local Tilde API must be an HTTP(S) origin: ${value}`);
  // trytilde/api's make dev target serves TLS directly. Accept the familiar HTTP spelling while
  // targeting the listener it actually starts.
  if (url.protocol === "http:") url.protocol = "https:";
  return url.origin;
}

export function localTildeApiMakeArguments(origin: string): string[] {
  const url = new URL(origin);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return ["dev", `DEV_API_PORT=${port}`, `DEV_API_ORIGIN=${url.origin}`];
}

export function localTildeApiSubmoduleArguments(): string[] {
  return ["submodule", "update", "--init", "--depth", "1", "--", localTildeApiPath];
}

export async function prepareLocalTildeApi(
  options: LocalTildeApiOptions,
): Promise<ChildProcess | undefined> {
  if (!options.tildeBaseUrl) return undefined;
  const apiRoot = resolve(repositoryRoot, localTildeApiPath);
  await ensureLocalTildeApiSubmodule(apiRoot);
  if (await localTildeApiIsListening(options.tildeBaseUrl)) {
    console.log(`Tilde API: using ${options.tildeBaseUrl}`);
    return undefined;
  }

  console.log(`Tilde API: starting make dev in ${localTildeApiPath}`);
  const child = spawn("make", localTildeApiMakeArguments(options.tildeBaseUrl), {
    cwd: apiRoot,
    env: process.env,
    stdio: "inherit",
  });
  try {
    await waitForLocalTildeApi(options.tildeBaseUrl, child);
  } catch (error) {
    if (!child.killed) child.kill("SIGTERM");
    throw error;
  }
  console.log(`Tilde API: ready at ${options.tildeBaseUrl}`);
  return child;
}

async function ensureLocalTildeApiSubmodule(apiRoot: string): Promise<void> {
  try {
    await access(resolve(apiRoot, "Makefile"));
    return;
  } catch {
    console.log(`Tilde API: initializing private submodule ${localTildeApiPath}`);
  }
  await runCheckedInRepository("git", localTildeApiSubmoduleArguments());
  try {
    await access(resolve(apiRoot, "Makefile"));
  } catch {
    throw new Error(
      `The private ${localTildeApiPath} submodule is unavailable; verify GitHub access to trytilde/api`,
    );
  }
}

async function runCheckedInRepository(
  command: string,
  arguments_: readonly string[],
): Promise<void> {
  const child = spawn(command, [...arguments_], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  const result = await childResult(child);
  if (result.code !== 0)
    throw new Error(
      `${command} ${arguments_.join(" ")} failed${result.signal ? ` with ${result.signal}` : ` with exit code ${result.code ?? "unknown"}`}`,
    );
}

async function waitForLocalTildeApi(origin: string, child: ChildProcess): Promise<void> {
  let childResultValue: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let childError: Error | undefined;
  void childResult(child).then(
    (result) => (childResultValue = result),
    (error: unknown) => {
      childError = error instanceof Error ? error : new Error(String(error));
    },
  );
  const deadline = Date.now() + localTildeApiStartupTimeoutMs;
  while (Date.now() < deadline) {
    if (await localTildeApiIsListening(origin)) return;
    if (childError) throw childError;
    if (childResultValue)
      throw new Error(
        `make dev exited before ${origin} became available${childResultValue.signal ? ` with ${childResultValue.signal}` : ` with exit code ${childResultValue.code ?? "unknown"}`}`,
      );
    await delay(500);
  }
  throw new Error(`Timed out waiting for the local Tilde API at ${origin}`);
}

function childResult(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });
}

export async function localTildeApiIsListening(origin: string): Promise<boolean> {
  const url = new URL(origin);
  const port = Number(url.port || (url.protocol === "https:" ? "443" : "80"));
  return await new Promise<boolean>((resolvePromise) => {
    const socket = createConnection({ host: url.hostname, port });
    let settled = false;
    const finish = (listening: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(listening);
    };
    socket.setTimeout(750);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}
// #END DO NOT UPSTREAM
