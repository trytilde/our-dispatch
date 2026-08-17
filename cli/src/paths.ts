import { resolve } from "node:path";

export function resolveRepositoryRoot(
  currentDirectory: string,
  initialDirectory?: string,
  explicitDirectory?: string,
): string {
  return resolve(explicitDirectory ?? initialDirectory ?? currentDirectory);
}

export const repositoryRoot = resolveRepositoryRoot(
  process.cwd(),
  process.env.INIT_CWD,
  process.env.OPENBOT_REPOSITORY_ROOT,
);
