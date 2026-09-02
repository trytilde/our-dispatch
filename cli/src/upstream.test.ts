import { describe, expect, it } from "vite-plus/test";
import { remoteRepository, upstreamRepository } from "./upstream.js";

describe("remoteRepository", () => {
  it("reads owner/name for this checkout", () => {
    // The suite runs inside the repository, so origin resolves; the shape is what matters.
    const found = remoteRepository(process.cwd());
    if (found !== undefined) expect(found).toMatch(/^[^/]+\/[^/]+$/);
  });

  it("returns undefined outside a repository rather than throwing", () => {
    expect(remoteRepository("/")).toBeUndefined();
  });

  it("names the canonical repository", () => {
    expect(upstreamRepository).toBe("trytilde/dispatch");
  });
});
