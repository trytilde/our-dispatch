// Runs a graphical program on a host with no display: Xvfb owns a virtual screen and
// x11vnc exposes it on loopback only, so a remote developer reaches it through
// `openbot connect` rather than an open port.
//
// Used by the Electron desktop shell on a display-less Linux host.
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { toolchainEnvironment } from "./toolchain.js";

export interface VirtualDisplay {
  displayNumber: string;
  vncPort: string;
  geometry?: string;
}

export const processMatches = (pattern: string): boolean =>
  spawnSync("pgrep", ["-f", pattern], { stdio: "ignore" }).status === 0;

export function detach(
  command: string,
  args: readonly string[],
  overrides: Record<string, string> = {},
): void {
  const child = spawn(command, [...args], {
    detached: true,
    stdio: "ignore",
    env: toolchainEnvironment(overrides),
  });
  child.unref();
}

/** Starts Xvfb if it is not already up. Returns the DISPLAY value to use. */
export async function ensureVirtualScreen(display: VirtualDisplay): Promise<string> {
  const value = `:${display.displayNumber}`;
  if (processMatches(`Xvfb ${value}`)) return value;
  console.log(`starting Xvfb ${value}`);
  detach("Xvfb", [value, "-screen", "0", display.geometry ?? "1600x1000x24", "-nolisten", "tcp"]);
  await delay(2000);
  return value;
}

/** Publishes an existing virtual screen over VNC, bound to loopback only. */
export async function ensureVncServer(display: VirtualDisplay): Promise<void> {
  if (processMatches(`x11vnc .*-rfbport ${display.vncPort}`)) return;
  console.log(`starting x11vnc on 127.0.0.1:${display.vncPort}`);
  detach("x11vnc", [
    "-display",
    `:${display.displayNumber}`,
    // Loopback only. Reach it through `openbot connect`, never a public bind.
    "-localhost",
    "-rfbport",
    display.vncPort,
    "-shared",
    "-forever",
    "-nopw",
    "-quiet",
  ]);
  await delay(2000);
}

/** True when this host can show a window without a virtual screen. */
export function hasNativeDisplay(): boolean {
  return process.platform === "darwin" || Boolean(process.env.DISPLAY);
}
