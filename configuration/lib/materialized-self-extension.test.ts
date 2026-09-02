import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const configurationRoot = resolve(import.meta.dirname, "..");

describe("materialized self-extension tools", () => {
  it("registers the propose-only tool for existing and future agents", async () => {
    const agents = [
      {
        source: "agent/agent.ts",
        tool: "agent/tools/propose_self_extension.ts",
        requestingAgentId: 'requestingAgentId: "factory"',
      },
      {
        source: "agent/subagents/pirate-poet/agent.ts",
        tool: "agent/subagents/pirate-poet/tools/propose_self_extension.ts",
        requestingAgentId: 'requestingAgentId: "pirate-poet"',
      },
      {
        source: "templates/agent/agent.ts.hbs",
        tool: "templates/agent/tools/propose_self_extension.ts.hbs",
        requestingAgentId: "requestingAgentId: {{{AGENT_ID_JSON}}}",
      },
    ] as const;

    for (const agent of agents) {
      const source = await readFile(resolve(configurationRoot, agent.source), "utf8");
      const tool = await readFile(resolve(configurationRoot, agent.tool), "utf8");
      expect(source).toContain(
        'import createProposeSelfExtensionTool from "./tools/propose_self_extension.js"',
      );
      expect(source).toContain(
        "propose_self_extension: createProposeSelfExtensionTool({ client, sessionId })",
      );
      expect(tool).toContain(agent.requestingAgentId);
      expect(tool).toContain("options.client.selfExtension.propose");
      expect(tool).not.toContain(".approve(");
      expect(tool).not.toContain(".execute(");
      expect(tool).not.toContain(".claimOutputs(");
      expect(tool).not.toContain(".rollback(");
    }
  });
});
