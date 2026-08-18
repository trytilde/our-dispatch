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
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("TildeAgentProvider", () => {
  it("depends on the shared Tilde setup", () => {
    expect(new TildeAgentProvider(config).platforms.map(({ id }) => id)).toEqual(["tilde"]);
  });

  it("idempotently reconciles one agent and persists its credentials", async () => {
    const skills = vi.spyOn(TildeSkillReconciler.prototype, "deploy").mockResolvedValue();
    const tools = vi.spyOn(TildeToolReconciler.prototype, "deploy").mockResolvedValue();
    const context = await agentContext("scout");
    let created = false;
    let channelCreated = false;
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push(request.clone());
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/agents/scout")) {
          if (!created) return Response.json({ message: "missing" }, { status: 404 });
          return Response.json(agent());
        }
        if (request.method === "POST" && path.endsWith("/agents/http-vercel-ai-sdk")) {
          created = true;
          expect(await request.json()).toMatchObject({
            id: "scout",
            display_name: "Scout",
            endpoint_url: "http://127.0.0.1:4100/api/agents/scout",
            local_running_endpoint: true,
          });
          return Response.json({
            agent: agent(),
            api_key: "agent-api-key",
            webhook_signing_key: "signing-key",
          });
        }
        if (request.method === "GET" && path.endsWith("/channels")) {
          return Response.json({
            items: channelCreated
              ? [
                  {
                    id: "openbot-mission-control-scout",
                    provider_id: "chatkit.vercel-ui",
                    status: "enabled",
                    configuration: { default_agent_inbox_id: "scout" },
                  },
                ]
              : [],
          });
        }
        if (request.method === "POST" && path.endsWith("/channels/vercel-ui")) {
          channelCreated = true;
          expect(await request.json()).toMatchObject({
            id: "openbot-mission-control-scout",
            display_name: "OpenBot Mission Control: scout",
            default_agent_inbox_id: "scout",
          });
          return Response.json({
            id: "openbot-mission-control-scout",
            provider_id: "chatkit.vercel-ui",
            status: "enabled",
          });
        }
        if (request.method === "PATCH") return Response.json(agent());
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      }),
    );
    const provider = new TildeAgentProvider(config);

    await provider.deployable.deploy(context);
    await provider.deployable.deploy(context);

    expect(context.environment).toMatchObject({
      AGENT_SCOUT_AGENT_ID: "scout",
      AGENT_SCOUT_PROVIDER_ID: "chatkit.http-vercel-ai-sdk",
      AGENT_SCOUT_API_KEY: "agent-api-key",
      AGENT_SCOUT_WEBHOOK_SIGNING_KEY: "signing-key",
    });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(2);
    expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
    expect(skills).toHaveBeenCalledTimes(2);
    expect(tools).toHaveBeenCalledTimes(2);
  });

  it("reports the Tilde operation, agent, API detail, and HTTP status", async () => {
    vi.spyOn(TildeSkillReconciler.prototype, "deploy").mockResolvedValue();
    vi.spyOn(TildeToolReconciler.prototype, "deploy").mockResolvedValue();
    const context = await agentContext("scout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ detail: "organization does not own this team" }, { status: 403 }),
      ),
    );

    await expect(new TildeAgentProvider(config).deployable.deploy(context)).rejects.toThrow(
      'Unable to get agent "scout": organization does not own this team (HTTP 403)',
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

function agent() {
  return {
    id: "scout",
    provider_id: "chatkit.http-vercel-ai-sdk",
    display_name: "Scout",
    configuration: {
      endpoint_url: "http://127.0.0.1:4100/api/agents/scout",
      local_running_endpoint: true,
      streaming: true,
      timeout_ms: 300_000,
    },
    status: "enabled",
  };
}
