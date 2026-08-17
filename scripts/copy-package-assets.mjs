import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

const sourceRoot = resolve("src");
const outputRoot = resolve("dist");
const copiedExtensions = new Set([".css", ".hbs", ".svg"]);

async function copyAssets(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const source = join(directory, entry.name);
      if (entry.isDirectory()) return copyAssets(source);
      if (!entry.isFile() || !copiedExtensions.has(extname(entry.name))) return;
      const destination = join(outputRoot, relative(sourceRoot, source));
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination);
    }),
  );
}

await copyAssets(sourceRoot);
