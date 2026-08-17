import { workspaceSourceInputOptions } from "@tryopenbot/utilities";

export function bundleOptions(
  cwd: string,
  entry: string,
  outDir: string,
  filename: string,
  minify: boolean,
) {
  return {
    cwd,
    entry: [entry],
    format: "esm" as const,
    platform: "node" as const,
    target: "node24",
    outDir,
    clean: false,
    minify,
    sourcemap: true,
    inputOptions: workspaceSourceInputOptions(),
    outputOptions: {
      entryFileNames: filename,
      sourcemapExcludeSources: true,
    },
  };
}
