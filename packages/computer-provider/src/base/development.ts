import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { ComputerSeedFile } from "../core/index.js";

const sandboxConfigurationPaths = [
  "configuration/.env",
  "configuration/.sops.yaml",
  "configuration/secrets.enc.yaml",
] as const;

const execute = promisify(execFile);

/** Capture tracked and non-ignored source without copying plaintext local environment files. */
export async function developmentSandboxSourceFiles(
  repositoryRoot: string,
): Promise<readonly ComputerSeedFile[]> {
  const { stdout } = await execute(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const paths = stdout.split("\0").filter(Boolean).filter(isSafeDevelopmentSourcePath).sort();
  const files = await Promise.all(
    paths.map(async (path) => {
      const source = resolve(repositoryRoot, path);
      const metadata = await lstat(source).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!metadata) return undefined;
      if (!metadata.isFile())
        throw new Error(`Development sandbox source must be a regular file: ${path}`);
      return {
        path: `openbot/${path}`,
        content: new Uint8Array(await readFile(source)),
        ...(metadata.mode & 0o111 ? { executable: true } : {}),
      };
    }),
  );
  return files.filter((file) => file !== undefined);
}

/** Files refreshed on every trusted-sandbox deployment, including ignored local configuration. */
export async function developmentSandboxConfigurationFiles(
  repositoryRoot: string,
): Promise<readonly ComputerSeedFile[]> {
  return Promise.all(
    sandboxConfigurationPaths.map(async (path) => {
      const source = resolve(repositoryRoot, path);
      const metadata = await lstat(source);
      if (!metadata.isFile())
        throw new Error(`Development sandbox configuration must be a regular file: ${path}`);
      return {
        path: `openbot/${path}`,
        content: new Uint8Array(await readFile(source)),
      };
    }),
  );
}

function isSafeDevelopmentSourcePath(path: string): boolean {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "..")
  )
    return false;
  if (path === ".env" || path.endsWith("/.env") || /(?:^|\/)\.env\.(?!example$)/.test(path))
    return false;
  if (path === "configuration/secrets.yaml") return false;
  const parts = path.split("/");
  return (
    !path.startsWith(".openbot-deploy/") &&
    !parts.includes("node_modules") &&
    !parts.includes("dist")
  );
}
