import { describe, expect, it } from "vite-plus/test";
import { resolveRepositoryRoot } from "./paths.js";

describe("repository root", () => {
  it("uses the package manager invocation directory", () => {
    expect(resolveRepositoryRoot("/workspace/cli", "/workspace")).toBe("/workspace");
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
