// Launches the Electron shell for development.
//
// On a machine with a display this simply opens a window. On a display-less host —
// the remote Linux build box — Electron gets a virtual screen published over loopback
// VNC. Reach it with `openbot connect <host>`.
import { spawn } from "node:child_process";
import arg from "arg";
import { ensureVirtualScreen, ensureVncServer, hasNativeDisplay } from "../../virtual-display.js";
import { repositoryRoot } from "../../workspace.js";

export const desktopDisplayDefaults = { displayNumber: "2", vncPort: "5901" } as const;

export async function runDesktopDev(argv: readonly string[]): Promise<number> {
  const options = arg(
    { "--headless": Boolean, "--display": String, "--vnc-port": String },
    { argv: [...argv], permissive: true },
  );
  const displayNumber =
    options["--display"] ?? process.env.DESKTOP_DISPLAY ?? desktopDisplayDefaults.displayNumber;
  const vncPort =
    options["--vnc-port"] ?? process.env.DESKTOP_VNC_PORT ?? desktopDisplayDefaults.vncPort;
  // Explicit --headless wins so a Linux workstation with a display can still be tested.
  const headless = options["--headless"] || !hasNativeDisplay();

  const environment: Record<string, string> = {};
  if (headless) {
    environment.DISPLAY = await ensureVirtualScreen({
      displayNumber,
      vncPort,
      geometry: "1600x1000x24",
    });
    await ensureVncServer({ displayNumber, vncPort });
    console.log(
      `electron will render on :${displayNumber}; view it with openbot connect <host> (VNC ${vncPort})`,
    );
  }

  return spawnPnpm(["--filter", "@tryopenbot/desktop", "dev"], environment);
}

function spawnPnpm(args: readonly string[], environment: Record<string, string>): Promise<number> {
  const child = spawn("pnpm", [...args], {
    cwd: repositoryRoot(),
    stdio: "inherit",
    env: { ...process.env, ...environment },
  });
  return new Promise<number>((resolvePromise, rejectPromise) => {
    child.on("error", (error) =>
      rejectPromise(new Error(`Failed to start pnpm: ${error.message}`)),
    );
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolvePromise(code ?? 0);
    });
  });
}
