import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents } from "@tryopenbot/agent-service-provider";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { VercelAgentServiceProvider } from "@tryopenbot/agent-service-provider";
import { CodexInferenceProvider } from "@tryopenbot/inference-provider";
import { DeploymentOutputs } from "@tryopenbot/runtime-provider";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  agentIdFromName,
  agentTemplateDirectory,
  scaffoldAgent,
  scaffoldAgentTemplates,
  scaffoldMemoryCatcherAgent,
  scaffoldPrimaryAgent,
} from "./agent-scaffold.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("agent scaffolding", () => {
  it("derives a stable path id from the entered name", () => {
    expect(agentIdFromName("  Café Research  ")).toBe("cafe-research");
    expect(() => agentIdFromName("---")).toThrow("letter or number");
  });

  it("materializes the supported agent tree with fixed-id shared computer tools", async () => {
    const root = await temporaryRepository();
    await scaffoldAgentTemplates(root);
    const primary = await scaffoldPrimaryAgent(root, "Factory");
    const agent = await scaffoldAgent(root, "Research Assistant");

    expect(primary).toMatchObject({ id: "factory", name: "Factory" });
    expect(agent).toMatchObject({ id: "research-assistant", name: "Research Assistant" });
    const directory = join(root, "configuration/agent/subagents/research-assistant");
    expect(await readFile(join(root, "configuration/agent/instrumentation.ts"), "utf8")).toContain(
      "setup",
    );
    expect(
      await readFile(join(root, "configuration/agent/sandbox/workspace/README.md"), "utf8"),
    ).toContain("Factory");
    const agentSource = await readFile(join(directory, "agent.ts"), "utf8");
    expect(agentSource).toContain("process.env.AGENT_RESEARCH_ASSISTANT_API_KEY!");
    expect(agentSource).not.toContain("requiredEnv");
    expect(agentSource).not.toContain("runtime-providers");
    expect(agentSource).toContain("context.mcp.connect");
    expect(agentSource).not.toContain("createMCPClient({");
    expect(agentSource).not.toContain("@tryopenbot/agent-provider");
    expect(agentSource).not.toContain("@tryopenbot/tools-provider");
    expect(agentSource).toContain("AGENT_RESEARCH_ASSISTANT_MCP_SERVER_ID");
    expect(agentSource).toContain("tools: await localTools(sessionId)");
    expect(agentSource).toContain("createCuaTools");
    expect(agentSource).toContain("existingToolNames: Object.keys(standardTools)");
    expect(agentSource).toContain(
      'import createProposeSelfExtensionTool from "./tools/propose_self_extension.js"',
    );
    expect(agentSource).toContain(
      "propose_self_extension: createProposeSelfExtensionTool({ client, sessionId })",
    );
    const proposalToolSource = await readFile(
      join(directory, "tools/propose_self_extension.ts"),
      "utf8",
    );
    expect(proposalToolSource).toContain('requestingAgentId: "research-assistant"');
    expect(proposalToolSource).toContain("options.client.selfExtension.propose");
    expect(agentSource).toContain("createTildeAttachmentMessageHandlers(client, context)");
    expect(agentSource).toContain("createTildeMediaUploader");
    expect(agentSource).toContain("createTildeMediaDownloader");
    expect(agentSource).not.toContain("base64");
    expect(agentSource).not.toContain("AGENT_RESEARCH_ASSISTANT_SKILL_REGISTRY_ID");
    expect(agentSource).not.toContain("function addTools");
    expect(agentSource).not.toContain("searchSkillRegistry");
    expect(agentSource).not.toContain("TILDE_BASE_URL");
    expect(agentSource).toContain("prepareInference(tools, request.signal, jobModelId)");
    expect(agentSource).toContain("HostedInferenceBillingController");
    expect(agentSource).toContain("OPENBOT_HOSTED_INFERENCE_BILLING");
    expect(agentSource).toContain("onLanguageModelCallStart");
    expect(agentSource).toContain("onLanguageModelCallEnd");
    expect(agentSource).toContain("inferenceBilling.preflight");
    expect(agentSource).toContain("inferenceBilling.fail");
    expect(agentSource).toContain("effectScope: `continuation:");
    expect(agentSource).toContain("status: creditsExhausted ? 402 : 503");
    const costBudgetGate = agentSource.slice(
      agentSource.indexOf("jobBudget?.max_cost_microusd"),
      agentSource.indexOf("const history"),
    );
    expect(costBudgetGate).toContain("!costMeterAvailable()");
    expect(costBudgetGate).toContain("!hostedInferenceBillingEnabled");
    expect(costBudgetGate).toContain("cost_meter_unavailable");
    const billingPreflight = agentSource.slice(
      agentSource.indexOf("await inferenceBilling.preflight"),
      agentSource.indexOf("const streamOptions"),
    );
    expect(billingPreflight).toContain('status: creditsExhausted ? "paused" : "failed"');
    expect(billingPreflight).not.toContain('status: "waiting"');
    expect(billingPreflight).toContain("run failed safely");
    expect(agentSource).toContain("agentRun ??= await client.chatkit.runs.create");
    expect(agentSource).toContain("idempotencyKey: triggerId");
    expect(agentSource).toContain("!requiresReconciliation");
    expect(agentSource).toContain("model_failed_before_provider_start");
    expect(agentSource).not.toContain("@ai-sdk/openai");
    expect(agentSource).not.toContain("OPENAI_API_KEY");
    expect(agentSource).not.toContain("openai(");
    expect(agentSource).toContain("instructions,");
    const inferenceSource = await readFile(join(directory, "inference.ts"), "utf8");
    expect(inferenceSource).toContain('modelId ?? process.env.AI_MODEL ?? "openai/gpt-5.6-sol"');
    expect(inferenceSource).toContain('reasoning: "medium"');
    expect(agentSource).not.toContain("Your name is");
    expect(agentSource).not.toContain("lib/identity");
    const instructionsSource = await readFile(join(directory, "instructions.ts"), "utf8");
    expect(instructionsSource).toContain("process.env.AGENT_RESEARCH_ASSISTANT_NAME!");
    expect(instructionsSource).toContain("Your name is ${agentName}.");
    expect(instructionsSource).toContain("acknowledge the request");
    expect(instructionsSource).toContain("Use search_skills");
    expect(instructionsSource).toContain("ordinary direct tools");
    await expect(access(join(directory, "lib/identity.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(directory, "tools/bash.ts"), "utf8")).toContain(
      'createBashTool({ agentId: "research-assistant", baseUrl })',
    );
    expect(await readFile(join(directory, "tools/await_shell.ts"), "utf8")).toContain(
      "createAwaitShellTool",
    );
    expect(await readFile(join(directory, "tools/screenshot.ts"), "utf8")).toContain(
      "createScreenshotTool",
    );
    expect(await readFile(join(directory, "tools/copy_from_computer.ts"), "utf8")).toContain(
      "createCopyFromComputerTool",
    );
    expect(await readFile(join(directory, "tools/copy_to_computer.ts"), "utf8")).toContain(
      "createCopyToComputerTool",
    );
    expect(await readFile(join(directory, "tools/manage_goals.ts"), "utf8")).toContain(
      'encodeURIComponent("research-assistant")',
    );
    expect(await readFile(join(directory, "tools/manage_tasks.ts"), "utf8")).toContain(
      'encodeURIComponent("research-assistant")',
    );
    expect(await readFile(join(directory, "tools/manage_routines.ts"), "utf8")).toContain(
      'const agentId = "research-assistant"',
    );
    expect(
      await readFile(join(root, "configuration/agent/skills/create-agent/SKILL.md"), "utf8"),
    ).toContain('pnpm openbot new-agent "<display name>"');
    expect(
      await readFile(join(root, "configuration/agent/skills/develop-openbot/SKILL.md"), "utf8"),
    ).toContain("openbot/sandbox-edits");
    // Factory-only skills never scaffold into subagents; subagents get self-edit instead.
    await expect(access(join(directory, "skills/create-agent/SKILL.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const selfEditSkill = await readFile(join(directory, "skills/self-edit/SKILL.md"), "utf8");
    expect(selfEditSkill).toContain("name: research-assistant-self-edit");
    expect(selfEditSkill).toContain("configuration/agent/subagents/research-assistant");
    await expect(
      access(join(root, "configuration/agent/skills/self-edit/SKILL.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(directory, "tools/factory.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(scaffoldAgent(root, "Research Assistant")).rejects.toThrow("already exists");
    await expect(
      scaffoldAgent(root, "Research Assistant", { existing: "preserve" }),
    ).resolves.toMatchObject({ id: "research-assistant" });
  });

  it("loads fork-owned templates and preserves owner changes when init runs again", async () => {
    const root = await temporaryRepository();
    const templateRoot = await scaffoldAgentTemplates(root);
    const customTemplate = join(templateRoot, "lib/custom.ts.hbs");
    await mkdir(join(templateRoot, "lib"), { recursive: true });
    await writeFile(customTemplate, "export const id = {{{AGENT_ID_JSON}}};\n", "utf8");
    await writeFile(
      join(templateRoot, "instructions.ts.hbs"),
      "export default `Custom instructions for {{AGENT_NAME}}`;\n",
      "utf8",
    );

    await scaffoldAgentTemplates(root);
    await scaffoldPrimaryAgent(root, "Factory");
    await scaffoldAgent(root, "Custom Agent");

    expect(
      await readFile(
        join(root, "configuration/agent/subagents/custom-agent/lib/custom.ts"),
        "utf8",
      ),
    ).toBe('export const id = "custom-agent";\n');
    expect(
      await readFile(
        join(root, "configuration/agent/subagents/custom-agent/instructions.ts"),
        "utf8",
      ),
    ).toContain("Custom instructions for Custom Agent");
    expect(await readFile(customTemplate, "utf8")).toContain("AGENT_ID_JSON");
  });

  it("materializes the least-privilege Memory Catcher agent", async () => {
    const root = await temporaryRepository();
    await scaffoldAgentTemplates(root);
    await scaffoldPrimaryAgent(root, "Factory");
    const catcher = await scaffoldMemoryCatcherAgent(root);
    const directory = join(root, "configuration/agent/subagents/memory-catcher");

    expect(catcher).toMatchObject({ id: "memory-catcher", name: "Memory Catcher", directory });
    expect((await readdir(directory)).toSorted()).toEqual([
      "agent.ts",
      "inference.ts",
      "instructions.ts",
      "instrumentation.ts",
      "skills",
      "tools",
    ]);
    const catcherSource = await readFile(join(directory, "agent.ts"), "utf8");
    expect(catcherSource).toContain('responseMode: "agentLoop"');
    expect(catcherSource).not.toContain('responseMode: "tool"');
    expect(catcherSource).toContain("prepareInference(tools as ToolSet, request.signal)");
    expect(catcherSource).toContain("createMemorySynthesisInferenceRun");
    expect(catcherSource).toContain('message.role !== "system"');
    expect(catcherSource).toContain("messages: context.messages");
    expect(catcherSource).not.toContain("context.session.history()");
    expect(catcherSource).toContain("OPENBOT_HOSTED_INFERENCE_BILLING");
    expect(catcherSource).toContain("onLanguageModelCallStart");
    expect(catcherSource).toContain("failForReconciliation");
    expect(catcherSource).not.toContain('model: "zai/glm-5.3-flash"');
    expect(await readFile(join(directory, "instructions.ts"), "utf8")).toContain(
      "Never, ever invoke sendMessage",
    );
    expect(await readFile(join(directory, "skills/memory-synthesis/SKILL.md"), "utf8")).toContain(
      "OpenViking/OKF",
    );
    await expect(access(join(directory, "tools/bash.ts"))).resolves.toBeUndefined();
    expect(await readFile(join(directory, "inference.ts"), "utf8")).toContain(
      'modelId ?? process.env.AI_MODEL ?? "openai/gpt-5.6-sol"',
    );
    await expect(discoverAgents(root)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "memory-catcher",
          path: join(directory, "agent.ts"),
          instrumentationPath: join(directory, "instrumentation.ts"),
        }),
      ]),
    );
  });

  it("never exposes a partial agent when a late template fails", async () => {
    const root = await temporaryRepository();
    await scaffoldAgentTemplates(root);
    await scaffoldPrimaryAgent(root, "Factory");
    await writeFile(
      join(root, "configuration/templates/subagent/broken.ts.hbs"),
      "export const broken = {{MISSING_VALUE}};\n",
      "utf8",
    );
    const destination = join(root, "configuration/agent/subagents/final-boss");
    let settled = false;
    let destinationBecameVisible = false;
    const outcome = scaffoldAgent(root, "Final Boss")
      .then(() => undefined)
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    while (!settled) {
      try {
        await access(destination);
        destinationBecameVisible = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await setImmediate();
    }

    await expect(outcome).resolves.toBeInstanceOf(Error);
    expect(destinationBecameVisible).toBe(false);
    await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(join(root, ".cache/agent-scaffolds"))).toEqual([]);
  });

  it("accepts an inference-provider contribution for future agents", async () => {
    const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
    const root = await mkdtemp(join(workspaceRoot, ".openbot-agent-typecheck-"));
    temporaryDirectories.push(root);
    await Promise.all(
      ["tsconfig.base.json", "tsconfig.node.json"].map((name) =>
        copyFile(join(workspaceRoot, name), join(root, name)),
      ),
    );
    const provider = new CodexInferenceProvider();
    await scaffoldAgentTemplates(root, provider.agentTemplate.files);
    await scaffoldPrimaryAgent(root, "Factory");
    await writeFile(
      join(root, "configuration/instrumentation.ts"),
      "export default { setup() {} };\n",
      "utf8",
    );

    const inference = await readFile(join(root, "configuration/agent/inference.ts"), "utf8");
    expect(inference).toContain("createCodexAppServer");
    expect(inference).toContain('const defaultModel = "gpt-5.6-sol"');
    expect(inference).toContain("createSdkMcpServer");
    await scaffoldMemoryCatcherAgent(root);
    const catcherInference = await readFile(
      join(root, "configuration/agent/subagents/memory-catcher/inference.ts"),
      "utf8",
    );
    expect(catcherInference).toContain("createCodexAppServer");
    expect(catcherInference).toContain('const defaultModel = "gpt-5.6-sol"');
    await expect(
      new VercelAgentServiceProvider().check({
        devMode: true,
        repositoryRoot: root,
        environment: process.env,
        inputs: new DeploymentOutputs(),
        report: () => undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects inference-provider templates that escape the agent template directory", async () => {
    const root = await temporaryRepository();
    const source = new CodexInferenceProvider().agentTemplate.files[0]!.source;

    await expect(
      scaffoldAgentTemplates(root, [{ path: "../outside.ts.hbs", source }]),
    ).rejects.toThrow("Invalid inference agent template path");
    await expect(access(join(root, "configuration/templates/agent"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("requires init to seed the fork-owned agent template", async () => {
    const root = await temporaryRepository();
    await expect(scaffoldPrimaryAgent(root, "Factory")).rejects.toThrow(
      `${agentTemplateDirectory} is missing; run openbot init`,
    );
  });

  it("materializes a primary agent accepted by the real agent-service typecheck", async () => {
    const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
    const root = await mkdtemp(join(workspaceRoot, ".openbot-agent-typecheck-"));
    temporaryDirectories.push(root);
    await Promise.all(
      ["tsconfig.base.json", "tsconfig.node.json"].map((name) =>
        copyFile(join(workspaceRoot, name), join(root, name)),
      ),
    );
    await scaffoldAgentTemplates(root);
    await scaffoldPrimaryAgent(root, "Factory");
    await mkdir(join(root, "configuration"), { recursive: true });
    await writeFile(
      join(root, "configuration/instrumentation.ts"),
      "export default { setup() {} };\n",
      "utf8",
    );

    await expect(
      new VercelAgentServiceProvider().check({
        devMode: true,
        repositoryRoot: root,
        environment: process.env,
        inputs: new DeploymentOutputs(),
        report: () => undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects an incomplete fork-owned agent template", async () => {
    const root = await temporaryRepository();
    const templateRoot = await scaffoldAgentTemplates(root);
    await rm(join(templateRoot, "tools/bash.ts.hbs"));

    await expect(scaffoldPrimaryAgent(root, "Factory")).rejects.toThrow(
      `${agentTemplateDirectory}/tools/bash.ts.hbs`,
    );
    await expect(access(join(root, "configuration/agent"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

async function temporaryRepository(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openbot-agent-scaffold-"));
  temporaryDirectories.push(path);
  return path;
}
