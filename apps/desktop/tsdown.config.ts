import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  deps: { neverBundle: ["electron"] },
  outputOptions: {
    entryFileNames: "[name].cjs",
    sourcemapExcludeSources: true,
  },
});
