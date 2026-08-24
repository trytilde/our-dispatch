import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { type AgentCli, configureTildePluginForCli, ensureDesktopAuth } from "../tilde/plugin.js";

const DEFAULT_TILDE_API_BASE_URL = "https://api.trytilde.ai";

export type TildePluginOptions = {
  cli?: AgentCli;
  baseUrl: string;
  teamId?: string;
  teamName?: string;
  apiKey?: string;
  homeDir: string;
  interactive: boolean;
  launch: boolean;
  command?: string;
  passthrough: string[];
};

const supportedClis = new Set<AgentCli>(["claude", "codex", "cursor", "opencode", "gemini"]);

export function defaultCommandForCli(cli: AgentCli): string {
  return cli;
}

export function parseTildePluginArgs(args: readonly string[]): TildePluginOptions {
  const options: TildePluginOptions = {
    baseUrl: process.env.TILDE_API_BASE_URL ?? DEFAULT_TILDE_API_BASE_URL,
    homeDir: process.env.TILDE_AGENT_HOME ?? homedir(),
    interactive: process.env.CI !== "true",
    launch: false,
    passthrough: [],
  };
  if (process.env.TILDE_TEAM_ID) options.teamId = process.env.TILDE_TEAM_ID;
  if (process.env.TILDE_TEAM_NAME) options.teamName = process.env.TILDE_TEAM_NAME;
  if (process.env.TILDE_API_KEY) options.apiKey = process.env.TILDE_API_KEY;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      options.passthrough = args.slice(index + 1);
      break;
    }
    switch (arg) {
      case "--cli":
        options.cli = parseCliValue(args[++index]);
        break;
      case "--base-url":
        options.baseUrl = requiredValue(args[++index], "--base-url");
        break;
      case "--team-id":
        options.teamId = requiredValue(args[++index], "--team-id");
        break;
      case "--team-name":
        options.teamName = requiredValue(args[++index], "--team-name");
        break;
      case "--api-key":
        options.apiKey = requiredValue(args[++index], "--api-key");
        break;
      case "--home-dir":
        options.homeDir = requiredValue(args[++index], "--home-dir");
        break;
      case "--command":
        options.command = requiredValue(args[++index], "--command");
        options.launch = true;
        break;
      case "--interactive":
        options.interactive = true;
        break;
      case "--non-interactive":
        options.interactive = false;
        break;
      case "--launch":
        options.launch = true;
        break;
      case "--no-launch":
        options.launch = false;
        break;
      case "--help":
      case "-h":
        throw new Error("help");
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export async function runTildePlugin(args: readonly string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(tildePluginHelpText());
    return 0;
  }
  const options = parseTildePluginArgs(args);
  if (!options.cli) {
    throw new Error("Missing --cli. Expected one of: claude, codex, cursor, opencode, gemini.");
  }
  const accessToken = options.apiKey
    ? undefined
    : await ensureDesktopAuth({
        baseUrl: options.baseUrl,
        homeDir: options.homeDir,
        interactive: options.interactive,
      });

  const result = await configureTildePluginForCli(
    options.cli,
    {
      baseUrl: options.baseUrl,
      ...(options.teamId ? { teamId: options.teamId } : {}),
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(accessToken ? { accessToken } : {}),
    },
    {
      homeDir: options.homeDir,
      ...(options.teamName ? { teamName: options.teamName } : {}),
      interactive: options.interactive,
    },
  );

  process.stderr.write(
    `Tilde plugin configured for ${options.cli}\nMCP config: ${result.mcpConfigPath}\nMCP servers enabled: ${result.mcpServerCount}\nSkills installed: ${result.skillFiles.length}\n`,
  );

  if (!options.launch) return 0;
  const command = options.command ?? defaultCommandForCli(options.cli);
  return runChildCommand(command, options.passthrough);
}

function parseCliValue(value: string | undefined): AgentCli {
  const required = requiredValue(value, "--cli");
  if (!supportedClis.has(required as AgentCli)) {
    throw new Error(`Unsupported CLI: ${required}`);
  }
  return required as AgentCli;
}

function requiredValue(value: string | undefined, flag: string): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function runChildCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

export function tildePluginHelpText(): string {
  return `Usage:
  openbot plugin --cli <claude|codex|cursor|opencode|gemini> [options]

Options:
  --base-url <url>       Tilde API base URL. Default: TILDE_API_BASE_URL or ${DEFAULT_TILDE_API_BASE_URL}
  --team-id <id>         Optional team filter. Default: discover all teams from whoami
  --team-name <name>     Display name used in selector labels. Default: TILDE_TEAM_NAME or team ID
  --api-key <key>        API key sent as Authorization: Bearer. Default: TILDE_API_KEY
  --home-dir <path>      Destination home directory. Default: TILDE_AGENT_HOME or OS home
  --interactive          Show checkbox selectors
  --non-interactive      Select all resources without prompting
  --launch               Launch the underlying CLI after configuration
  --no-launch            Configure only
  --command <command>    Override command launched by wrapper mode
`;
}
