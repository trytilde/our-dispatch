import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeploymentOutputs, type DeploymentContext } from "@tryopenbot/runtime-provider";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TildeAgentProvider } from "./index.js";
import { TildeSkillReconciler } from "./skills.js";
import { TildeToolReconciler } from "./tools.js";

const config = {
  apiKey: "secret",
  orgId: "org-one",
  teamId: "team-one",
  baseUrl: "https://tilde.test",
};
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("TildeAgentProvider", () => {
  it("depends on the shared Tilde setup", () => {
    expect(new TildeAgentProvider(config).platforms.map(({ id }) => id)).toEqual(["tilde"]);
  });

  it("provisions, polls, claims credentials, and retains OpenBot-only integrations", async () => {
    vi.spyOn(TildeSkillReconciler.prototype, "bundleSkills").mockResolvedValue({
      custom: [
        {
          key: "configuration/agents/scout/skills/example/SKILL.md",
          name: "scout-example",
          description: "Example",
          content: "# Example",
        },
      ],
      managed: [{ provider_id: "cua", skill_ids: ["gui-automation"] }],
    });
    const external = vi
      .spyOn(TildeToolReconciler.prototype, "deployExternalResources")
      .mockResolvedValue();
    const context = await agentContext("scout");
    const persistedSecrets: string[] = [];
    context.persistence = {
      setEnvironment: async () => undefined,
      setSecret: async (name) => {
        persistedSecrets.push(name);
      },
      unsetEnvironment: async () => undefined,
      unsetSecret: async () => undefined,
    };
    let channelCreated = false;
    let polled = false;
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push(request.clone());
        const path = new URL(request.url).pathname;
        if (request.method === "PUT" && path.endsWith("/agents/scout/provision")) {
          const body = (await request.json()) as { memory: { wiki?: unknown } };
          expect(body).toMatchObject({
            agent: { credential_strategy: "rotate", endpoint: { concurrency_policy: "queue" } },
            mcp_server: { enabled: true, id: "openbot-scout", enable_tilde_control_plane: true },
            skill_registry: {
              enabled: true,
              enabled_skills: { managed: [{ provider_id: "cua" }] },
            },
            memory: { bank: { enabled: true, name: "OpenBot scout memory" } },
          });
          expect(body.memory.wiki).toBeUndefined();
          return Response.json(operation("queued", false));
        }
        if (request.method === "GET" && path.endsWith("/agents/scout/provision")) {
          polled = true;
          return Response.json(operation("active", true));
        }
        if (request.method === "POST" && path.endsWith("/provision/outputs/claim"))
          return Response.json({
            values: { api_key: "agent-api-key", webhook_signing_key: "signing-key" },
          });
        if (request.method === "PUT" && path.endsWith("/agents/scout/avatar")) {
          expect(persistedSecrets).toEqual([
            "AGENT_SCOUT_API_KEY",
            "AGENT_SCOUT_WEBHOOK_SIGNING_KEY",
          ]);
          expect(context.environment.AGENT_SCOUT_API_KEY).toBe("agent-api-key");
          expect(request.headers.get("authorization")).toBe("Bearer agent-api-key");
          expect(request.headers.get("content-type")).toBe("image/png");
          const bytes = new Uint8Array(await request.arrayBuffer());
          expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
          return Response.json({
            principal_user_id: "machine-scout",
            avatar: { media_type: "image/png", size_bytes: bytes.length, sha256: "hash" },
          });
        }
        if (request.method === "GET" && path.endsWith("/channels"))
          return Response.json({
            items: channelCreated
              ? [
                  {
                    id: "openbot-chatkit-workspace-scout",
                    configuration: { default_agent_inbox_id: "scout" },
                  },
                ]
              : [],
          });
        if (request.method === "POST" && path.endsWith("/channels/vercel-ui")) {
          channelCreated = true;
          return Response.json({ id: "openbot-chatkit-workspace-scout", status: "enabled" });
        }
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      }),
    );

    await new TildeAgentProvider(config).deployable.deploy(context);

    expect(polled).toBe(true);
    expect(external).toHaveBeenCalledOnce();
    expect(context.environment).toMatchObject({
      AGENT_SCOUT_API_KEY: "agent-api-key",
      AGENT_SCOUT_WEBHOOK_SIGNING_KEY: "signing-key",
      AGENT_SCOUT_MCP_SERVER_ID: "openbot-scout",
    });
    expect(requests.some((request) => request.url.endsWith("/provision/outputs/claim"))).toBe(true);
  });

  it("preserves credentials and adopts legacy resource IDs on a repeated deployment", async () => {
    vi.spyOn(TildeSkillReconciler.prototype, "bundleSkills").mockResolvedValue({
      custom: [],
      managed: [],
    });
    vi.spyOn(TildeToolReconciler.prototype, "deployExternalResources").mockResolvedValue();
    const context = await agentContext("scout");
    Object.assign(context.environment, {
      AGENT_SCOUT_API_KEY: "existing-key",
      AGENT_SCOUT_WEBHOOK_SIGNING_KEY: "existing-signing-key",
      AGENT_SCOUT_MCP_SERVER_ID: "legacy-mcp",
      AGENT_SCOUT_SKILL_REGISTRY_ID: "11111111-1111-4111-8111-111111111111",
      AGENT_SCOUT_PROVIDER_ID: "legacy-provider",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        if (request.method === "PUT" && path.endsWith("/agents/scout/provision")) {
          expect(await request.json()).toMatchObject({
            agent: { credential_strategy: "preserve" },
            mcp_server: { id: "legacy-mcp" },
            skill_registry: { id: "11111111-1111-4111-8111-111111111111" },
          });
          return Response.json(operation("active", false, "legacy-mcp"));
        }
        if (request.method === "PUT" && path.endsWith("/agents/scout/avatar")) {
          expect(request.headers.get("authorization")).toBe("Bearer existing-key");
          return Response.json({ principal_user_id: "machine-scout", avatar: {} });
        }
        if (request.method === "GET" && path.endsWith("/channels"))
          return Response.json({
            items: [
              {
                id: "openbot-chatkit-workspace-scout",
                configuration: { default_agent_inbox_id: "scout" },
              },
            ],
          });
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      }),
    );

    await new TildeAgentProvider(config).deployable.deploy(context);

    expect(context.environment.AGENT_SCOUT_PROVIDER_ID).toBeUndefined();
    expect(context.environment.AGENT_SCOUT_SKILL_REGISTRY_ID).toBeUndefined();
    expect(context.environment.AGENT_SCOUT_MCP_SERVER_ID).toBe("legacy-mcp");
  });

  it("reports durable provisioning failures", async () => {
    vi.spyOn(TildeSkillReconciler.prototype, "bundleSkills").mockResolvedValue({
      custom: [],
      managed: [],
    });
    const context = await agentContext("scout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ ...operation("error", false), error_message: "wiki provider unavailable" }),
      ),
    );
    await expect(new TildeAgentProvider(config).deployable.deploy(context)).rejects.toThrow(
      "wiki provider unavailable",
    );
  });
});

async function agentContext(slug: string): Promise<DeploymentContext> {
  const root = await mkdtemp(join(tmpdir(), "openbot-agent-provider-"));
  temporaryRoots.push(root);
  const directory = join(root, "configuration", "agents", slug);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "agent.ts"), "export default {}\n");
  return {
    devMode: true,
    repositoryRoot: root,
    environment: { AGENT_SCOUT_NAME: "Scout" },
    inputs: new DeploymentOutputs(),
    agentId: slug,
    agentPath: directory,
    agentServiceOrigin: "http://127.0.0.1:4100",
    report: () => undefined,
  };
}

function operation(status: string, outputsAvailable: boolean, mcpId = "openbot-scout") {
  return {
    operation_id: "operation-one",
    org_id: "org-one",
    team_id: "team-one",
    agent_id: "scout",
    owner_user_id: "human-owner",
    generation: 1,
    status,
    attempts: 1,
    outputs_available: outputsAvailable,
    resources: [{ kind: "mcp_server", key: "default", id: mcpId, created_by_operation: true }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
