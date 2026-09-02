import { z } from "zod";

export const CAPABILITY_CHANGE_TOOL_NAMES = [
  "propose_self_extension",
  "propose_capability_change",
] as const;

export const CapabilityChangeApprovalSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    rationale: z.string(),
    category: z.string(),
    status: z.string().default("pending"),
    preview: z.object({
      permissions: z.array(z.unknown()).default([]),
      credentials: z.array(z.unknown()).default([]),
      cost_summary: z.string(),
      security_summary: z.string(),
      rollback_plan: z.string(),
    }),
    approval: z.object({
      approval_id: z.string().min(1),
      proposal_id: z.string().min(1),
      proposal_hash: z.string().min(1),
      proposal_generation: z.number().int(),
      status: z.string(),
      title: z.string(),
      instructions: z.string(),
    }),
    continuation: z
      .object({
        kind: z.literal("provider_setup"),
        setup_item_id: z.string().min(1),
        resource_id: z.string().min(1),
        instructions: z.string(),
      })
      .optional(),
  })
  .superRefine((proposal, context) => {
    if (proposal.approval.proposal_id !== proposal.id) {
      context.addIssue({
        code: "custom",
        message: "approval proposal binding does not match proposal id",
        path: ["approval", "proposal_id"],
      });
    }
  });

export type CapabilityChangeApproval = z.infer<typeof CapabilityChangeApprovalSchema>;

/** Read a server-authored, tokenless approval from an approved proposal tool output. */
export function capabilityChangeApprovalFromPart(part: {
  type: string;
  tool_name?: string;
  toolName?: string;
  output?: unknown;
}): CapabilityChangeApproval | undefined {
  if (!(part.type === "tool" || part.type === "dynamic-tool" || part.type.startsWith("tool-")))
    return;
  const name = part.tool_name ?? part.toolName ?? part.type.replace(/^tool-/, "");
  if (!CAPABILITY_CHANGE_TOOL_NAMES.includes(name as (typeof CAPABILITY_CHANGE_TOOL_NAMES)[number]))
    return;
  const output = unwrap(part.output);
  const nested =
    typeof output === "object" && output !== null
      ? (output as Record<string, unknown>).capability_change_approval
      : undefined;
  const parsed = CapabilityChangeApprovalSchema.safeParse(nested ?? output);
  return parsed.success ? parsed.data : undefined;
}

/** Submit a human decision bound to the exact approval, proposal hash, and generation. */
export async function decideCapabilityChange(
  controlOrigin: string,
  approval: CapabilityChangeApproval,
  decision: "approve" | "reject",
  accessToken?: string,
): Promise<CapabilityChangeApproval> {
  const response = await fetch(
    `${controlOrigin.replace(/\/$/, "")}/api/capability-approvals/${encodeURIComponent(approval.id)}/decision`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        approval_id: approval.approval.approval_id,
        proposal_hash: approval.approval.proposal_hash,
        proposal_generation: approval.approval.proposal_generation,
        decision,
      }),
    },
  );
  if (!response.ok) throw new Error(`Capability decision failed (${response.status})`);
  return CapabilityChangeApprovalSchema.parse(await response.json());
}

/** Reload a proposal's durable decision state using the verified owner boundary. */
export async function getCapabilityChange(
  controlOrigin: string,
  proposalId: string,
  accessToken?: string,
): Promise<CapabilityChangeApproval> {
  const response = await fetch(
    `${controlOrigin.replace(/\/$/, "")}/api/capability-approvals/${encodeURIComponent(proposalId)}`,
    {
      credentials: "include",
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
    },
  );
  if (!response.ok) throw new Error(`Capability lookup failed (${response.status})`);
  return CapabilityChangeApprovalSchema.parse(await response.json());
}

function unwrap(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return record.type === "json" && "value" in record ? record.value : value;
}
