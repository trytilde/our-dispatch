import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Code, ConnectError } from "@connectrpc/connect";

const desktopRoot = process.env.COMPUTER_DESKTOP_ROOT ?? "/workspace/.openbot/desktops";
const tokenFile = process.env.COMPUTER_VNC_TOKEN_FILE ?? "/opt/openbot/novnc.tokens";
const pending = new Map<string, Promise<AgentDesktop>>();
let capabilityWrite = Promise.resolve();
let desktopAllocation = Promise.resolve();

export interface AgentDesktop {
  display: string;
  vncPort: number;
}

export function agentDesktopEnvironment(agentId: string, desktop: AgentDesktop) {
  validateAgentId(agentId);
  const directory = join(desktopRoot, agentId);
  return {
    AGENT_ID: agentId,
    DISPLAY: desktop.display,
    HOME: directory,
    XDG_RUNTIME_DIR: join(directory, "runtime"),
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(directory, "runtime", "bus")}`,
  };
}

export async function ensureAgentDesktop(
  agentId: string,
  capability?: string,
  signal?: AbortSignal,
  requestId?: string,
): Promise<AgentDesktop> {
  validateAgentId(agentId);
  const current = pending.get(agentId);
  if (current) {
    logDesktop("awaiting pending desktop", { agentId, requestId });
    return current;
  }
  const created = ensureAgentDesktopNow(agentId, capability, signal, requestId).finally(() => {
    pending.delete(agentId);
  });
  pending.set(agentId, created);
  return created;
}

async function ensureAgentDesktopNow(
  agentId: string,
  capability?: string,
  signal?: AbortSignal,
  requestId?: string,
): Promise<AgentDesktop> {
  const directory = join(desktopRoot, agentId);
  const statePath = join(directory, "desktop.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const saved = await readDesktopState(statePath);
  if (saved && (await displayReady(saved.display))) {
    if (capability) await installCapability(capability, saved.vncPort);
    logDesktop("reused desktop", {
      agentId,
      display: saved.display,
      hasCapability: Boolean(capability),
      requestId,
      vncPort: saved.vncPort,
    });
    return saved;
  }

  const desktop = saved
    ? await startAndPersistDesktop(agentId, directory, statePath, saved, signal)
    : await serializeDesktopAllocation(async () => {
        const displayNumber = await allocateDisplay(agentId);
        logDesktop("allocated display", { agentId, display: `:${displayNumber}`, requestId });
        return await startAndPersistDesktop(
          agentId,
          directory,
          statePath,
          { display: `:${displayNumber}`, vncPort: 5900 + displayNumber },
          signal,
        );
      });
  if (capability) await installCapability(capability, desktop.vncPort);
  logDesktop("started desktop", {
    agentId,
    display: desktop.display,
    hasCapability: Boolean(capability),
    requestId,
    vncPort: desktop.vncPort,
  });
  return desktop;
}

function logDesktop(message: string, fields: Record<string, unknown>): void {
  if (!fields.requestId) return;
  console.info(`[openbot-vnc] ${message}`, fields);
}

async function startAndPersistDesktop(
  agentId: string,
  directory: string,
  statePath: string,
  desktop: AgentDesktop,
  signal?: AbortSignal,
): Promise<AgentDesktop> {
  await startDesktop(agentId, directory, desktop, signal);
  await writeJsonAtomically(statePath, desktop);
  return desktop;
}

async function serializeDesktopAllocation<T>(operation: () => Promise<T>): Promise<T> {
  const result = desktopAllocation.then(operation);
  desktopAllocation = result.then(
    () => undefined,
    () => undefined,
  );
  return await result;
}

async function allocateDisplay(agentId: string): Promise<number> {
  const used = new Set<number>();
  await mkdir(desktopRoot, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(desktopRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === agentId) continue;
    const state = await readDesktopState(join(desktopRoot, entry.name, "desktop.json"));
    if (state) used.add(Number(state.display.slice(1)));
  }
  for (let display = 10; display <= 99; display += 1) {
    if (!used.has(display) && !(await socketExists(display))) return display;
  }
  throw new ConnectError("No desktop display is available", Code.ResourceExhausted);
}

async function startDesktop(
  agentId: string,
  directory: string,
  desktop: AgentDesktop,
  signal?: AbortSignal,
): Promise<void> {
  const runtimeDirectory = join(directory, "runtime");
  const profileDirectory = join(directory, "browser-profile");
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 });

  const xServer = spawn(
    "Xvnc",
    [
      desktop.display,
      "-geometry",
      process.env.COMPUTER_GEOMETRY ?? "1440x810",
      "-depth",
      "24",
      "-SecurityTypes",
      "None",
      "-localhost",
      "yes",
    ],
    { detached: true, stdio: "ignore" },
  );
  xServer.once("error", () => undefined);
  xServer.unref();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    signal?.throwIfAborted();
    if (await displayReady(desktop.display)) break;
    await delay(250, undefined, { signal });
  }
  if (!(await displayReady(desktop.display)))
    throw new ConnectError(`Desktop ${desktop.display} did not start`, Code.Unavailable);

  const environment = {
    ...process.env,
    ...agentDesktopEnvironment(agentId, desktop),
    GTK_THEME: "Arc",
  };
  await ensureSessionBus(environment.DBUS_SESSION_BUS_ADDRESS, environment, signal);
  const session = spawn("/opt/openbot/desktop-session.sh", [], {
    detached: true,
    env: environment,
    stdio: "ignore",
  });
  session.once("error", () => undefined);
  session.unref();
}

async function ensureSessionBus(
  address: string,
  environment: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<void> {
  const busPath = address.slice("unix:path=".length);
  if (
    await commandSucceeds("dbus-send", [
      `--address=${address}`,
      "--type=method_call",
      "--dest=org.freedesktop.DBus",
      "/",
      "org.freedesktop.DBus.ListNames",
    ])
  )
    return;
  await rm(busPath, { force: true });
  await commandCompletes(
    "dbus-daemon",
    ["--session", "--fork", `--address=${address}`, "--nopidfile"],
    environment,
    signal,
  );
}

async function installCapability(capability: string, vncPort: number): Promise<void> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(capability))
    throw new ConnectError("Desktop capability is invalid", Code.InvalidArgument);
  const write = capabilityWrite.then(async () => {
    let lines: string[] = [];
    try {
      lines = (await readFile(tokenFile, "utf8")).split("\n").filter(Boolean);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const suffix = ` localhost:${vncPort}`;
    const next = [
      ...lines.filter((line) => !line.endsWith(suffix) && !line.startsWith(`${capability}:`)),
      `${capability}: localhost:${vncPort}`,
    ];
    await writeFile(tokenFile, `${next.join("\n")}\n`, { mode: 0o600 });
  });
  capabilityWrite = write.catch(() => undefined);
  await write;
}

async function readDesktopState(path: string): Promise<AgentDesktop | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<AgentDesktop>;
    if (
      typeof value.display === "string" &&
      /^:[1-9][0-9]?$/.test(value.display) &&
      typeof value.vncPort === "number" &&
      value.vncPort === 5900 + Number(value.display.slice(1))
    ) {
      return value as AgentDesktop;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
  }
  return undefined;
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function displayReady(display: string): Promise<boolean> {
  return await commandSucceeds("xdpyinfo", ["-display", display]);
}

async function socketExists(display: number): Promise<boolean> {
  try {
    await access(`/tmp/.X11-unix/X${display}`);
    return true;
  } catch {
    return false;
  }
}

function commandSucceeds(command: string, arguments_: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, arguments_, { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

function commandCompletes(
  command: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { env: environment, signal, stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new ConnectError(`${command} exited with code ${code}`, Code.Unavailable)),
    );
  });
}

function validateAgentId(agentId: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(agentId))
    throw new ConnectError("A valid agent_id is required", Code.InvalidArgument);
}
