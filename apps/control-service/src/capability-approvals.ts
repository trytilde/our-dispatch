import type { Hono } from "hono";
import type { TildeProxyOptions } from "./tilde-proxy.js";

/** Register the owner-only proxy for exact capability-change decisions. */
export function registerCapabilityApprovalRoutes(app: Hono, configured?: TildeProxyOptions): void {
  app.get("/api/capability-approvals/:proposalId", async (context) => {
    const options = configured ?? optionsFromEnvironment();
    if (!options)
      return context.json({ error: "Tilde capability approvals are not configured" }, 503);
    const { ownerAccessToken: accessToken } = context.var as { ownerAccessToken?: string };
    if (!accessToken) return context.json({ error: "Authentication required" }, 401);
    const response = await requestProposal(
      options,
      accessToken,
      context.req.param("proposalId"),
      context.req.raw.signal,
    );
    if (!response.ok)
      return context.json({ error: "Capability lookup failed" }, response.status as 400);
    const proposal = await safeProposal(response, context.req.param("proposalId"));
    if (!proposal) return context.json({ error: "Invalid capability response" }, 502);
    context.header("cache-control", "no-store");
    return context.json(proposal);
  });

  app.post("/api/capability-approvals/:proposalId/decision", async (context) => {
    const options = configured ?? optionsFromEnvironment();
    if (!options)
      return context.json({ error: "Tilde capability approvals are not configured" }, 503);
    const { ownerAccessToken: accessToken } = context.var as { ownerAccessToken?: string };
    if (!accessToken) return context.json({ error: "Authentication required" }, 401);
    const body = await context.req.json().catch(() => undefined);
    if (!validBody(body)) return context.json({ error: "Invalid capability decision" }, 400);
    const url = new URL(
      `/api/v1/team/${encodeURIComponent(options.teamId)}/chatkit/self-extension-proposals/${encodeURIComponent(context.req.param("proposalId"))}/decision`,
      options.baseUrl ?? "https://api.trytilde.ai",
    );
    const response = await (options.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        "x-tilde-org-id": options.orgId,
        "x-tilde-team-id": options.teamId,
      },
      body: JSON.stringify(body),
      signal: context.req.raw.signal,
    });
    if (!response.ok) {
      return context.json({ error: "Capability decision failed" }, response.status as 400);
    }
    const proposal = await safeProposal(response, context.req.param("proposalId"));
    if (!proposal) return context.json({ error: "Invalid capability response" }, 502);
    context.header("cache-control", "no-store");
    return context.json(proposal);
  });
}

function requestProposal(
  options: TildeProxyOptions,
  accessToken: string,
  proposalId: string,
  signal: AbortSignal,
): Promise<Response> {
  const url = new URL(
    `/api/v1/team/${encodeURIComponent(options.teamId)}/chatkit/self-extension-proposals/${encodeURIComponent(proposalId)}`,
    options.baseUrl ?? "https://api.trytilde.ai",
  );
  return (options.fetch ?? fetch)(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "x-tilde-org-id": options.orgId,
      "x-tilde-team-id": options.teamId,
    },
    signal,
  });
}

async function safeProposal(
  response: Response,
  expectedProposalId: string,
): Promise<Record<string, unknown> | undefined> {
  const raw = record(await response.json().catch(() => undefined));
  const preview = record(raw?.preview);
  const approval = record(raw?.approval);
  const id = text(raw?.id);
  const title = text(raw?.title);
  const rationale = text(raw?.rationale);
  const category = text(raw?.category);
  const status = text(raw?.status);
  const approvalId = text(approval?.approval_id);
  const proposalId = text(approval?.proposal_id);
  const proposalHash = text(approval?.proposal_hash);
  const proposalGeneration = approval?.proposal_generation;
  if (
    !id ||
    id !== expectedProposalId ||
    !title ||
    !rationale ||
    !category ||
    !status ||
    !approvalId ||
    !proposalId ||
    !proposalHash ||
    proposalId !== id ||
    !Number.isSafeInteger(proposalGeneration)
  )
    return;
  const continuation = safeContinuation(raw?.continuation);
  return {
    id,
    title,
    rationale,
    category,
    status,
    preview: {
      permissions: safePermissions(preview?.permissions),
      credentials: safeCredentialRequirements(preview?.credentials),
      cost_summary: text(preview?.cost_summary),
      security_summary: text(preview?.security_summary),
      rollback_plan: text(preview?.rollback_plan),
    },
    approval: {
      approval_id: approvalId,
      proposal_id: proposalId,
      proposal_hash: proposalHash,
      proposal_generation: proposalGeneration,
      status: text(approval?.status),
      title: text(approval?.title),
      instructions: text(approval?.instructions),
    },
    ...(continuation ? { continuation } : {}),
  };
}

function safeContinuation(value: unknown): Record<string, unknown> | undefined {
  const continuation = record(value);
  if (text(continuation?.kind) !== "provider_setup") return;
  const setupItemId = text(continuation?.setup_item_id);
  const resourceId = text(continuation?.resource_id);
  if (!setupItemId || !resourceId) return;
  return {
    kind: "provider_setup",
    setup_item_id: setupItemId,
    resource_id: resourceId,
    instructions: text(continuation?.instructions),
  };
}

function safePermissions(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const permission = record(item);
        return permission
          ? [
              {
                permission: text(permission.permission),
                plane: text(permission.plane),
                principals: strings(permission.principals),
                reason: text(permission.reason),
              },
            ]
          : [];
      })
    : [];
}

function safeCredentialRequirements(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const requirement = record(item);
        return requirement
          ? [
              {
                credential_type: text(requirement.credential_type),
                purpose: text(requirement.purpose),
                brokered_by: text(requirement.brokered_by),
                required_fields: strings(requirement.required_fields),
              },
            ]
          : [];
      })
    : [];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function validBody(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.approval_id === "string" &&
    body.approval_id.length > 0 &&
    typeof body.proposal_hash === "string" &&
    body.proposal_hash.length > 0 &&
    Number.isSafeInteger(body.proposal_generation) &&
    (body.decision === "approve" || body.decision === "reject")
  );
}

function optionsFromEnvironment(): TildeProxyOptions | undefined {
  const apiKey = process.env.TILDE_API_KEY?.trim();
  const orgId = process.env.TILDE_ORG_ID?.trim();
  const teamId = process.env.TILDE_TEAM_ID?.trim();
  if (!apiKey || !orgId || !teamId) return;
  return { apiKey, orgId, teamId, baseUrl: process.env.TILDE_BASE_URL };
}
