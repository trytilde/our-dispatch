import { describe, expect, it } from "vite-plus/test";
import { capabilityChangeApprovalFromPart, getCapabilityChange } from "./capability-approvals.js";

const proposal = {
  id: "proposal-1",
  title: "Add Stripe",
  rationale: "Read revenue",
  category: "connector",
  preview: {
    permissions: [],
    credentials: [],
    cost_summary: "$0",
    security_summary: "Read-only",
    rollback_plan: "Remove",
  },
  approval: {
    approval_id: "approval-1",
    proposal_id: "proposal-1",
    proposal_hash: "hash-1",
    proposal_generation: 1,
    status: "pending",
    title: "Add Stripe",
    instructions: "Read revenue",
  },
};

describe("capabilityChangeApprovalFromPart", () => {
  it("accepts the SDK proposal tool's direct tokenless output", () => {
    const approval = capabilityChangeApprovalFromPart({
      type: "tool",
      tool_name: "propose_self_extension",
      output: proposal,
    });
    expect(approval?.approval).toMatchObject({
      approval_id: "approval-1",
      proposal_hash: "hash-1",
    });
    expect(JSON.stringify(approval)).not.toContain("token");
  });

  it("accepts wrapped output and rejects unrelated tools", () => {
    expect(
      capabilityChangeApprovalFromPart({
        type: "tool-propose_capability_change",
        output: { capability_change_approval: proposal },
      })?.id,
    ).toBe("proposal-1");
    expect(
      capabilityChangeApprovalFromPart({ type: "tool", tool_name: "bash", output: proposal }),
    ).toBeUndefined();
  });

  it("strips unknown proposal data and rejects a mismatched approval binding", () => {
    const approval = capabilityChangeApprovalFromPart({
      type: "tool",
      tool_name: "propose_self_extension",
      output: {
        ...proposal,
        desired_state: { client_secret: "must-not-reach-client" },
        error_message: "secret-shaped diagnostic",
        preview: {
          ...proposal.preview,
          resource_diff: { token: "must-not-reach-client" },
        },
      },
    });
    expect(approval).toBeDefined();
    expect(JSON.stringify(approval)).not.toContain("must-not-reach-client");
    expect(JSON.stringify(approval)).not.toContain("secret-shaped diagnostic");
    expect(
      capabilityChangeApprovalFromPart({
        type: "tool",
        tool_name: "propose_self_extension",
        output: {
          ...proposal,
          approval: { ...proposal.approval, proposal_id: "proposal-other" },
        },
      }),
    ).toBeUndefined();
  });

  it("reloads durable status without accepting a decision in free text", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ ...proposal, status: "executed" });
    try {
      const current = await getCapabilityChange("https://openbot.test", proposal.id);
      expect(current.status).toBe("executed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
