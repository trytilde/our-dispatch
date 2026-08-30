import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { repositoryRoot } from "./workspace.js";

function scaffoldRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "devcli-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  return root;
}

describe("repositoryRoot", () => {
  it("walks up to the workspace file", () => {
    const root = scaffoldRepository();
    const nested = join(root, "apps", "web", "src");
    mkdirSync(nested, { recursive: true });
    expect(repositoryRoot(nested)).toBe(root);
  });
});
