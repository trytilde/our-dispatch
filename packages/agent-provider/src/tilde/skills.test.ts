import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeploymentOutputs, type DeploymentContext } from "@tryopenbot/runtime-provider";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TildeSkillReconciler } from "./skills.js";

const config = {
  apiKey: "secret",
  orgId: "org-one",
  teamId: "team-one",
  baseUrl: "https://tilde.test",
};
const context = { requestId: "request-one" };
const timestamp = "2026-08-12T00:00:00.000Z";
const registry = {
  id: "registry-one",
  name: "OpenBot",
  description: "OpenBot skills",
  org_id: "org-one",
  team_id: "team-one",
  skills: [],
  created_at: timestamp,
  updated_at: timestamp,
};

afterEach(() => vi.unstubAllGlobals());

describe("TildeSkillReconciler", () => {
  it("lists and provisions registries through the typed API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const request = input instanceof Request ? input : new Request(input);
        return request.method === "GET"
          ? Response.json({ items: [registry], next_page_token: null })
          : Response.json(registry);
      }),
    );
    const provider = new TildeSkillReconciler(config);
    await expect(
      provider.listRegistries({ namePrefix: "OpenBot" }, context),
    ).resolves.toMatchObject([{ id: "registry-one" }]);
    await expect(
      provider.registerSkills(
        { name: "OpenBot", description: "OpenBot skills", skillIds: [] },
        context,
      ),
    ).resolves.toMatchObject({ id: "registry-one" });
    expect("listSkills" in provider).toBe(false);
    expect("materializeSkillAssets" in provider).toBe(false);
  });

  it("idempotently syncs authored skills and exact registry membership", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-agent-skills-"));
    const agentPath = join(root, "configuration", "agent");
    await mkdir(join(agentPath, "skills", "hello"), { recursive: true });
    await writeFile(
      join(agentPath, "skills", "hello", "SKILL.md"),
      "---\nname: hello\ndescription: Say hello.\n---\n\n# Hello\n",
    );
    let remoteSkills: Array<Record<string, unknown>> = [];
    let remoteRegistry: Record<string, unknown> & {
      id: string;
      skills: Array<Record<string, unknown>>;
    } = { ...registry, skills: [] };
    const mutations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/skill-registry"))
          return Response.json({ items: remoteRegistry.id ? [remoteRegistry] : [] });
        if (request.method === "POST" && path.endsWith("/skill-registry")) {
          mutations.push("create-registry");
          remoteRegistry = {
            ...registry,
            ...((await request.json()) as Record<string, unknown>),
            skills: [],
          };
          return Response.json(remoteRegistry);
        }
        if (request.method === "GET" && path.endsWith(`/skill-registry/${registry.id}`))
          return Response.json(remoteRegistry);
        if (request.method === "PATCH" && path.endsWith(`/skill-registry/${registry.id}`)) {
          mutations.push("update-registry");
          const body = (await request.json()) as { skill_ids: string[] };
          remoteRegistry = {
            ...remoteRegistry,
            ...body,
            skills: remoteSkills.filter((skill) => body.skill_ids.includes(skill.id as string)),
          };
          return Response.json(remoteRegistry);
        }
        if (request.method === "GET" && path.endsWith("/skill"))
          return Response.json({ items: remoteSkills });
        if (request.method === "POST" && path.endsWith("/skill")) {
          mutations.push("create-skill");
          const body = (await request.json()) as Record<string, unknown>;
          const skill = {
            id: "skill-one",
            org_id: "org-one",
            team_id: "team-one",
            version: 1,
            created_at: timestamp,
            updated_at: timestamp,
            ...body,
          };
          remoteSkills = [skill];
          return Response.json(skill);
        }
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      }),
    );
    remoteRegistry = { ...remoteRegistry, id: "" };
    const context: DeploymentContext = {
      devMode: true,
      repositoryRoot: root,
      environment: {},
      inputs: new DeploymentOutputs(),
      agentId: "hello-world",
      agentPath,
      report: () => undefined,
    };
    const provider = new TildeSkillReconciler(config);
    try {
      await provider.deploy(context);
      await provider.deploy(context);
      expect(mutations).toEqual(["create-registry", "create-skill", "update-registry"]);
      expect(context.environment.AGENT_HELLO_WORLD_SKILL_REGISTRY_ID).toBe("registry-one");
      expect(remoteSkills[0]).toMatchObject({
        name: "hello",
        description: "Say hello.",
        source_kind: "openbot",
        source_path: "configuration/agent/skills/hello/SKILL.md",
      });
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
