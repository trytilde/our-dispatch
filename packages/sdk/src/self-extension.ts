import type { NormalizedConfig } from "./config";
import { requestJson } from "./internal/fetch-client";
import { teamPath } from "./internal/paths";
import type { JsonObject, JsonValue } from "./tools";

const PROPOSALS_PATH = "/api/v1/team/{team_id}/chatkit/self-extension-proposals";

export type SelfExtensionCategory =
  | "connector"
  | "mcp_server"
  | "skill_registry"
  | "custom_tool"
  | "agent"
  | "memory_bank"
  | "wiki";

export type SelfExtensionStatus =
  | "pending"
  | "approved"
  | "executing"
  | "executed"
  | "rejected"
  | "cancelled"
  | "expired"
  | "rollback_queued"
  | "rolling_back"
  | "rolled_back"
  | "error";

export interface SelfExtensionPermissionChange {
  permission: string;
  plane: string;
  principals: string[];
  reason: string;
}

export interface SelfExtensionCredentialRequirement {
  credentialType: string;
  purpose: string;
  brokeredBy: string;
  requiredFields: string[];
}

export interface SelfExtensionPreview {
  resourceDiff: JsonValue;
  permissions: SelfExtensionPermissionChange[];
  credentials: SelfExtensionCredentialRequirement[];
  costSummary: string;
  affectedAgents: string[];
  affectedUsers: string[];
  egressDestinations: string[];
  securitySummary: string;
  rollbackPlan: string;
}

export interface SelfExtensionResource {
  kind: string;
  key: string;
  id: string;
  createdByProposal: boolean;
}

export interface CapabilityChangeApproval {
  approvalId: string;
  proposalId: string;
  proposalHash: string;
  proposalGeneration: number;
  status: string;
  title: string;
  instructions: string;
}

export interface ProviderSetupContinuation {
  kind: "provider_setup";
  setupItemId: string;
  resourceId: string;
  nextAction?: JsonValue;
  instructions: string;
}

export interface SelfExtensionProposal {
  id: string;
  orgId: string;
  teamId: string;
  requestingAgentId: string;
  callingSubjectId: string;
  requestingUserId?: string;
  sessionId?: string;
  runId?: string;
  category: SelfExtensionCategory;
  status: SelfExtensionStatus;
  title: string;
  rationale: string;
  desiredState: JsonValue;
  preview: SelfExtensionPreview;
  approval: CapabilityChangeApproval;
  generation: number;
  approvedByUserId?: string;
  errorMessage?: string;
  outputsAvailable: boolean;
  continuation?: ProviderSetupContinuation;
  resources: SelfExtensionResource[];
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProposeSelfExtensionInput {
  requestingAgentId: string;
  sessionId?: string;
  runId?: string;
  idempotencyKey: string;
  category: SelfExtensionCategory;
  title: string;
  rationale: string;
  desiredState: JsonObject;
  expiresInSeconds?: number;
}

interface RawProposal {
  id: string;
  org_id: string;
  team_id: string;
  requesting_agent_id: string;
  calling_subject_id: string;
  requesting_user_id?: string | null;
  session_id?: string | null;
  run_id?: string | null;
  category: SelfExtensionCategory;
  status: SelfExtensionStatus;
  title: string;
  rationale: string;
  desired_state: JsonValue;
  preview: {
    resource_diff: JsonValue;
    permissions?: Array<{
      permission: string;
      plane: string;
      principals?: string[];
      reason: string;
    }>;
    credentials?: Array<{
      credential_type: string;
      purpose: string;
      brokered_by: string;
      required_fields?: string[];
    }>;
    cost_summary: string;
    affected_agents?: string[];
    affected_users?: string[];
    egress_destinations?: string[];
    security_summary: string;
    rollback_plan: string;
  };
  approval: {
    approval_id: string;
    proposal_id: string;
    proposal_hash: string;
    proposal_generation: number;
    status: string;
    title: string;
    instructions: string;
  };
  generation: number;
  approved_by_user_id?: string | null;
  error_message?: string | null;
  outputs_available: boolean;
  continuation?: {
    kind: "provider_setup";
    setup_item_id: string;
    resource_id: string;
    next_action?: JsonValue | null;
    instructions: string;
  } | null;
  resources?: Array<{ kind: string; key: string; id: string; created_by_proposal: boolean }>;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

/** Durable human-reviewed capability proposals. This client never accepts credential values. */
export class SelfExtensionClient {
  readonly #config: NormalizedConfig;
  readonly #root: string;

  constructor(config: NormalizedConfig) {
    this.#config = config;
    this.#root = teamPath(config, PROPOSALS_PATH);
  }

  /** Propose a capability. The server authors the security, cost, and rollback preview. */
  async propose(input: ProposeSelfExtensionInput): Promise<SelfExtensionProposal> {
    return fromRaw(
      await requestJson<RawProposal>(this.#config, {
        method: "POST",
        path: this.#root,
        body: compact({
          requesting_agent_id: input.requestingAgentId,
          session_id: input.sessionId,
          run_id: input.runId,
          idempotency_key: input.idempotencyKey,
          category: input.category,
          title: input.title,
          rationale: input.rationale,
          desired_state: input.desiredState,
          expires_in_seconds: input.expiresInSeconds,
        }),
      }),
    );
  }

  async list(
    input: { status?: SelfExtensionStatus; requestingAgentId?: string; pageSize?: number } = {},
  ): Promise<SelfExtensionProposal[]> {
    return (
      await requestJson<RawProposal[]>(this.#config, {
        path: this.#root,
        query: {
          status: input.status,
          requesting_agent_id: input.requestingAgentId,
          page_size: input.pageSize ?? 50,
        },
      })
    ).map(fromRaw);
  }

  async inspect(proposalId: string): Promise<SelfExtensionProposal> {
    return fromRaw(await requestJson<RawProposal>(this.#config, { path: this.#path(proposalId) }));
  }

  async approve(proposalId: string): Promise<SelfExtensionProposal> {
    return this.#action(proposalId, "approve");
  }

  async reject(proposalId: string): Promise<SelfExtensionProposal> {
    return this.#action(proposalId, "reject");
  }

  async cancel(proposalId: string): Promise<SelfExtensionProposal> {
    return this.#action(proposalId, "cancel");
  }

  async rollback(proposalId: string): Promise<SelfExtensionProposal> {
    return this.#action(proposalId, "rollback");
  }

  /** Consume one-time execution values using human credentials; agent keys are rejected upstream. */
  async claimOutputs(proposalId: string): Promise<Record<string, string>> {
    const result = await requestJson<{ values: Record<string, string> }>(this.#config, {
      method: "POST",
      path: `${this.#path(proposalId)}/outputs/claim`,
    });
    return result.values;
  }

  /** Continue the proposal's existing Managed Credential setup item as its human reviewer. */
  async continueProviderSetup(proposalId: string, body: JsonObject = {}): Promise<JsonValue> {
    const proposal = await this.inspect(proposalId);
    const continuation = proposal.continuation;
    if (!continuation || continuation.kind !== "provider_setup")
      throw new Error(`proposal ${proposalId} has no provider setup continuation`);
    return requestJson<JsonValue>(this.#config, {
      method: "POST",
      path: `${teamPath(this.#config, "/api/v1/team/{team_id}/credential/setup-items")}/${encodeURIComponent(continuation.setupItemId)}/resume`,
      body,
    });
  }

  /** Wait for already-approved durable execution; approval is the only action that queues it. */
  async execute(
    proposalId: string,
    options: { pollIntervalMs?: number; timeoutMs?: number } = {},
  ): Promise<SelfExtensionProposal> {
    const pollIntervalMs = options.pollIntervalMs ?? 1_000;
    const timeoutMs = options.timeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;
    let proposal = await this.inspect(proposalId);
    if (!["approved", "executing", "executed"].includes(proposal.status))
      throw new Error(`proposal ${proposalId} must be approved before execution`);
    while (!isTerminal(proposal.status)) {
      if (Date.now() >= deadline)
        throw new Error(`proposal ${proposalId} did not finish within ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      proposal = await this.inspect(proposalId);
    }
    return proposal;
  }

  async #action(proposalId: string, action: string): Promise<SelfExtensionProposal> {
    return fromRaw(
      await requestJson<RawProposal>(this.#config, {
        method: "POST",
        path: `${this.#path(proposalId)}/${action}`,
      }),
    );
  }

  #path(proposalId: string): string {
    return `${this.#root}/${encodeURIComponent(proposalId)}`;
  }
}

function isTerminal(status: SelfExtensionStatus): boolean {
  return ["executed", "rejected", "cancelled", "expired", "rolled_back", "error"].includes(status);
}

function fromRaw(raw: RawProposal): SelfExtensionProposal {
  return compact({
    id: raw.id,
    orgId: raw.org_id,
    teamId: raw.team_id,
    requestingAgentId: raw.requesting_agent_id,
    callingSubjectId: raw.calling_subject_id,
    requestingUserId: raw.requesting_user_id ?? undefined,
    sessionId: raw.session_id ?? undefined,
    runId: raw.run_id ?? undefined,
    category: raw.category,
    status: raw.status,
    title: raw.title,
    rationale: raw.rationale,
    desiredState: raw.desired_state,
    preview: {
      resourceDiff: raw.preview.resource_diff,
      permissions: (raw.preview.permissions ?? []).map((item) => ({
        permission: item.permission,
        plane: item.plane,
        principals: item.principals ?? [],
        reason: item.reason,
      })),
      credentials: (raw.preview.credentials ?? []).map((item) => ({
        credentialType: item.credential_type,
        purpose: item.purpose,
        brokeredBy: item.brokered_by,
        requiredFields: item.required_fields ?? [],
      })),
      costSummary: raw.preview.cost_summary,
      affectedAgents: raw.preview.affected_agents ?? [],
      affectedUsers: raw.preview.affected_users ?? [],
      egressDestinations: raw.preview.egress_destinations ?? [],
      securitySummary: raw.preview.security_summary,
      rollbackPlan: raw.preview.rollback_plan,
    },
    approval: {
      approvalId: raw.approval.approval_id,
      proposalId: raw.approval.proposal_id,
      proposalHash: raw.approval.proposal_hash,
      proposalGeneration: raw.approval.proposal_generation,
      status: raw.approval.status,
      title: raw.approval.title,
      instructions: raw.approval.instructions,
    },
    generation: raw.generation,
    approvedByUserId: raw.approved_by_user_id ?? undefined,
    errorMessage: raw.error_message ?? undefined,
    outputsAvailable: raw.outputs_available,
    continuation: raw.continuation
      ? {
          kind: raw.continuation.kind,
          setupItemId: raw.continuation.setup_item_id,
          resourceId: raw.continuation.resource_id,
          nextAction: raw.continuation.next_action ?? undefined,
          instructions: raw.continuation.instructions,
        }
      : undefined,
    resources: (raw.resources ?? []).map((item) => ({
      kind: item.kind,
      key: item.key,
      id: item.id,
      createdByProposal: item.created_by_proposal,
    })),
    expiresAt: raw.expires_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  });
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
