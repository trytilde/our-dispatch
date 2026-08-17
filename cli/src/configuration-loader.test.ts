import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);
const loaderUrl = pathToFileURL(
  fileURLToPath(new URL("./configuration-loader.ts", import.meta.url)),
);
const bootstrapUrl = pathToFileURL(
  fileURLToPath(new URL("./typescript-loader.ts", import.meta.url)),
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("configuration loader", () => {
  it("maps generated .js specifiers to fork-owned TypeScript files", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-configuration-loader-"));
    temporaryDirectories.push(root);
    await writeFile(
      join(root, "index.ts"),
      'import providers from "./providers.js";\nexport default providers;\n',
    );
    await writeFile(
      join(root, "providers.ts"),
      "export default { marker: process.env.OPENBOT_LOADER_MARKER };\n",
    );

    const configurationPath = join(root, "index.ts");
    const resultPath = join(root, "result.json");
    await writeFile(
      join(root, "run.mjs"),
      `
      import { writeFile } from "node:fs/promises";
      import { runWithTypeScriptLoader } from ${JSON.stringify(bootstrapUrl.href)};
      import { loadConfigurationModule } from ${JSON.stringify(loaderUrl.href)};
      await runWithTypeScriptLoader(async () => {
        const loaded = await loadConfigurationModule(${JSON.stringify(configurationPath)}, {
          OPENBOT_LOADER_MARKER: "loaded",
        });
        await writeFile(${JSON.stringify(resultPath)}, JSON.stringify({
          loaded: loaded.default,
          restored: process.env.OPENBOT_LOADER_MARKER,
        }));
      });
      `,
    );
    await execFileAsync(process.execPath, [join(root, "run.mjs")], {
      cwd: root,
    });

    expect(JSON.parse(await readFile(resultPath, "utf8"))).toEqual({
      loaded: { marker: "loaded" },
    });
  });

  it("selects development exports for unbuilt workspace packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-workspace-loader-"));
    temporaryDirectories.push(root);
    const packageRoot = join(root, "node_modules", "@example", "provider");
    await mkdir(join(packageRoot, "src"), { recursive: true });
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@example/provider",
        type: "module",
        exports: {
          ".": {
            development: "./src/index.ts",
            import: "./dist/index.js",
          },
        },
      }),
    );
    await writeFile(join(packageRoot, "src", "index.ts"), 'export const marker = "source";\n');
    await writeFile(
      join(root, "index.ts"),
      'import { marker } from "@example/provider";\nexport default { marker };\n',
    );

    const configurationPath = join(root, "index.ts");
    const resultPath = join(root, "result.json");
    await writeFile(
      join(root, "run.mjs"),
      `
      import { writeFile } from "node:fs/promises";
      import { runWithTypeScriptLoader } from ${JSON.stringify(bootstrapUrl.href)};
      import { loadConfigurationModule } from ${JSON.stringify(loaderUrl.href)};
      await runWithTypeScriptLoader(async () => {
        const loaded = await loadConfigurationModule(${JSON.stringify(configurationPath)}, {});
        await writeFile(${JSON.stringify(resultPath)}, JSON.stringify(loaded.default));
      });
      `,
    );
    await execFileAsync(process.execPath, [join(root, "run.mjs")], { cwd: root });

    expect(JSON.parse(await readFile(resultPath, "utf8"))).toEqual({ marker: "source" });
  });
});
