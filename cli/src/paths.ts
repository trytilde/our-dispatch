import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function resolveRepositoryRoot(
  currentDirectory: string,
  initialDirectory?: string,
  explicitDirectory?: string,
): string {
  if (explicitDirectory) return resolve(explicitDirectory);
  const invocationDirectory = resolve(initialDirectory ?? currentDirectory);
  return findOpenBotWorkspaceRoot(invocationDirectory) ?? invocationDirectory;
}

function findOpenBotWorkspaceRoot(startDirectory: string): string | undefined {
  let directory = startDirectory;
  while (true) {
    try {
      const manifest = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8")) as {
        name?: unknown;
      };
      if (manifest.name === "@tryopenbot/workspace") return directory;
    } catch {
      // Keep looking: standalone init also starts in a directory without a package manifest.
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export const repositoryRoot = resolveRepositoryRoot(
  process.cwd(),
  process.env.INIT_CWD,
  process.env.OPENBOT_REPOSITORY_ROOT,
);
