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
});

async function agentRoot(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-agent-diagnostics-"));
  roots.push(root);
  const directory = join(root, "configuration/agent");
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
  return root;
}
