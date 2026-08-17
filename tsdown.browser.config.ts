import { defineConfig } from "tsdown";

declare const process: { cwd(): string };

export default defineConfig({
  cwd: process.cwd(),
  entry: [
    "src/**/*.ts",
    "src/**/*.tsx",
    "!src/**/*.test.ts",
    "!src/**/*.test.tsx",
    "!src/**/*.d.ts",
  ],
  format: ["esm"],
  platform: "browser",
  fixedExtension: false,
  target: "es2024",
  outDir: "dist",
  clean: true,
  minify: false,
  sourcemap: true,
  outputOptions: { sourcemapExcludeSources: true },
  unbundle: true,
  dts: true,
});
