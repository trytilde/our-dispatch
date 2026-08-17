import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDirectories = ["cli"];
for (const parent of ["apps", "packages"])
  for (const entry of await readdir(join(repositoryRoot, parent), { withFileTypes: true }))
    if (entry.isDirectory()) workspaceDirectories.push(join(parent, entry.name));

for (const directory of workspaceDirectories) {
  const packageRoot = join(repositoryRoot, directory);
  const manifestPath = join(packageRoot, "package.json");
  try {
    await access(manifestPath);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.private === true) throw new Error(`${manifest.name} is still private`);
  if (manifest.publishConfig?.access !== "public")
    throw new Error(`${manifest.name} does not publish with public access`);
  if (!manifest.files?.includes("dist")) throw new Error(`${manifest.name} does not package dist`);

  const artifactPaths = new Set();
  collectArtifactPaths(manifest.publishConfig?.exports ?? manifest.exports, artifactPaths);
  collectArtifactPaths(manifest.publishConfig?.bin ?? manifest.bin, artifactPaths);
  collectArtifactPaths(manifest.main, artifactPaths);
  for (const artifact of artifactPaths) {
    if (artifact.includes("*")) continue;
    await access(resolve(packageRoot, artifact));
  }
  for (const executable of Object.values(manifest.bin ?? {})) {
    const path = resolve(packageRoot, executable);
    const contents = await readFile(path, "utf8");
    if (!contents.startsWith("#!/usr/bin/env node\n"))
      throw new Error(`${manifest.name} executable is missing its Node shebang`);
    if (((await stat(path)).mode & 0o111) === 0)
      throw new Error(`${manifest.name} executable is not marked executable`);
  }
}

function collectArtifactPaths(value, paths) {
  if (typeof value === "string") {
    if (value.startsWith("./dist")) paths.add(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const nested of Object.values(value)) collectArtifactPaths(nested, paths);
}
