// Identifies the canonical OpenBot repository.
//
// Official publication targets belong to trytilde/dispatch. A fork inherits tracked
// configuration, so publication guards must live in code.
import { spawnSync } from "node:child_process";

export const upstreamRepository = "trytilde/dispatch";

/** `owner/name` for a remote, from either an SSH or HTTPS URL. Undefined when unknown. */
export function remoteRepository(cwd: string, remote = "origin"): string | undefined {
  const result = spawnSync("git", ["remote", "get-url", remote], { cwd, encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const url = result.stdout.trim();
  const matched = /(?:[:/])([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return matched?.[1];
}

export function isUpstreamRepository(cwd: string): boolean {
  return remoteRepository(cwd)?.toLowerCase() === upstreamRepository;
}
