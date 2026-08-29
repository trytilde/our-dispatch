// Remote development hosts are fork-owned configuration, never package code:
// upstream tracks no host names, addresses, or paths. A fork describes its
// machines once in configuration/dev-hosts.json and every developer and
// sandboxed agent shares them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DevHost {
  /** ssh destination, e.g. "root@203.0.113.7" or an ~/.ssh/config alias. */
  ssh: string;
  platform: "linux" | "mac";
  /** Repository path on the host. Defaults to "~/openbot". */
  path?: string;
  /** Electron shell screen. */
  desktopVncPort?: number;
}

export const defaultPorts = { desktopVnc: 5901 } as const;

export function loadHosts(repositoryRoot: string): Record<string, DevHost> {
  const configPath = join(repositoryRoot, "configuration", "dev-hosts.json");
  if (!existsSync(configPath)) return {};
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
    hosts?: Record<string, DevHost>;
  };
  return parsed.hosts ?? {};
}

// A named host wins; anything else is treated as a raw ssh destination so
// `openbot connect user@203.0.113.7` needs no configuration at all.
export function resolveHost(nameOrSsh: string, hosts: Record<string, DevHost>): DevHost {
  const named = hosts[nameOrSsh];
  if (named) return named;
  if (!nameOrSsh || nameOrSsh.startsWith("-"))
    throw new Error(
      `Unknown host "${nameOrSsh}". Name one in configuration/dev-hosts.json or pass user@host.`,
    );
  return { ssh: nameOrSsh, platform: "linux" };
}
