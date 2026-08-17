import { posix } from "node:path";
import { Code, ConnectError } from "@connectrpc/connect";

export interface AgentCommand {
  command: string;
  arguments: string[];
  cwd: string;
  environment: Record<string, string>;
}

export function agentWorkspaceRoot(agentId: string): string {
  validateAgentId(agentId);
  return `/workspace/${agentId}`;
}

export function agentVisiblePath(agentId: string, path: string): string {
  if (!path || path.includes("\0"))
    throw new ConnectError("A valid computer path is required", Code.InvalidArgument);
  return path.startsWith("/")
    ? posix.normalize(path)
    : posix.resolve(agentWorkspaceRoot(agentId), path);
}

export function agentCommand(
  agentId: string,
  command: string,
  args: readonly string[] = [],
  options: { cwd?: string; environment?: Readonly<Record<string, string>> } = {},
): AgentCommand {
  if (!command) throw new ConnectError("Command is required", Code.InvalidArgument);
  const root = agentWorkspaceRoot(agentId);
  return {
    command,
    arguments: [...args],
    cwd: options.cwd ? agentVisiblePath(agentId, options.cwd) : root,
    environment: {
      HOME: root,
      LANG: process.env.LANG ?? "C.UTF-8",
      LOGNAME: process.env.LOGNAME ?? "root",
      AGENT_ID: agentId,
      COMPUTER_WORKSPACE: root,
      PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      USER: process.env.USER ?? "root",
      ...options.environment,
    },
  };
}

function validateAgentId(agentId: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(agentId))
    throw new ConnectError("A valid agent_id is required", Code.InvalidArgument);
}
