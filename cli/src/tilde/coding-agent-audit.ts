import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { codexPluginRoot, recordCodexHook } from "@trytilde/sdk-codex";
import { recordClaudeCodeHook } from "@trytilde/sdk-claude-code";
import { recordCursorHook } from "@trytilde/sdk-cursor";
import { recordGeminiCliHook } from "@trytilde/sdk-gemini-cli";
import { opencodePluginPath, recordOpenCodeHook } from "@trytilde/sdk-opencode";
import { createClient } from "@trytilde/sdk";
import type { JsonObject } from "@trytilde/sdk/json";
import { isJsonObject } from "@trytilde/sdk/json";
import type { AgentCli, TildeMcpServerChoice } from "./plugin.js";
import { mcpConfigDocumentForCli } from "./plugin.js";
import { ensureDesktopAuth } from "./plugin-auth.js";

export type CodingAgentAuditInstallation = {
  baseUrl: string;
  teamId: string;
  agentId: string;
};

type CodingAgentAuditStore = {
  installations?: Partial<Record<AgentCli, CodingAgentAuditInstallation>>;
};

export async function writeCodingAgentAuditInstallation(
  cli: AgentCli,
  installation: CodingAgentAuditInstallation,
  homeDir: string,
): Promise<string> {
  const path = codingAgentAuditConfigPath(homeDir);
  const store = await readAuditStore(path);
  store.installations ??= {};
  store.installations[cli] = installation;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  return path;
}

export async function runCodingAgentAuditHook(input: {
  cli: AgentCli;
  homeDir: string;
  apiKey?: string;
  payload: unknown;
}): Promise<void> {
  const store = await readAuditStore(codingAgentAuditConfigPath(input.homeDir));
  const installation = store.installations?.[input.cli];
  if (!installation) return;
  const accessToken = input.apiKey
    ? undefined
    : await ensureDesktopAuth({
        baseUrl: installation.baseUrl,
        homeDir: input.homeDir,
        interactive: false,
      });
  const client = createClient({
    baseUrl: installation.baseUrl,
    teamId: installation.teamId,
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(accessToken ? { bearerToken: accessToken } : {}),
  });
  if (input.cli === "codex") {
    await recordCodexHook({ client, agentId: installation.agentId, input: input.payload });
  } else if (input.cli === "claude") {
    await recordClaudeCodeHook({ client, agentId: installation.agentId, input: input.payload });
  } else if (input.cli === "cursor") {
    await recordCursorHook({ client, agentId: installation.agentId, input: input.payload });
  } else if (input.cli === "opencode") {
    await recordOpenCodeHook({ client, agentId: installation.agentId, input: input.payload });
  } else {
    await recordGeminiCliHook({ client, agentId: installation.agentId, input: input.payload });
  }
}

export async function installCodingAgentAuditHooks(input: {
  cli: AgentCli;
  homeDir: string;
  mcpServers: TildeMcpServerChoice[];
}): Promise<string | undefined> {
  switch (input.cli) {
    case "codex":
      return installCodexPlugin(input.homeDir, input.mcpServers);
    case "claude":
      return mergeClaudeHooks(join(input.homeDir, ".claude", "settings.json"));
    case "cursor":
      return mergeCursorHooks(join(input.homeDir, ".cursor", "hooks.json"));
    case "opencode":
      return installOpenCodePlugin(input.homeDir);
    case "gemini":
      return mergeGeminiHooks(join(input.homeDir, ".gemini", "settings.json"));
  }
}

export function codingAgentAuditConfigPath(homeDir: string): string {
  return join(homeDir, ".tilde", "plugins", "coding-agent-audit.json");
}

async function installCodexPlugin(
  homeDir: string,
  mcpServers: TildeMcpServerChoice[],
): Promise<string> {
  const pluginDir = join(homeDir, "plugins", "tilde");
  await rm(pluginDir, { recursive: true, force: true });
  await mkdir(dirname(pluginDir), { recursive: true });
  await cp(codexPluginRoot(), pluginDir, { recursive: true });
  await writeFile(
    join(pluginDir, ".mcp.json"),
    `${JSON.stringify(mcpConfigDocumentForCli("claude", mcpServers), null, 2)}\n`,
    "utf8",
  );

  const marketplacePath = join(homeDir, ".agents", "plugins", "marketplace.json");
  const marketplace = await readJsonObject(marketplacePath);
  const marketplaceName =
    typeof marketplace.name === "string" && marketplace.name.trim() ? marketplace.name : "personal";
  const entries = Array.isArray(marketplace.plugins)
    ? marketplace.plugins.filter((entry) => !isJsonObject(entry) || entry.name !== "tilde")
    : [];
  entries.push({
    name: "tilde",
    source: { source: "local", path: "./plugins/tilde" },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Productivity",
  });
  const updated = {
    ...marketplace,
    name: marketplaceName,
    interface: isJsonObject(marketplace.interface)
      ? marketplace.interface
      : { displayName: "Personal" },
    plugins: entries,
  };
  await mkdir(dirname(marketplacePath), { recursive: true });
  await writeFile(marketplacePath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  const codexHome = join(homeDir, ".codex");
  await mkdir(codexHome, { recursive: true });
  await runCommand("codex", ["plugin", "add", `tilde@${marketplaceName}`], {
    ...process.env,
    CODEX_HOME: codexHome,
    HOME: homeDir,
    USERPROFILE: homeDir,
  });
  return pluginDir;
}

async function mergeClaudeHooks(path: string): Promise<string> {
  const document = await readJsonObject(path);
  const hooks = isJsonObject(document.hooks) ? document.hooks : {};
  const events = [
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "Stop",
  ];
  for (const event of events) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    const command = "openbot plugin audit --cli claude";
    const hasCommand = JSON.stringify(existing).includes(command);
    hooks[event] = hasCommand
      ? existing
      : [
          ...existing,
          {
            ...(event.includes("ToolUse") ? { matcher: ".*" } : {}),
            hooks: [{ type: "command", command, async: true }],
          },
        ];
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ ...document, hooks }, null, 2)}\n`, "utf8");
  return path;
}

async function mergeCursorHooks(path: string): Promise<string> {
  const document = await readJsonObject(path);
  const hooks = isJsonObject(document.hooks) ? document.hooks : {};
  const events = [
    "sessionStart",
    "sessionEnd",
    "beforeSubmitPrompt",
    "preToolUse",
    "postToolUse",
    "postToolUseFailure",
    "afterAgentResponse",
  ];
  for (const event of events) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    const command = "openbot plugin audit --cli cursor";
    hooks[event] = existing.some((entry) => isJsonObject(entry) && entry.command === command)
      ? existing
      : [...existing, { command }];
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ ...document, version: 1, hooks }, null, 2)}\n`, "utf8");
  return path;
}

async function installOpenCodePlugin(homeDir: string): Promise<string> {
  const path = join(homeDir, ".config", "opencode", "plugins", "tilde-audit.js");
  await mkdir(dirname(path), { recursive: true });
  await cp(opencodePluginPath(), path);
  return path;
}

async function mergeGeminiHooks(path: string): Promise<string> {
  const document = await readJsonObject(path);
  const hooks = isJsonObject(document.hooks) ? document.hooks : {};
  const command = "openbot plugin audit --cli gemini";
  for (const event of ["SessionStart", "SessionEnd", "BeforeAgent", "AfterAgent", "AfterTool"]) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    if (JSON.stringify(existing).includes(command)) continue;
    hooks[event] = [
      ...existing,
      {
        hooks: [
          {
            type: "command",
            command,
            name: "Tilde ChatKit audit",
            timeout: 30_000,
          },
        ],
      },
    ];
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ ...document, hooks }, null, 2)}\n`, "utf8");
  return path;
}

async function readAuditStore(path: string): Promise<CodingAgentAuditStore> {
  const value = await readJsonObject(path);
  return value as CodingAgentAuditStore;
}

async function readJsonObject(path: string): Promise<JsonObject> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return isJsonObject(parsed) ? parsed : {};
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw error;
  }
}

function runCommand(command: string, args: string[], env = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code ?? 1}`)),
    );
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
