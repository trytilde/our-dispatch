import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolveRepositoryRoot } from "./paths.js";

describe("repository root", () => {
  it("uses the package manager invocation directory", () => {
    expect(resolveRepositoryRoot("/workspace/cli", "/workspace")).toBe("/workspace");
  });

  it("finds the workspace root when a task runner starts inside a package", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-repository-root-"));
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "@tryopenbot/workspace" }),
      );
      await mkdir(join(root, "cli"));

      expect(resolveRepositoryRoot(join(root, "cli"), undefined, undefined)).toBe(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the current directory for the standalone CLI", () => {
    expect(resolveRepositoryRoot("/workspace/fork", undefined, undefined)).toBe("/workspace/fork");
  });

  it("honors an explicit repository root", () => {
    expect(resolveRepositoryRoot("/workspace/cli", "/workspace", "/explicit/workspace")).toBe(
      "/explicit/workspace",
    );
  });
});
