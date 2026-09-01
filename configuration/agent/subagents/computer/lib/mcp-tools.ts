import type { ToolSet } from "@ai-sdk/provider-utils";

/** Expose exactly the authored CUA tools, even if the MCP server later gains remote tools. */
export function selectComputerMcpTools(
  cuaTools: ToolSet,
  availableTools: Record<string, unknown>,
): ToolSet {
  return Object.fromEntries(
    Object.keys(cuaTools).map((name) => {
      const tool = availableTools[name];
      if (tool === undefined) throw new TypeError(`Computer MCP tool is unavailable: ${name}`);
      return [name, tool];
    }),
  ) as ToolSet;
}
