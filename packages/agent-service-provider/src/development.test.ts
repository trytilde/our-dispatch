import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createAgentServiceApp } from "./development.js";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("development agent diagnostics", () => {
  it("logs the authored-agent stack when a handler throws", async () => {
    const root = await agentRoot(
      `export default async function endpoint() { throw new Error("agent exploded") }\n`,
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = await createAgentServiceApp(root);

    const response = await app.request("http://openbot.test/api/agents/factory", {
      method: "POST",
    });

    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalledWith(
      "[openbot-agent] request failed",
      expect.objectContaining({
        agentId: "factory",
        method: "POST",
        path: "/api/agents/factory",
        phase: "handler",
      }),
      expect.objectContaining({ message: "agent exploded" }),
    );
  });

  it("logs failures raised while the response stream is consumed", async () => {
    const root = await agentRoot(`
      export default async function endpoint() {
        return new Response(new ReadableStream({
          pull() { throw new Error("stream exploded") }
        }))
      }
    `);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = await createAgentServiceApp(root);
    const response = await app.request("http://openbot.test/api/agents/factory", {
      method: "POST",
    });

    await expect(response.text()).rejects.toThrow("stream exploded");
    expect(error).toHaveBeenCalledWith(
      "[openbot-agent] request failed",
      expect.objectContaining({ agentId: "factory", phase: "stream" }),
      expect.objectContaining({ message: "stream exploded" }),
    );
  });

  it("serves an agent scaffolded after the development app starts", async () => {
    const root = await agentRoot(
      `export default async function endpoint() { return new Response("factory") }\n`,
    );
    const app = await createAgentServiceApp(root);
    await writeAgent(
      join(root, "configuration/agent/subagents/helloy"),
      `export default async function endpoint() { return new Response("helloy", { status: 202 }) }\n`,
    );

    const response = await app.request("http://openbot.test/api/agents/helloy", {
      method: "POST",
    });

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe("helloy");
  });

  it("refreshes persisted environment before importing a late agent", async () => {
    const root = await agentRoot(
      `export default async function endpoint() { return new Response("factory") }\n`,
    );
    const previous = process.env.AGENT_HELLOY_WEBHOOK_SIGNING_KEY;
    delete process.env.AGENT_HELLOY_WEBHOOK_SIGNING_KEY;
    const refreshEnvironment = vi.fn(() => {
      process.env.AGENT_HELLOY_WEBHOOK_SIGNING_KEY = "fresh-key";
    });
    const app = await createAgentServiceApp(root, { refreshEnvironment });
    await writeAgent(
      join(root, "configuration/agent/subagents/helloy"),
      `const key = process.env.AGENT_HELLOY_WEBHOOK_SIGNING_KEY; export default async function endpoint() { return new Response(key) }\n`,
    );

    try {
      const response = await app.request("http://openbot.test/api/agents/helloy", {
        method: "POST",
      });

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("fresh-key");
      expect(refreshEnvironment).toHaveBeenCalledOnce();
    } finally {
      if (previous === undefined) delete process.env.AGENT_HELLOY_WEBHOOK_SIGNING_KEY;
      else process.env.AGENT_HELLOY_WEBHOOK_SIGNING_KEY = previous;
    }
  });
});

async function agentRoot(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-agent-diagnostics-"));
  roots.push(root);
  const directory = join(root, "configuration/agent");
  await writeAgent(directory, source);
  return root;
}

async function writeAgent(directory: string, source: string): Promise<void> {
  await mkdir(join(directory, "tools"), { recursive: true });
  for (const name of [
    "await_shell",
    "bash",
    "copy_from_computer",
    "copy_to_computer",
    "glob",
    "grep",
    "read_file",
    "screenshot",
    "write_file",
  ])
    await writeFile(join(directory, "tools", `${name}.ts`), "export default {}\n");
  await writeFile(join(directory, "agent.ts"), source);
}
