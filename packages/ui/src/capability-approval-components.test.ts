import { describe, expect, it } from "vite-plus/test";
import { splitMessageSegments } from "./message-blocks.js";

describe("capability approval transcript routing", () => {
  it("keeps approval out of collapsed tool chips", () => {
    const proposal = {
      id: "proposal-a",
      title: "Add",
      rationale: "Need",
      category: "connector",
      preview: {
        permissions: [],
        credentials: [],
        cost_summary: "$0",
        security_summary: "Scoped",
        rollback_plan: "Remove",
      },
      approval: {
        approval_id: "approval-a",
        proposal_id: "proposal-a",
        proposal_hash: "hash-a",
        proposal_generation: 1,
        status: "pending",
        title: "Add",
        instructions: "Need",
      },
    };
    expect(
      splitMessageSegments([
        { type: "tool", tool_name: "bash", output: "ok" },
        { type: "tool", tool_name: "propose_self_extension", output: proposal },
      ]).map((segment) => segment.kind),
    ).toEqual(["run", "other"]);
  });
});
