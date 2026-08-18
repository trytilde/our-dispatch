import { constants } from "node:fs";
import { access, chmod, copyFile, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { materializeFileTemplate } from "@tryopenbot/utilities";
import {
  primaryAgentDirectory,
  primaryAgentId,
  subagentDirectory,
} from "@tryopenbot/agent-service-provider";

const defaultAgentTemplates = [
  ["agent.ts", "./assets/agents/factory/agent.ts.hbs"],
  ["instructions.ts", "./assets/agents/factory/instructions.ts.hbs"],
  ["instrumentation.ts", "./assets/agents/factory/instrumentation.ts.hbs"],
  ["tools/await_shell.ts", "./assets/agents/factory/tools/await_shell.ts.hbs"],
  ["tools/bash.ts", "./assets/agents/factory/tools/bash.ts.hbs"],
  ["tools/copy_from_computer.ts", "./assets/agents/factory/tools/copy_from_computer.ts.hbs"],
  ["tools/copy_to_computer.ts", "./assets/agents/factory/tools/copy_to_computer.ts.hbs"],
  ["tools/glob.ts", "./assets/agents/factory/tools/glob.ts.hbs"],
  ["tools/grep.ts", "./assets/agents/factory/tools/grep.ts.hbs"],
  ["tools/read_file.ts", "./assets/agents/factory/tools/read_file.ts.hbs"],
  ["tools/screenshot.ts", "./assets/agents/factory/tools/screenshot.ts.hbs"],
  ["tools/write_file.ts", "./assets/agents/factory/tools/write_file.ts.hbs"],
  ["sandbox/workspace/.profile", "./assets/agents/factory/sandbox/workspace/.profile.hbs"],
  ["sandbox/workspace/README.md", "./assets/agents/factory/sandbox/workspace/README.md.hbs"],
] as const;

/** Rendered only into scaffolded subagents, never into the primary factory agent. */
const subagentTemplates = [
  ["skills/self-edit/SKILL.md", "./assets/agents/subagent/skills/self-edit/SKILL.md.hbs"],
] as const;

/** Rendered only into the primary factory agent, never into scaffolded subagents. */
const factoryAgentTemplates = [
  ["skills/create-agent/SKILL.md", "./assets/agents/factory/skills/create-agent/SKILL.md.hbs"],
  [
    "skills/develop-openbot/SKILL.md",
    "./assets/agents/factory/skills/develop-openbot/SKILL.md.hbs",
  ],
] as const;

const requiredAgentTemplatePaths = [
  "agent.ts.hbs",
  "instructions.ts.hbs",
  "tools/await_shell.ts.hbs",
  "tools/bash.ts.hbs",
  "tools/copy_from_computer.ts.hbs",
  "tools/copy_to_computer.ts.hbs",
  "tools/glob.ts.hbs",
  "tools/grep.ts.hbs",
  "tools/read_file.ts.hbs",
  "tools/screenshot.ts.hbs",
  "tools/write_file.ts.hbs",
] as const;

export const agentTemplateDirectory = "configuration/templates/agent";
export const factoryTemplateDirectory = "configuration/templates/factory";
export const subagentTemplateDirectory = "configuration/templates/subagent";

export interface ScaffoldedAgent {
  id: string;
  name: string;
  directory: string;
}

/** Seed the fork-owned agent templates once without replacing owner edits. */
export async function scaffoldAgentTemplates(repositoryRoot: string): Promise<string> {
  const directory = await seedTemplateDirectory(
    repositoryRoot,
    agentTemplateDirectory,
    defaultAgentTemplates,
  );
  await seedTemplateDirectory(repositoryRoot, factoryTemplateDirectory, factoryAgentTemplates);
  await seedTemplateDirectory(repositoryRoot, subagentTemplateDirectory, subagentTemplates);
  return directory;
}

async function seedTemplateDirectory(
  repositoryRoot: string,
  templateDirectory: string,
  templates: readonly (readonly [string, string])[],
): Promise<string> {
  const directory = resolve(repositoryRoot, templateDirectory);
  if (await exists(directory)) return directory;
  try {
    for (const [outputPath, sourcePath] of templates) {
      const destination = resolve(directory, `${outputPath}.hbs`);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(
        fileURLToPath(new URL(sourcePath, import.meta.url)),
        destination,
        constants.COPYFILE_EXCL,
      );
      await chmod(destination, 0o600);
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}

export function agentIdFromName(name: string): string {
  const id = name
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) throw new Error("Agent name must contain at least one letter or number");
  return id;
}

/** Materialize one complete authored agent without overwriting an existing directory. */
export async function scaffoldAgent(
  repositoryRoot: string,
  rawName: string,
  options: { existing?: "error" | "preserve" } = {},
): Promise<ScaffoldedAgent> {
  const name = rawName.trim();
  if (!name) throw new Error("Agent name is required");
  const id = agentIdFromName(name);
  if (id === primaryAgentId) throw new Error(`Agent ID ${id} is reserved for the primary agent`);
  await assertSingularAgentLayout(repositoryRoot);
  const directory = resolve(repositoryRoot, subagentDirectory, id);
  if (await exists(directory)) {
    if (options.existing === "preserve") return { id, name, directory };
    throw new Error(`Agent ${id} already exists`);
  }
  return materializeAgent(repositoryRoot, directory, id, name, false);
}

/** Materialize the one primary authored agent. */
export async function scaffoldPrimaryAgent(
  repositoryRoot: string,
  rawName: string,
  options: { existing?: "error" | "preserve" } = {},
): Promise<ScaffoldedAgent> {
  const name = rawName.trim();
  if (!name) throw new Error("Agent name is required");
  const directory = resolve(repositoryRoot, primaryAgentDirectory);
  if (await exists(directory)) {
    if (options.existing === "preserve") return { id: primaryAgentId, name, directory };
    throw new Error(`Primary agent ${primaryAgentId} already exists`);
  }
  return materializeAgent(repositoryRoot, directory, primaryAgentId, name, true);
}

async function materializeAgent(
  repositoryRoot: string,
  directory: string,
  id: string,
  name: string,
  createSubagentDirectory: boolean,
): Promise<ScaffoldedAgent> {
  const values = {
    AGENT_ID: id,
    AGENT_ID_JSON: JSON.stringify(id),
    AGENT_NAME: name,
    AGENT_NAME_JSON: JSON.stringify(name),
    AGENT_ENV_PREFIX: id.replace(/-/g, "_").toUpperCase(),
  };
  try {
    const templateDirectory = resolve(repositoryRoot, agentTemplateDirectory);
    const templates = await discoverAgentTemplates(templateDirectory);
    for (const template of templates) {
      const relativePath = relative(templateDirectory, template).replaceAll("\\", "/");
      await materializeFileTemplate(
        template,
        resolve(directory, relativePath.slice(0, -".hbs".length)),
        values,
        { flag: "wx", mode: 0o600 },
      );
    }
    const roleTemplateDirectory = resolve(
      repositoryRoot,
      createSubagentDirectory ? factoryTemplateDirectory : subagentTemplateDirectory,
    );
    if (await exists(roleTemplateDirectory)) {
      for (const template of await walkAgentTemplates(roleTemplateDirectory)) {
        const relativePath = relative(roleTemplateDirectory, template).replaceAll("\\", "/");
        await materializeFileTemplate(
          template,
          resolve(directory, relativePath.slice(0, -".hbs".length)),
          values,
          { flag: "wx", mode: 0o600 },
        );
      }
    }
    if (createSubagentDirectory)
      await mkdir(resolve(directory, "subagents"), { recursive: true, mode: 0o700 });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { id, name, directory };
}

async function assertSingularAgentLayout(repositoryRoot: string): Promise<void> {
  const primary = resolve(repositoryRoot, primaryAgentDirectory);
  if (!(await exists(primary)))
    throw new Error("configuration/agent is missing; run openbot init first");
  await assertOrdinaryDirectory(primary, "Primary agent");
  const nested = resolve(repositoryRoot, subagentDirectory);
  if (await exists(nested)) await assertOrdinaryDirectory(nested, "Subagent collection");
}

async function assertOrdinaryDirectory(path: string, label: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory())
    throw new Error(`${label} must be an ordinary directory: ${path}`);
}

async function discoverAgentTemplates(directory: string): Promise<string[]> {
  const templates = await walkAgentTemplates(directory);
  if (!templates.length) throw new Error(`${agentTemplateDirectory} contains no template files`);
  const relativePaths = new Set(
    templates.map((template) => relative(directory, template).replaceAll("\\", "/")),
  );
  for (const requiredPath of requiredAgentTemplatePaths) {
    if (!relativePaths.has(requiredPath))
      throw new Error(
        `Agent template is missing required file: ${agentTemplateDirectory}/${requiredPath}`,
      );
  }
  return templates.sort();
}

async function walkAgentTemplates(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(
        `${agentTemplateDirectory} is missing; run openbot init to scaffold the agent template`,
      );
    throw error;
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Agent template symlinks are not supported: ${path}`);
      if (entry.isDirectory()) return walkAgentTemplates(path);
      if (!entry.isFile()) return [];
      if (!entry.name.endsWith(".hbs"))
        throw new Error(`Agent template files must end in .hbs: ${path}`);
      return [path];
    }),
  );
  return nested.flat();
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
