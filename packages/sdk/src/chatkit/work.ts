import type { NormalizedConfig } from "../config";
import { requestJson } from "../internal/fetch-client";
import { pathWithParams, teamPath } from "../internal/paths";
import type { JsonObject } from "../tools";
import { AgentJobsClient } from "./jobs";

const GOALS_PATH = "/api/v1/team/{team_id}/chatkit/agents/{agent_id}/sessions/{session_id}/goals";
const TASKS_PATH = "/api/v1/team/{team_id}/chatkit/agents/{agent_id}/sessions/{session_id}/tasks";

export type GoalStatus = "active" | "completed" | "failed" | "canceled";
export type TaskStatus =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "rejected"
  | "auth-required"
  | "unknown";

export interface Goal {
  id: string;
  sessionId: string;
  agentId: string;
  objective: string;
  status: GoalStatus;
  progressPercent?: number;
  progressNote?: string;
  statusReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  sessionId: string;
  agentId: string;
  goalId?: string;
  dependencyTaskIds: string[];
  summary?: string;
  plan?: string;
  status: TaskStatus;
  progressPercent?: number;
  progressNote?: string;
  statusReason?: string;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

interface RawGoal {
  id: string;
  session_id: string;
  agent_id: string;
  objective: string;
  status: GoalStatus;
  progress_percent?: number;
  progress_note?: string;
  status_reason?: string;
  created_at: string;
  updated_at: string;
}

interface RawTask {
  id: string;
  session_id: string;
  agent_id: string;
  goal_id?: string;
  dependency_task_ids?: string[];
  summary?: string;
  plan?: string;
  status: TaskStatus;
  progress_percent?: number;
  progress_note?: string;
  status_reason?: string;
  metadata?: JsonObject;
  created_at: string;
  updated_at: string;
}

interface RawPage<T> {
  items: T[];
  next_page_token?: string | null;
}

export class ChatKitWorkClient {
  readonly goals: GoalClient;
  readonly tasks: TaskClient;
  readonly jobs: AgentJobsClient;

  constructor(config: NormalizedConfig, agentId: string, sessionId: string) {
    if (!agentId.trim()) throw new TypeError("agentId is required");
    if (!sessionId.trim()) throw new TypeError("sessionId is required");
    this.goals = new GoalClient(config, agentId, sessionId);
    this.tasks = new TaskClient(config, agentId, sessionId);
    this.jobs = new AgentJobsClient(config, agentId, sessionId);
  }
}

export class GoalClient {
  readonly #config: NormalizedConfig;
  readonly #root: string;

  constructor(config: NormalizedConfig, agentId: string, sessionId: string) {
    this.#config = config;
    this.#root = pathWithParams(teamPath(config, GOALS_PATH), {
      agent_id: agentId,
      session_id: sessionId,
    });
  }

  async create(input: { objective: string }): Promise<Goal> {
    return goalFromRaw(
      await requestJson<RawGoal>(this.#config, {
        method: "POST",
        path: this.#root,
        body: { objective: input.objective },
      }),
    );
  }

  async get(goalId: string): Promise<Goal> {
    return goalFromRaw(await requestJson<RawGoal>(this.#config, { path: this.#path(goalId) }));
  }

  async list(
    input: {
      status?: GoalStatus;
      pageSize?: number;
      nextPageToken?: string;
    } = {},
  ): Promise<{ items: Goal[]; nextPageToken?: string }> {
    const raw = await requestJson<RawPage<RawGoal>>(this.#config, {
      path: this.#root,
      query: {
        status: input.status,
        page_size: input.pageSize ?? 50,
        next_page_token: input.nextPageToken,
      },
    });
    return page(raw, goalFromRaw);
  }

  async update(
    goalId: string,
    input: {
      objective?: string;
      status?: GoalStatus;
      progressPercent?: number;
      progressNote?: string;
      statusReason?: string;
    },
  ): Promise<Goal> {
    return goalFromRaw(
      await requestJson<RawGoal>(this.#config, {
        method: "PATCH",
        path: this.#path(goalId),
        body: {
          objective: input.objective,
          status: input.status,
          progress_percent: input.progressPercent,
          progress_note: input.progressNote,
          status_reason: input.statusReason,
        },
      }),
    );
  }

  progress(goalId: string, progressPercent: number, progressNote?: string): Promise<Goal> {
    return this.update(goalId, { progressPercent, progressNote });
  }
  complete(goalId: string, note?: string): Promise<Goal> {
    return this.update(goalId, { status: "completed", progressPercent: 100, progressNote: note });
  }
  fail(goalId: string, reason: string): Promise<Goal> {
    return this.update(goalId, { status: "failed", statusReason: reason });
  }
  cancel(goalId: string, reason?: string): Promise<Goal> {
    return this.update(goalId, { status: "canceled", statusReason: reason });
  }

  #path(goalId: string): string {
    return `${this.#root}/${encodeURIComponent(goalId)}`;
  }
}

export class TaskClient {
  readonly #config: NormalizedConfig;
  readonly #root: string;

  constructor(config: NormalizedConfig, agentId: string, sessionId: string) {
    this.#config = config;
    this.#root = pathWithParams(teamPath(config, TASKS_PATH), {
      agent_id: agentId,
      session_id: sessionId,
    });
  }

  async create(input: {
    summary: string;
    goalId?: string;
    dependencyTaskIds?: string[];
    plan?: string;
    metadata?: JsonObject;
  }): Promise<Task> {
    return taskFromRaw(
      await requestJson<RawTask>(this.#config, {
        method: "POST",
        path: this.#root,
        body: {
          summary: input.summary,
          goal_id: input.goalId,
          dependency_task_ids: input.dependencyTaskIds ?? [],
          plan: input.plan,
          metadata: input.metadata ?? {},
        },
      }),
    );
  }

  async get(taskId: string): Promise<Task> {
    return taskFromRaw(await requestJson<RawTask>(this.#config, { path: this.#path(taskId) }));
  }

  async list(
    input: {
      goalId?: string;
      status?: TaskStatus;
      pageSize?: number;
      nextPageToken?: string;
    } = {},
  ): Promise<{ items: Task[]; nextPageToken?: string }> {
    const raw = await requestJson<RawPage<RawTask>>(this.#config, {
      path: this.#root,
      query: {
        goal_id: input.goalId,
        status: input.status,
        page_size: input.pageSize ?? 50,
        next_page_token: input.nextPageToken,
      },
    });
    return page(raw, taskFromRaw);
  }

  async update(
    taskId: string,
    input: {
      summary?: string;
      plan?: string;
      status?: TaskStatus;
      dependencyTaskIds?: string[];
      progressPercent?: number;
      progressNote?: string;
      statusReason?: string;
      metadata?: JsonObject;
    },
  ): Promise<Task> {
    return taskFromRaw(
      await requestJson<RawTask>(this.#config, {
        method: "PATCH",
        path: this.#path(taskId),
        body: {
          summary: input.summary,
          plan: input.plan,
          status: input.status,
          dependency_task_ids: input.dependencyTaskIds,
          progress_percent: input.progressPercent,
          progress_note: input.progressNote,
          status_reason: input.statusReason,
          metadata: input.metadata,
        },
      }),
    );
  }

  start(taskId: string, note?: string): Promise<Task> {
    return this.update(taskId, { status: "working", progressNote: note });
  }
  progress(taskId: string, progressPercent: number, progressNote?: string): Promise<Task> {
    return this.update(taskId, { status: "working", progressPercent, progressNote });
  }
  complete(taskId: string, note?: string): Promise<Task> {
    return this.update(taskId, { status: "completed", progressPercent: 100, progressNote: note });
  }
  fail(taskId: string, reason: string): Promise<Task> {
    return this.update(taskId, { status: "failed", statusReason: reason });
  }
  cancel(taskId: string, reason?: string): Promise<Task> {
    return this.update(taskId, { status: "canceled", statusReason: reason });
  }

  #path(taskId: string): string {
    return `${this.#root}/${encodeURIComponent(taskId)}`;
  }
}

function goalFromRaw(raw: RawGoal): Goal {
  return compact({
    id: raw.id,
    sessionId: raw.session_id,
    agentId: raw.agent_id,
    objective: raw.objective,
    status: raw.status,
    progressPercent: raw.progress_percent,
    progressNote: raw.progress_note,
    statusReason: raw.status_reason,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  });
}

function taskFromRaw(raw: RawTask): Task {
  return compact({
    id: raw.id,
    sessionId: raw.session_id,
    agentId: raw.agent_id,
    goalId: raw.goal_id,
    dependencyTaskIds: raw.dependency_task_ids ?? [],
    summary: raw.summary,
    plan: raw.plan,
    status: raw.status,
    progressPercent: raw.progress_percent,
    progressNote: raw.progress_note,
    statusReason: raw.status_reason,
    metadata: raw.metadata ?? {},
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  });
}

function page<TRaw, TResult>(
  raw: RawPage<TRaw>,
  convert: (value: TRaw) => TResult,
): { items: TResult[]; nextPageToken?: string } {
  return compact({
    items: raw.items.map(convert),
    nextPageToken: raw.next_page_token ?? undefined,
  });
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
