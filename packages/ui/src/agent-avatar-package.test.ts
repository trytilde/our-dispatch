import { describe, expect, it } from "vite-plus/test";
import packageJson from "../package.json" with { type: "json" };

const manifest = packageJson as {
  exports?: Record<string, unknown>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

describe("AgentAvatar package entry", () => {
  it("exports only packed avatar artifacts", () => {
    expect(manifest.exports?.["./agent-avatar"]).toEqual({
      types: "./dist/agent-avatar.d.ts",
      import: "./dist/agent-avatar.js",
    });
    expect(manifest.exports?.["./agent-avatar.css"]).toBe("./dist/agent-avatar.css");
  });

  it("builds packed artifacts when installed from Git", () => {
    expect(manifest.scripts?.prepare).toBe("pnpm build");
  });

  it("does not require client-runtime for the standalone entry", () => {
    expect(manifest.dependencies?.["@tryopenbot/client-runtime"]).toBeUndefined();
    expect(manifest.peerDependencies?.["@tryopenbot/client-runtime"]).toBe("0.1.0");
    expect(manifest.peerDependenciesMeta?.["@tryopenbot/client-runtime"]?.optional).toBe(true);
  });
});
