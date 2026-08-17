import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  fixedExtension: false,
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  deps: {
    alwaysBundle: [
      /@bufbuild\/protobuf/,
      /@connectrpc\//,
      /@tryopenbot\/computer-service-proto/,
      /@tryopenbot\/utilities/,
      /handlebars/,
    ],
  },
  outputOptions: {
    banner: "#!/usr/bin/env node",
    sourcemapExcludeSources: true,
  },
});
