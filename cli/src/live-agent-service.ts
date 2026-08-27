import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const liveAgentServiceStatePath = ".cache/live-agent-service.json";

interface LiveAgentServiceState {
  origin: string;
  pid: number;
}

/** Publish the tunnel owned by the currently running development lifecycle. */
export async function writeLiveAgentServiceOrigin(
  repositoryRoot: string,
  origin: string,
): Promise<void> {
  const state = liveAgentServiceState(origin, process.pid);
  const destination = resolve(repositoryRoot, liveAgentServiceStatePath);
  const temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(resolve(repositoryRoot, ".cache"), { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
}

/** Return only a live process-owned tunnel, never a stale persisted deployment origin. */
export async function readLiveAgentServiceOrigin(
  repositoryRoot: string,
): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(resolve(repositoryRoot, liveAgentServiceStatePath), "utf8"),
    ) as Partial<LiveAgentServiceState>;
    if (typeof parsed.origin !== "string" || typeof parsed.pid !== "number") return undefined;
    const state = liveAgentServiceState(parsed.origin, parsed.pid);
    if (!processIsAlive(state.pid)) return undefined;
    return state.origin;
  } catch {
    return undefined;
  }
}

/** Remove this lifecycle's state without deleting a newer process's replacement. */
export async function clearLiveAgentServiceOrigin(repositoryRoot: string): Promise<void> {
  const path = resolve(repositoryRoot, liveAgentServiceStatePath);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<LiveAgentServiceState>;
    if (parsed.pid === process.pid) await unlink(path);
  } catch {
    // Missing or concurrently replaced state needs no cleanup.
  }
}

function liveAgentServiceState(origin: string, pid: number): LiveAgentServiceState {
  const url = new URL(origin);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`Invalid live agent service origin: ${origin}`);
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw new Error(`Invalid live agent service PID: ${pid}`);
  return { origin: url.toString().replace(/\/$/, ""), pid };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
