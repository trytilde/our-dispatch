import type { NormalizedConfig } from "../config";
import { requestJson } from "../internal/fetch-client";
import { pathWithParams, teamPath } from "../internal/paths";
import type { JsonObject, JsonValue } from "../tools";

const JOBS_PATH = "/api/v1/team/{team_id}/chatkit/agents/{agent_id}/sessions/{session_id}/jobs";
const ATTACHMENT_URL_PATH =
  "/api/v1/team/{team_id}/chatkit/session/{session_id}/attachment/{attachment_id}/download-url";

export type AgentJobStatus =
  | "queued"
  | "running"
  | "input-required"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export interface AgentJobBudget {
  maxDurationSeconds?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCostMicrousd?: number;
}

export interface AgentJobArtifact {
  id: string;
  name?: string;
  mediaType?: string;
  uri?: string;
  metadata?: JsonObject;
}

export interface AgentJob {
  id: string;
  parentSessionId: string;
  parentAgentId: string;
  childSessionId?: string;
  childAgentId: string;
  objective: string;
  status: AgentJobStatus;
  modelId?: string;
  budget?: AgentJobBudget;
  result?: JsonValue;
  error?: string;
  transcriptMessageIds: string[];
  artifacts: AgentJobArtifact[];
  createdAt: string;
  updatedAt: string;
}

interface RawAgentJob {
  id: string;
  parent_session_id: string;
  parent_agent_id: string;
  child_session_id?: string;
  child_agent_id: string;
  objective: string;
  status: AgentJobStatus;
  model_id?: string;
  budget?: {
    max_duration_seconds?: number;
    max_input_tokens?: number;
    max_output_tokens?: number;
    max_cost_microusd?: number;
  };
  result?: JsonValue;
  error?: string;
  transcript_message_ids?: string[];
  artifacts?: Array<{
    id: string;
    name?: string;
    media_type?: string;
    uri?: string;
    metadata?: JsonObject;
  }>;
  created_at: string;
  updated_at: string;
}

interface RawPage<T> {
  items: T[];
  next_page_token?: string | null;
}

/** Durable background-agent jobs bound to one parent agent and conversation. */
export class AgentJobsClient {
  readonly #config: NormalizedConfig;
  readonly #root: string;

  constructor(config: NormalizedConfig, agentId: string, sessionId: string) {
    this.#config = config;
    this.#root = pathWithParams(teamPath(config, JOBS_PATH), {
      agent_id: agentId,
      session_id: sessionId,
    });
  }

  /** Delegate one child objective. `modelId` is omitted unless the caller explicitly selects it. */
  async delegate(input: {
    childAgentId: string;
    objective: string;
    idempotencyKey: string;
    modelId?: string;
    budget?: AgentJobBudget;
    metadata?: JsonObject;
  }): Promise<AgentJob> {
    return fromRaw(
      await requestJson<RawAgentJob>(this.#config, {
        method: "POST",
        path: this.#root,
        body: {
          child_agent_id: input.childAgentId,
          objective: input.objective,
          idempotency_key: input.idempotencyKey,
          ...(input.modelId === undefined ? {} : { model_id: input.modelId }),
          budget: input.budget ? budgetToRaw(input.budget) : undefined,
          metadata: input.metadata,
        },
      }),
    );
  }

  async get(jobId: string): Promise<AgentJob> {
    return fromRaw(await requestJson<RawAgentJob>(this.#config, { path: this.#path(jobId) }));
  }

  async list(
    input: { status?: AgentJobStatus; pageSize?: number; nextPageToken?: string } = {},
  ): Promise<{ items: AgentJob[]; nextPageToken?: string }> {
    const raw = await requestJson<RawPage<RawAgentJob>>(this.#config, {
      path: this.#root,
      query: {
        status: input.status,
        page_size: input.pageSize ?? 50,
        next_page_token: input.nextPageToken,
      },
    });
    return compact({
      items: raw.items.map(fromRaw),
      nextPageToken: raw.next_page_token ?? undefined,
    });
  }

  async steer(jobId: string, instruction: string, idempotencyKey: string): Promise<AgentJob> {
    return this.#action(jobId, "steer", { instruction, idempotency_key: idempotencyKey });
  }

  async stop(jobId: string, reason?: string): Promise<AgentJob> {
    return this.#action(jobId, "stop", { reason });
  }

  async resume(jobId: string, instruction?: string): Promise<AgentJob> {
    return this.#action(jobId, "resume", { instruction });
  }

  /** Return the durable terminal result, transcript references, and artifacts. */
  async collectResult(jobId: string): Promise<AgentJob> {
    const job = fromRaw(
      await requestJson<RawAgentJob>(this.#config, {
        method: "POST",
        path: `${this.#path(jobId)}/collect-result`,
      }),
    );
    if (!job.childSessionId) return job;
    job.artifacts = await Promise.all(
      job.artifacts.map(async (artifact) => {
        const raw = await requestJson<{ download_url: string }>(this.#config, {
          path: pathWithParams(teamPath(this.#config, ATTACHMENT_URL_PATH), {
            session_id: job.childSessionId!,
            attachment_id: artifact.id,
          }),
        });
        return { ...artifact, uri: raw.download_url };
      }),
    );
    return job;
  }

  async #action(jobId: string, action: string, body: JsonObject): Promise<AgentJob> {
    return fromRaw(
      await requestJson<RawAgentJob>(this.#config, {
        method: "POST",
        path: `${this.#path(jobId)}/${action}`,
        body,
      }),
    );
  }

  #path(jobId: string): string {
    return `${this.#root}/${encodeURIComponent(jobId)}`;
  }
}

function budgetToRaw(budget: AgentJobBudget): JsonObject {
  return compact({
    max_duration_seconds: budget.maxDurationSeconds,
    max_input_tokens: budget.maxInputTokens,
    max_output_tokens: budget.maxOutputTokens,
    max_cost_microusd: budget.maxCostMicrousd,
  });
}

function fromRaw(raw: RawAgentJob): AgentJob {
  return compact({
    id: raw.id,
    parentSessionId: raw.parent_session_id,
    parentAgentId: raw.parent_agent_id,
    childSessionId: raw.child_session_id,
    childAgentId: raw.child_agent_id,
    objective: raw.objective,
    status: raw.status,
    modelId: raw.model_id,
    budget: raw.budget
      ? compact({
          maxDurationSeconds: raw.budget.max_duration_seconds,
          maxInputTokens: raw.budget.max_input_tokens,
          maxOutputTokens: raw.budget.max_output_tokens,
          maxCostMicrousd: raw.budget.max_cost_microusd,
        })
      : undefined,
    result: raw.result,
    error: raw.error,
    transcriptMessageIds: raw.transcript_message_ids ?? [],
    artifacts:
      raw.artifacts?.map((artifact) =>
        compact({
          id: artifact.id,
          name: artifact.name,
          mediaType: artifact.media_type,
          uri: artifact.uri,
          metadata: artifact.metadata,
        }),
      ) ?? [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  });
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
