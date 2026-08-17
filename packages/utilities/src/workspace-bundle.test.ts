import { describe, expect, it } from "vite-plus/test";
import { workspaceSourceInputOptions } from "./workspace-bundle.js";

describe("workspaceSourceInputOptions", () => {
  it("prefers workspace source exports and resolves TypeScript-authored JavaScript imports", () => {
    expect(workspaceSourceInputOptions()).toEqual({
      resolve: {
        conditionNames: ["development", "import", "node", "default"],
        extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
      },
    });
  });
});
