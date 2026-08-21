import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // The Electron main bundle is CJS, but the workspace runtime is ESM-only by its exports
  // conditions, so it must be bundled rather than required at runtime.
  deps: { neverBundle: ["electron"], alwaysBundle: [/^@tryopenbot\//] },
  outputOptions: {
    entryFileNames: "[name].cjs",
    sourcemapExcludeSources: true,
  },
});
