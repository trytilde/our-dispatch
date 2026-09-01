import { describe, expect, it } from "vite-plus/test";
import { tool } from "ai";
import { z } from "zod";
import { selectComputerMcpTools } from "./mcp-tools.js";

describe("Computer MCP tool boundary", () => {
  it("exposes only the local CUA tool names", () => {
    const screenshot = tool({
      description: "Screenshot",
      inputSchema: z.object({}),
      execute: async () => ({}),
    });
    const click = tool({
      description: "Click",
      inputSchema: z.object({}),
      execute: async () => ({}),
    });
    const selected = selectComputerMcpTools(
      { screenshot, click },
      {
        screenshot,
        click,
        SEARCH_TOOLS: { description: "Remote search" },
        chatkit_delegate: { description: "Delegation" },
      },
    );

    expect(Object.keys(selected)).toEqual(["screenshot", "click"]);
    expect(selected).toEqual({ screenshot, click });
  });

  it("fails closed when a local CUA tool was not added to MCP", () => {
    const screenshot = tool({
      description: "Screenshot",
      inputSchema: z.object({}),
      execute: async () => ({}),
    });
    expect(() => selectComputerMcpTools({ screenshot }, {})).toThrow(
      "Computer MCP tool is unavailable: screenshot",
    );
  });
});
