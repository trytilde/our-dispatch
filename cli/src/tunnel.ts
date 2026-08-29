// Builds the ssh tunnel that makes a remote development host feel local.
// Everything on the remote binds loopback; the tunnel is the only path in.
import { defaultPorts, type DevHost } from "./hosts.js";

export interface TunnelOptions {
  desktop?: boolean;
}

export function tunnelArguments(host: DevHost, options: TunnelOptions = {}): string[] {
  const forwards: string[] = [];
  const forward = (port: number) => forwards.push("-L", `${port}:127.0.0.1:${port}`);
  if (options.desktop !== false) forward(host.desktopVncPort ?? defaultPorts.desktopVnc);
  return ["-N", ...forwards, host.ssh];
}

export function connectionHints(host: DevHost, options: TunnelOptions = {}): string[] {
  const hints: string[] = [];
  if (options.desktop !== false)
    hints.push(
      `desktop: open vnc://localhost:${host.desktopVncPort ?? defaultPorts.desktopVnc} for the Electron shell`,
    );
  return hints;
}
