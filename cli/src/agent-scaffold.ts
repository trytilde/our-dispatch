import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentIdFromName, materializeFileTemplate } from "@tryopenbot/utilities";
import {
  type InferenceAgentTemplateFile,
  VercelInferenceProvider,
} from "@tryopenbot/inference-provider";
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
  ["tools/configure_connector.ts", "./assets/agents/factory/tools/configure_connector.ts.hbs"],
  ["tools/copy_to_computer.ts", "./assets/agents/factory/tools/copy_to_computer.ts.hbs"],
  ["tools/glob.ts", "./assets/agents/factory/tools/glob.ts.hbs"],
  ["tools/grep.ts", "./assets/agents/factory/tools/grep.ts.hbs"],
  [
    "tools/propose_self_extension.ts",
    "./assets/agents/factory/tools/propose_self_extension.ts.hbs",
  ],
  ["tools/manage_agent_jobs.ts", "./assets/agents/factory/tools/manage_agent_jobs.ts.hbs"],
  ["tools/manage_goals.ts", "./assets/agents/factory/tools/manage_goals.ts.hbs"],
  ["tools/manage_routines.ts", "./assets/agents/factory/tools/manage_routines.ts.hbs"],
  ["tools/manage_tasks.ts", "./assets/agents/factory/tools/manage_tasks.ts.hbs"],
  ["tools/read_file.ts", "./assets/agents/factory/tools/read_file.ts.hbs"],
  ["tools/screenshot.ts", "./assets/agents/factory/tools/screenshot.ts.hbs"],
  ["tools/write_file.ts", "./assets/agents/factory/tools/write_file.ts.hbs"],
  ["sandbox/workspace/.profile", "./assets/agents/factory/sandbox/workspace/.profile.hbs"],
  ["sandbox/workspace/README.md", "./assets/agents/factory/sandbox/workspace/README.md.hbs"],
  // The eight Tilde platform skills every agent's skill registry carries.
  [
    "skills/tilde-connectors/SKILL.md",
    "./assets/agents/shared/skills/tilde-connectors/SKILL.md.hbs",
  ],
  ["skills/tilde-tools/SKILL.md", "./assets/agents/shared/skills/tilde-tools/SKILL.md.hbs"],
  ["skills/tilde-chatkit/SKILL.md", "./assets/agents/shared/skills/tilde-chatkit/SKILL.md.hbs"],
  ["skills/tilde-memory/SKILL.md", "./assets/agents/shared/skills/tilde-memory/SKILL.md.hbs"],
  ["skills/tilde-skills/SKILL.md", "./assets/agents/shared/skills/tilde-skills/SKILL.md.hbs"],
  ["skills/tilde-state/SKILL.md", "./assets/agents/shared/skills/tilde-state/SKILL.md.hbs"],
  [
    "skills/tilde-dev-tunnels/SKILL.md",
    "./assets/agents/shared/skills/tilde-dev-tunnels/SKILL.md.hbs",
  ],
  [
    "skills/tilde-control-plane/SKILL.md",
    "./assets/agents/shared/skills/tilde-control-plane/SKILL.md.hbs",
  ],
] as const;

/** Rendered only into scaffolded subagents, never into the primary factory agent. */
const subagentTemplates = [
  ["skills/self-edit/SKILL.md", "./assets/agents/subagent/skills/self-edit/SKILL.md.hbs"],
] as const;

const memoryCatcherTemplates = [
  ["agent.ts", "./assets/agents/memory-catcher/agent.ts.hbs"],
  ["instructions.ts", "./assets/agents/memory-catcher/instructions.ts.hbs"],
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
  [
    "skills/memory-synthesis/SKILL.md",
    "./assets/agents/memory-catcher/skills/memory-synthesis/SKILL.md.hbs",
  ],
  [
    "skills/memory-quality/SKILL.md",
    "./assets/agents/memory-catcher/skills/memory-quality/SKILL.md.hbs",
  ],
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
  "inference.ts.hbs",
  "instructions.ts.hbs",
  "tools/await_shell.ts.hbs",
  "tools/bash.ts.hbs",
  "tools/copy_from_computer.ts.hbs",
  "tools/configure_connector.ts.hbs",
  "tools/copy_to_computer.ts.hbs",
  "tools/glob.ts.hbs",
  "tools/grep.ts.hbs",
  "tools/propose_self_extension.ts.hbs",
  "tools/manage_agent_jobs.ts.hbs",
  "tools/manage_goals.ts.hbs",
  "tools/manage_routines.ts.hbs",
  "tools/manage_tasks.ts.hbs",
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
export async function scaffoldAgentTemplates(
  repositoryRoot: string,
  inferenceFiles: readonly InferenceAgentTemplateFile[] = [],
): Promise<string> {
  const selectedInferenceFiles = inferenceFiles.length
    ? inferenceFiles
    : new VercelInferenceProvider().agentTemplate.files;
  const reserved = new Set<string>(defaultAgentTemplates.map(([path]) => path));
  const inferenceTemplates = selectedInferenceFiles.map(({ path, source }) => {
    if (
      !path.endsWith(".hbs") ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((segment) => !segment || segment === "." || segment === "..")
    )
      throw new Error(`Invalid inference agent template path: ${path}`);
    const outputPath = path.slice(0, -".hbs".length);
    if (reserved.has(outputPath))
      throw new Error(`Inference agent template conflicts with a default file: ${path}`);
    reserved.add(outputPath);
    return [outputPath, source] as const;
  });
  const directory = await seedTemplateDirectory(repositoryRoot, agentTemplateDirectory, [
    ...defaultAgentTemplates,
    ...inferenceTemplates,
  ]);
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

export { agentIdFromName } from "@tryopenbot/utilities";

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

/** Materialize the least-privilege background memory synthesizer. */
export async function scaffoldMemoryCatcherAgent(
  repositoryRoot: string,
  options: { existing?: "error" | "preserve" } = {},
): Promise<ScaffoldedAgent> {
  const id = "memory-catcher";
  const directory = resolve(repositoryRoot, subagentDirectory, id);
  if (await exists(directory)) {
    if (options.existing === "preserve") return { id, name: "Memory Catcher", directory };
    throw new Error(`Agent ${id} already exists`);
  }
  return materializeAgent(
    repositoryRoot,
    directory,
    id,
    "Memory Catcher",
    false,
    memoryCatcherTemplates,
    false,
    true,
  );
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
  overlays: readonly (readonly [string, string])[] = [],
  includeDefaultTemplates = true,
  includeInferenceTemplate = false,
): Promise<ScaffoldedAgent> {
  // Build outside configuration/ so the orchestrator cannot discover a half-written agent.
  // Publishing with one same-filesystem rename makes the complete template visible atomically.
  const stagingRoot = resolve(repositoryRoot, ".cache/agent-scaffolds");
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  const stagingDirectory = await mkdtemp(resolve(stagingRoot, `${id}-`));
  let published = false;
  const values = {
    AGENT_ID: id,
    AGENT_ID_JSON: JSON.stringify(id),
    AGENT_NAME: name,
    AGENT_NAME_JSON: JSON.stringify(name),
    AGENT_ENV_PREFIX: id.replace(/-/g, "_").toUpperCase(),
  };
  try {
    if (includeDefaultTemplates) {
      const templateDirectory = resolve(repositoryRoot, agentTemplateDirectory);
      const templates = await discoverAgentTemplates(templateDirectory);
      for (const template of templates) {
        const relativePath = relative(templateDirectory, template).replaceAll("\\", "/");
        await materializeFileTemplate(
          template,
          resolve(stagingDirectory, relativePath.slice(0, -".hbs".length)),
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
            resolve(stagingDirectory, relativePath.slice(0, -".hbs".length)),
            values,
            { flag: "wx", mode: 0o600 },
          );
        }
      }
    }
    for (const [outputPath, sourcePath] of overlays) {
      const destination = resolve(stagingDirectory, outputPath);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await materializeFileTemplate(
        fileURLToPath(new URL(sourcePath, import.meta.url)),
        destination,
        values,
        { flag: "wx", mode: 0o600 },
      );
    }
    if (includeInferenceTemplate) {
      await materializeFileTemplate(
        resolve(repositoryRoot, agentTemplateDirectory, "inference.ts.hbs"),
        resolve(stagingDirectory, "inference.ts"),
        values,
        { flag: "wx", mode: 0o600 },
      );
    }
    if (createSubagentDirectory)
      await mkdir(resolve(stagingDirectory, "subagents"), { recursive: true, mode: 0o700 });
    await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
    await rename(stagingDirectory, directory);
    published = true;
  } finally {
    if (!published) await rm(stagingDirectory, { recursive: true, force: true });
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
