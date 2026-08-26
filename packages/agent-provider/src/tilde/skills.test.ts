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

  it("idempotently syncs authored skills without attaching Tilde-managed skills", async () => {
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
    let raceComputerOverlayCreation = true;
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
          const availableSkills = [...remoteSkills, ...remoteRegistry.skills];
          remoteRegistry = {
            ...remoteRegistry,
            ...body,
            skills: body.skill_ids.map((id) => availableSkills.find((skill) => skill.id === id)!),
          };
          return Response.json(remoteRegistry);
        }
        if (request.method === "GET" && path.endsWith("/skill"))
          return Response.json({ items: remoteSkills });
        if (request.method === "POST" && path.endsWith("/skill")) {
          mutations.push("create-skill");
          const body = (await request.json()) as Record<string, unknown>;
          const skill = {
            id: `skill-${remoteSkills.length + 1}`,
            org_id: "org-one",
            team_id: "team-one",
            version: 1,
            created_at: timestamp,
            updated_at: timestamp,
            ...body,
          };
          remoteSkills = [...remoteSkills, skill];
          if (raceComputerOverlayCreation && body.name === "hello-world-openbot-computer-use") {
            raceComputerOverlayCreation = false;
            return Response.json(
              { message: "repository error: insert skill: db error" },
              { status: 500 },
            );
          }
          return Response.json(skill);
        }
        if (request.method === "DELETE" && path.includes("/skill/")) {
          mutations.push("delete-skill");
          const id = path.split("/").pop();
          remoteSkills = remoteSkills.filter((skill) => skill.id !== id);
          return new Response(null, { status: 204 });
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
      // Older OpenBot releases used a different source identity. Tilde enforces uniqueness by
      // team skill name, so a repeated deployment must adopt this record rather than re-insert it.
      const authoredSkill = remoteSkills.find((skill) => skill.name === "hello-world-hello")!;
      authoredSkill.source_path = "legacy/agent/skills/hello/SKILL.md";
      await provider.deploy(context);
      expect(mutations).toEqual([
        "create-registry",
        "create-skill",
        "create-skill",
        "update-registry",
      ]);
      expect(context.environment.AGENT_HELLO_WORLD_SKILL_REGISTRY_ID).toBe("registry-one");
      // Skill names are team-unique in Tilde, so the stored name carries the
      // agent ID while the authored frontmatter keeps the shared name.
      expect(remoteSkills[0]).toMatchObject({
        name: "hello-world-hello",
        description: "Say hello.",
        source_kind: "openbot",
        source_path: "legacy/agent/skills/hello/SKILL.md",
      });
      expect(remoteSkills).toContainEqual(
        expect.objectContaining({ name: "hello-world-openbot-computer-use" }),
      );

      const userSkill = {
        id: "user-owned-skill",
        name: "user-skill",
        description: "Preserve me.",
        source_kind: "user",
        source_path: "user/skill.md",
      };
      const bundledFallback = {
        id: "bundled-cua-fallback",
        name: "hello-world-gui-automation",
        description: "Bundled canonical Cua fallback.",
        source_kind: "openbot",
        source_path: "configuration/agent/skills/.openbot/cua-driver/SKILL.md",
      };
      const legacyManagedCua = {
        id: "managed-cua-skill-v1",
        name: "gui-automation",
        description: "Managed canonical Cua skill.",
        source_kind: "provider",
        source_provider_id: "cua",
        source_repository_url: "https://github.com/trycua/cua.git",
        source_path: "skills/gui-automation/SKILL.md",
      };
      remoteSkills.push(userSkill, bundledFallback);
      remoteRegistry.skills.push(userSkill, bundledFallback, legacyManagedCua);
      await provider.deploy(context);
      await provider.deploy(context);

      expect(mutations).toEqual([
        "create-registry",
        "create-skill",
        "create-skill",
        "update-registry",
        "update-registry",
        "delete-skill",
      ]);
      expect(remoteRegistry.skills.map((skill) => skill.id)).toContain("user-owned-skill");
      expect(remoteRegistry.skills.map((skill) => skill.id)).not.toContain("managed-cua-skill-v1");
      expect(remoteRegistry.skills.map((skill) => skill.id)).not.toContain("bundled-cua-fallback");
      expect(remoteSkills.map((skill) => skill.id)).not.toContain("bundled-cua-fallback");

      const computerOverlay = remoteSkills.find(
        (skill) => skill.name === "hello-world-openbot-computer-use",
      )!;
      computerOverlay.source_kind = "user";
      computerOverlay.source_path = "user/openbot-computer-use/SKILL.md";
      computerOverlay.description = "Do not overwrite me.";
      await expect(provider.deploy(context)).resolves.toBeUndefined();
      expect(computerOverlay).toMatchObject({
        id: expect.any(String),
        description: "Do not overwrite me.",
        source_kind: "user",
        source_path: "user/openbot-computer-use/SKILL.md",
      });
      expect(mutations).toHaveLength(6);
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
