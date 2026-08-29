// Keeps child processes on the real Node binary rather than a stale version-manager shim.
import { dirname } from "node:path";

export function toolchainEnvironment(
  overrides: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const path = [dirname(process.execPath), base.PATH].filter(Boolean).join(":");
  return { ...base, PATH: path, ...overrides };
}
