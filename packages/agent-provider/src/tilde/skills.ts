import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { TildePlatform, type TildePlatformConfig } from "@tryopenbot/platform-integrations";
import {
  tildeErrorMessage,
  tildeErrorStatus,
} from "@tryopenbot/platform-integrations/tilde/errors";
import { tildeFetch } from "@tryopenbot/platform-integrations/tilde/fetch";
import {
  omitUndefinedProperties,
  undefinedWhenFalsy,
} from "@tryopenbot/platform-integrations/tilde/request";
import {
  createSkillRegistry,
  createSkill,
  deleteSkill,
  createTildeApiClient,
  getSkillRegistry,
  listSkillRegistries,
  listSkills,
  updateSkill,
  updateSkillRegistry,
  type Skill as TildeSkill,
  type SkillRegistry as TildeSkillRegistry,
} from "@trytilde/api-client";
import type {
  ListSkillRegistriesRequest,
  RegisterSkillsRequest,
  SkillRegistry,
  SkillReconciliationContext,
} from "./skills-types.js";
import { persistEnvironment, type DeploymentContext } from "@tryopenbot/runtime-provider";
import { AgentProviderError } from "../core.js";
import { reconciliationSignal } from "./skills-types.js";

export interface TildeSkillReconcilerConfig extends TildePlatformConfig {}

export class TildeSkillReconciler {
  readonly #config: TildePlatformConfig;
  constructor(platformOrConfig: TildePlatform | TildeSkillReconcilerConfig) {
    const platform =
      platformOrConfig instanceof TildePlatform
        ? platformOrConfig
        : new TildePlatform(platformOrConfig);
    this.#config = platform.connection();
  }

  async listRegistries(
    request: ListSkillRegistriesRequest,
    context: SkillReconciliationContext,
  ): Promise<readonly SkillRegistry[]> {
    return this.#run(async () => {
      const { data } = await listSkillRegistries({
        client: this.#api(context),
        path: { team_id: this.#config.teamId },
        query: omitUndefinedProperties({
          page_size: 100,
          name_prefix: undefinedWhenFalsy(request.namePrefix),
        }),
        throwOnError: true,
      });
      return data.items.map(registry);
    });
  }

  async getRegistry(id: string, context: SkillReconciliationContext): Promise<SkillRegistry> {
    return this.#run(async () => {
      const { data } = await getSkillRegistry({
        client: this.#api(context),
        path: { team_id: this.#config.teamId, id },
        throwOnError: true,
      });
      return registry(data);
    });
  }

  async registerSkills(
    request: RegisterSkillsRequest,
    context: SkillReconciliationContext,
  ): Promise<SkillRegistry> {
    return this.#run(async () => {
      const body = {
        name: request.name,
        description: request.description,
        skill_ids: [...new Set(request.skillIds)],
      };
      const result = request.registryId
        ? await updateSkillRegistry({
            client: this.#api(context),
            path: { team_id: this.#config.teamId, id: request.registryId },
            body,
            throwOnError: true,
          })
        : await createSkillRegistry({
            client: this.#api(context),
            path: { team_id: this.#config.teamId },
            body,
            throwOnError: true,
          });
      return registry(result.data);
    });
  }

  async deploy(context: DeploymentContext): Promise<void> {
    return this.#run(() => this.#deployResources(context));
  }

  async #deployResources(context: DeploymentContext): Promise<void> {
    const { id, path } = requireAgent(context);
    const prefix = agentPrefix(id);
    const configuredId = context.environment[`${prefix}_SKILL_REGISTRY_ID`]?.trim();
    const call = { requestId: `agent-lifecycle:${id}:skill-registry` };
    let registry: SkillRegistry | undefined;
    if (configuredId) {
      try {
        registry = await this.getRegistry(configuredId, call);
      } catch (error) {
        if (!(error instanceof AgentProviderError) || error.code !== "not_found") throw error;
      }
    }
    const name = `OpenBot ${id}`;
    const description = `Skills available to the ${id} OpenBot agent.`;
    if (!registry) {
      const existing = await this.listRegistries({ namePrefix: name }, call);
      registry =
        existing.find((candidate) => candidate.name === name) ??
        (await this.registerSkills(
          {
            name,
            description,
            skillIds: [],
          },
          call,
        ));
    }
    const { skillIds, staleSkillIds } = await this.#reconcileSkills(context, path, id);
    const current = await this.#getRegistryRecord(registry.id, call);
    if (
      current.name !== name ||
      current.description !== description ||
      !sameStrings(
        current.skills.map((skill) => skill.id),
        skillIds,
      )
    ) {
      await this.registerSkills({ registryId: registry.id, name, description, skillIds }, call);
    }
    for (const staleSkillId of staleSkillIds) {
      await deleteSkill({
        client: this.#api({ requestId: `agent-lifecycle:${id}:skill:delete` }),
        path: { team_id: this.#config.teamId, id: staleSkillId },
        throwOnError: true,
      });
    }
    await persistEnvironment(
      context,
      `${prefix}_SKILL_REGISTRY_ID`,
      registry.id,
      `Tilde skill registry ID for ${id}.`,
    );
  }

  async #reconcileSkills(
    context: DeploymentContext,
    agentPath: string,
    agentId: string,
  ): Promise<{ skillIds: string[]; staleSkillIds: string[] }> {
    const desired = await authoredSkills(context.repositoryRoot, agentPath);
    const remote = await this.#listAllSkills({ requestId: `agent-lifecycle:${agentId}:skills` });
    const ownedPrefix = `${agentSourcePrefix(context.repositoryRoot, agentPath)}/skills/`;
    const owned = remote.filter(
      (skill) => skill.source_kind === "openbot" && skill.source_path?.startsWith(ownedPrefix),
    );
    const ids: string[] = [];
    for (const skill of desired) {
      // Tilde skill names are unique per team, and every agent authors the same
      // shared platform skills, so the stored name is namespaced by agent ID.
      const name = teamSkillName(agentId, skill.name);
      const existing = owned.find((candidate) => candidate.source_path === skill.sourcePath);
      if (!existing) {
        const { data } = await createSkill({
          client: this.#api({ requestId: `agent-lifecycle:${agentId}:skill:create` }),
          path: { team_id: this.#config.teamId },
          body: {
            name,
            description: skill.description,
            content: skill.content,
            source_kind: "openbot",
            source_path: skill.sourcePath,
          },
          throwOnError: true,
        });
        ids.push(data.id);
      } else {
        if (
          existing.name !== name ||
          existing.description !== skill.description ||
          existing.content !== skill.content
        ) {
          await updateSkill({
            client: this.#api({ requestId: `agent-lifecycle:${agentId}:skill:update` }),
            path: { team_id: this.#config.teamId, id: existing.id },
            body: {
              name,
              description: skill.description,
              content: skill.content,
            },
            throwOnError: true,
          });
        }
        ids.push(existing.id);
      }
    }
    const desiredPaths = new Set(desired.map((skill) => skill.sourcePath));
    const staleSkillIds = owned
      .filter((stale) => !stale.source_path || !desiredPaths.has(stale.source_path))
      .map((stale) => stale.id);
    return { skillIds: ids.sort(), staleSkillIds };
  }

  async #listAllSkills(context: SkillReconciliationContext): Promise<TildeSkill[]> {
    const items: TildeSkill[] = [];
    let nextPageToken: string | undefined;
    do {
      const { data } = await listSkills({
        client: this.#api(context),
        path: { team_id: this.#config.teamId },
        query: { page_size: 100, ...(nextPageToken ? { next_page_token: nextPageToken } : {}) },
        throwOnError: true,
      });
      items.push(...data.items);
      nextPageToken = data.next_page_token;
    } while (nextPageToken);
    return items;
  }

  async #getRegistryRecord(id: string, context: SkillReconciliationContext) {
    return this.#run(async () => {
      const { data } = await getSkillRegistry({
        client: this.#api(context),
        path: { team_id: this.#config.teamId, id },
        throwOnError: true,
      });
      return data;
    });
  }

  #api(context: SkillReconciliationContext) {
    return createTildeApiClient({
      apiKey: this.#config.apiKey,
      orgId: this.#config.orgId,
      baseUrl: this.#config.baseUrl ?? "https://api.trytilde.ai",
      headers: { "x-api-key": this.#config.apiKey },
      fetch: tildeFetch(reconciliationSignal(context)),
      throwOnError: true,
    });
  }

  async #run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AgentProviderError) throw error;
      const status = tildeErrorStatus(error);
      throw new AgentProviderError(
        status === 404
          ? "not_found"
          : status === 401 || status === 403
            ? "permission_denied"
            : "provider_unavailable",
        tildeErrorMessage(error, "Tilde skills request failed"),
        status === undefined || status >= 500,
      );
    }
  }
}

interface AuthoredSkill {
  name: string;
  description: string;
  content: string;
  sourcePath: string;
}

async function authoredSkills(repositoryRoot: string, agentPath: string): Promise<AuthoredSkill[]> {
  const directory = resolve(agentPath, "skills");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const result: AuthoredSkill[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) throw new Error(`Skill symlinks are not supported: ${entry.name}`);
    if (!entry.isDirectory()) continue;
    const path = resolve(directory, entry.name, "SKILL.md");
    const content = await readFile(path, "utf8");
    const metadata = skillMetadata(content, entry.name);
    result.push({
      ...metadata,
      content,
      sourcePath: relative(repositoryRoot, path).split(sep).join("/"),
    });
  }
  return result;
}

function skillMetadata(
  content: string,
  fallbackName: string,
): { name: string; description: string } {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(content)?.[1];
  const name = frontmatterField(frontmatter, "name") ?? fallbackName;
  const description = frontmatterField(frontmatter, "description");
  if (!description) throw new Error(`Skill ${fallbackName} is missing frontmatter description`);
  return { name, description };
}

function frontmatterField(frontmatter: string | undefined, key: string): string | undefined {
  const value = frontmatter
    ?.split("\n")
    .find((line) => line.startsWith(`${key}:`))
    ?.slice(key.length + 1)
    .trim();
  return value?.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2") || undefined;
}

/** Team-unique Tilde skill name: agents share authored skill names, teams do not. */
function teamSkillName(agentId: string, skillName: string): string {
  const prefix = `${agentId}-`;
  return skillName.startsWith(prefix) ? skillName : `${prefix}${skillName}`;
}

function agentSourcePrefix(repositoryRoot: string, agentPath: string): string {
  return relative(repositoryRoot, agentPath).split(sep).join("/");
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function requireAgent(context: DeploymentContext): { id: string; path: string } {
  if (!context.agentId || !context.agentPath)
    throw new AgentProviderError(
      "invalid_configuration",
      "The agent resource lifecycle requires an agent ID and absolute path",
    );
  return { id: context.agentId, path: context.agentPath };
}

function agentPrefix(id: string): string {
  return `AGENT_${id.replaceAll("-", "_").toUpperCase()}`;
}

function registry(value: TildeSkillRegistry): SkillRegistry {
  return {
    id: value.id,
    name: value.name,
  };
}
