// Locates the repository from any working directory.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function repositoryRoot(start: string = process.cwd()): string {
  let current = start;
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml")) || existsSync(join(current, ".git")))
      return current;
    const parent = dirname(current);
    if (parent === current)
      throw new Error(
        "Not inside an OpenBot repository: no pnpm-workspace.yaml or .git found upward",
      );
    current = parent;
  }
}
