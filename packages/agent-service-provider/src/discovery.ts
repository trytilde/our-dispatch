import { access, lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface AgentSource {
  slug: string;
  kind: "primary" | "subagent";
  directory: string;
  path: string;
  instrumentationPath?: string;
}

export const requiredComputerToolFiles = [
  "await_shell.ts",
  "bash.ts",
  "copy_from_computer.ts",
  "copy_to_computer.ts",
  "glob.ts",
  "grep.ts",
  "read_file.ts",
  "screenshot.ts",
  "write_file.ts",
] as const;

export const primaryAgentId = "hello-world";
export const primaryAgentDirectory = "configuration/agent";
export const subagentDirectory = `${primaryAgentDirectory}/subagents`;

export async function discoverAgents(repositoryRoot: string): Promise<readonly AgentSource[]> {
  const primaryDirectory = resolve(repositoryRoot, primaryAgentDirectory);
  await assertAgentDirectory(primaryDirectory, "Primary agent");
  const agents = [await agentSource(primaryAgentId, "primary", primaryDirectory)];
  const nestedDirectory = resolve(repositoryRoot, subagentDirectory);
  let entries;
  try {
    await assertAgentDirectory(nestedDirectory, "Subagent collection");
    entries = await readdir(nestedDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return agents;
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink())
      throw new Error(
        `Subagent symlinks are not supported: ${resolve(nestedDirectory, entry.name)}`,
      );
    if (!entry.isDirectory())
      throw new Error(
        `Subagent entries must be directories: ${resolve(nestedDirectory, entry.name)}`,
      );
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(entry.name) || entry.name === primaryAgentId)
      throw new Error(`Invalid subagent directory: ${entry.name}`);
    const directory = resolve(nestedDirectory, entry.name);
    if (await exists(resolve(directory, "subagents")))
      throw new Error(`Nested subagents are not supported: ${resolve(directory, "subagents")}`);
    agents.push(await agentSource(entry.name, "subagent", directory));
  }
  return agents;
}

async function assertAgentDirectory(path: string, label: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory())
    throw new Error(`${label} must be an ordinary directory: ${path}`);
}

async function agentSource(
  slug: string,
  kind: AgentSource["kind"],
  directory: string,
): Promise<AgentSource> {
  const path = resolve(directory, "agent.ts");
  try {
    await access(path);
    await Promise.all(
      requiredComputerToolFiles.map((name) => access(resolve(directory, "tools", name))),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(
        `Agent ${slug} is missing a required source file: ${(error as Error).message}`,
      );
    throw error;
  }
  const instrumentationPath = resolve(directory, "instrumentation.ts");
  return {
    slug,
    kind,
    directory,
    path,
    ...((await exists(instrumentationPath)) ? { instrumentationPath } : {}),
  };
}

export function globalInstrumentationPath(repositoryRoot: string): string {
  return resolve(repositoryRoot, "configuration/instrumentation.ts");
}

export async function agentTypeScriptPaths(agent: AgentSource): Promise<readonly string[]> {
  return filesBelow(
    agent.directory,
    (path) => /\.tsx?$/.test(path),
    agent.kind === "primary" ? [resolve(agent.directory, "subagents")] : [],
  );
}

export async function authoredAgentPaths(agent: AgentSource): Promise<readonly string[]> {
  return filesBelow(agent.directory, () => true, [
    resolve(agent.directory, "sandbox"),
    ...(agent.kind === "primary" ? [resolve(agent.directory, "subagents")] : []),
  ]);
}

async function filesBelow(
  directory: string,
  include: (path: string) => boolean,
  excludedDirectories: readonly string[] = [],
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Agent source symlinks are not supported: ${path}`);
      if (entry.isDirectory())
        return excludedDirectories.includes(path)
          ? []
          : await filesBelow(path, include, excludedDirectories);
      return entry.isFile() && include(path) ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
