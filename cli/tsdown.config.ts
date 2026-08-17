import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  platform: "node",
  fixedExtension: false,
  target: "node24",
  outDir: "dist",
  clean: true,
  minify: false,
  sourcemap: true,
  dts: false,
  outputOptions: { sourcemapExcludeSources: true },
});
