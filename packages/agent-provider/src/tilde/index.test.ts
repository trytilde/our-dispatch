import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeploymentOutputs, type DeploymentContext } from "@tryopenbot/runtime-provider";
import { ResourceAccessMode } from "@trytilde/sdk/api";
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

  it("provisions a resource-constrained agent with only a fixed MCP server", async () => {
    const skills = vi.spyOn(TildeSkillReconciler.prototype, "bundleSkills").mockResolvedValue({
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
    let removedMappedTools = false;
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push(request.clone());
        const path = new URL(request.url).pathname;
        if (request.method === "PUT" && path.endsWith("/agents/scout/provision")) {
          const body = (await request.json()) as { memory?: unknown };
          expect(body).toMatchObject({
            agent: { credential_strategy: "rotate", endpoint: { concurrency_policy: "queue" } },
            mcp_server: {
              enabled: true,
              id: "openbot-scout",
              dynamic_tool_discovery: false,
              enable_tilde_control_plane: false,
            },
            skill_registry: { enabled: false },
          });
          expect(body.memory).toBeUndefined();
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
          expect(request.headers.get("x-api-key")).toBe("secret");
          expect(request.headers.get("authorization")).toBeNull();
          expect(request.headers.get("content-type")).toBe("image/png");
          const bytes = new Uint8Array(await request.arrayBuffer());
          expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
          return Response.json({
            principal_user_id: "machine-scout",
            avatar: { media_type: "image/png", size_bytes: bytes.length, sha256: "hash" },
          });
        }
        if (request.method === "GET" && path.endsWith("/mcp/mcp-server/openbot-scout"))
          return Response.json({
            id: "openbot-scout",
            name: "OpenBot scout",
            org_id: "org-one",
            team_id: "team-one",
            is_dynamic_tool_discovery: false,
            tools: [
              {
                tool_group_source_type_id: "browser",
                tool_group_instance_id: "human-approval",
                tool_source_type_id: "wait_for_human_assistance_to_complete",
                tool_name: "wait_for_human_assistance_to_complete",
              },
            ],
          });
        if (
          request.method === "DELETE" &&
          path.endsWith("/mcp/mcp-server/openbot-scout/functions")
        ) {
          expect(await request.json()).toEqual({
            tool_group_source_type_id: "browser",
            tool_group_instance_id: "human-approval",
            tool_source_type_ids: ["wait_for_human_assistance_to_complete"],
          });
          removedMappedTools = true;
          return Response.json({
            id: "openbot-scout",
            name: "OpenBot scout",
            org_id: "org-one",
            team_id: "team-one",
            is_dynamic_tool_discovery: false,
            tools: [],
          });
        }
        if (request.method === "PUT" && path.endsWith("/agents/scout/permissions")) {
          expect(await request.json()).toEqual({
            delegate_to_other_agents: { mode: "only", ids: ["computer"] },
          });
          return Response.json({ id: "scout" });
        }
        if (
          request.method === "POST" &&
          (path.endsWith("/agents/scout/visibility") || path.endsWith("/agents/scout/ownership"))
        ) {
          expect(await request.json()).toEqual({ mode: "team" });
          return Response.json({
            org_id: "org-one",
            team_id: "team-one",
            visibility: "team",
            ownership: "team",
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

    await new TildeAgentProvider(config, {
      resourcePolicy: () => ({
        enableExternalTools: false,
        authorization: {
          visibility: ResourceAccessMode.TEAM,
          ownership: ResourceAccessMode.TEAM,
        },
        enableSkillRegistry: false,
        enableMcpServer: true,
        enableMcpDynamicToolDiscovery: false,
        enableMappedMcpTools: false,
        enableTildeControlPlane: false,
        permissions: { delegate_to_other_agents: { mode: "only", ids: ["computer"] } },
      }),
    }).deployable.deploy(context);

    expect(polled).toBe(true);
    expect(skills).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
    expect(removedMappedTools).toBe(true);
    expect(context.environment).toMatchObject({
      AGENT_SCOUT_API_KEY: "agent-api-key",
      AGENT_SCOUT_WEBHOOK_SIGNING_KEY: "signing-key",
    });
    expect(context.environment.AGENT_SCOUT_MCP_SERVER_ID).toBe("openbot-scout");
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
            mcp_server: { id: "legacy-mcp", enable_tilde_control_plane: true },
            skill_registry: { id: "11111111-1111-4111-8111-111111111111" },
          });
          return Response.json(operation("active", false, "legacy-mcp"));
        }
        if (request.method === "PUT" && path.endsWith("/agents/scout/avatar")) {
          expect(request.headers.get("x-api-key")).toBe("secret");
          expect(request.headers.get("authorization")).toBeNull();
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

  it("removes the agent bundle, channel, and persisted configuration idempotently", async () => {
    const context = await agentContext("scout");
    const external = vi
      .spyOn(TildeToolReconciler.prototype, "removeExternalResources")
      .mockResolvedValue();
    Object.assign(context.environment, {
      AGENT_SCOUT_NAME: "Scout",
      AGENT_SCOUT_API_KEY: "agent-api-key",
      AGENT_SCOUT_WEBHOOK_SIGNING_KEY: "signing-key",
      AGENT_SCOUT_MCP_SERVER_ID: "openbot-scout",
      AGENT_SCOUT_COMPUTER_SERVICE_URL: "https://computer.test",
    });
    const unsetEnvironment: string[] = [];
    const unsetSecret: string[] = [];
    context.persistence = {
      setEnvironment: async () => undefined,
      setSecret: async () => undefined,
      unsetEnvironment: async (name) => {
        unsetEnvironment.push(name);
        delete context.environment[name];
      },
      unsetSecret: async (name) => {
        unsetSecret.push(name);
        delete context.environment[name];
      },
    };
    let getCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        if (
          request.method === "DELETE" &&
          path.endsWith("/channels/openbot-chatkit-workspace-scout")
        )
          return Response.json({ success: true });
        if (request.method === "DELETE" && path.endsWith("/agents/scout"))
          return Response.json({ success: true });
        if (request.method === "GET" && path.endsWith("/agents/scout")) {
          getCount += 1;
          return getCount === 1
            ? Response.json({ agent: { id: "scout" } })
            : Response.json({ name: "NotFound", message: "Agent not found" }, { status: 404 });
        }
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      }),
    );

    await new TildeAgentProvider(config).remove(context);

    expect(external).toHaveBeenCalledWith(context);
    expect(getCount).toBe(2);
    expect(unsetSecret).toEqual(["AGENT_SCOUT_API_KEY", "AGENT_SCOUT_WEBHOOK_SIGNING_KEY"]);
    expect(unsetEnvironment).toEqual(
      expect.arrayContaining([
        "AGENT_SCOUT_NAME",
        "AGENT_SCOUT_MCP_SERVER_ID",
        "AGENT_SCOUT_COMPUTER_SERVICE_URL",
      ]),
    );
    expect(context.environment).not.toHaveProperty("AGENT_SCOUT_NAME");
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
