import { describe, expect, it } from "vite-plus/test";
import { projectActivityParts } from "./part-projection";

describe("mobile message part projection", () => {
  it("projects pre-tool narration as reasoning and preserves the terminal answer", () => {
    expect(
      projectActivityParts([
        { type: "text", text: "I’ll inspect the registry." },
        { type: "tool", tool_name: "SEARCH_TOOLS", state: "output-available" },
        { type: "text", text: "The connector is available." },
      ]),
    ).toEqual([
      { type: "reasoning", text: "I’ll inspect the registry." },
      { type: "tool", tool_name: "SEARCH_TOOLS", state: "output-available" },
      { type: "text", text: "The connector is available." },
    ]);
  });
});
