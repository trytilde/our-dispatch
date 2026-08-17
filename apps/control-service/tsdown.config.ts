import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/app.ts", "src/service.ts"],
  format: ["esm"],
  platform: "node",
  fixedExtension: false,
  target: "node24",
  outDir: "dist",
  clean: true,
  minify: false,
  sourcemap: true,
  dts: true,
  outputOptions: { sourcemapExcludeSources: true },
});
