import type { NormalizedConfig } from "../config";
import { requestJson } from "../internal/fetch-client";
import { teamPath } from "../internal/paths";
import type { JsonObject } from "../tools";

const ROUTINES_PATH = "/api/v1/team/{team_id}/chatkit/routines";

export interface Routine {
  id: string;
  agentId: string;
  title: string;
  prompt: string;
  schedule: string;
  scheduleDescription: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  lastSessionId?: string;
  lastError?: string;
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
}

interface RawRoutine {
  id: string;
  agent_inbox_id: string;
  title: string;
  prompt: string;
  schedule: string;
  schedule_description: string;
  enabled: boolean;
  next_run_at: string;
  last_run_at?: string | null;
  last_session_id?: string | null;
  last_error?: string | null;
  metadata?: JsonObject | null;
  created_at: string;
  updated_at: string;
}

interface RawPage {
  items: RawRoutine[];
  next_page_token?: string | null;
}

/** Agent-scoped recurring work backed by durable ChatKit routines. */
export class ChatKitRoutinesClient {
  readonly #config: NormalizedConfig;
  readonly #agentId: string;
  readonly #root: string;

  constructor(config: NormalizedConfig, agentId: string) {
    if (!agentId.trim()) throw new TypeError("agentId is required");
    this.#config = config;
    this.#agentId = agentId;
    this.#root = teamPath(config, ROUTINES_PATH);
  }

  async create(input: {
    title: string;
    prompt: string;
    schedule: string;
    enabled?: boolean;
    metadata?: JsonObject;
  }): Promise<Routine> {
    return fromRaw(
      await requestJson<RawRoutine>(this.#config, {
        method: "POST",
        path: this.#root,
        body: {
          agent_inbox_id: this.#agentId,
          title: input.title,
          prompt: input.prompt,
          schedule: input.schedule,
          enabled: input.enabled ?? true,
          metadata: input.metadata,
        },
      }),
    );
  }

  async get(routineId: string): Promise<Routine> {
    return fromRaw(await requestJson<RawRoutine>(this.#config, { path: this.#path(routineId) }));
  }

  async list(input: { pageSize?: number; nextPageToken?: string } = {}): Promise<{
    items: Routine[];
    nextPageToken?: string;
  }> {
    const raw = await requestJson<RawPage>(this.#config, {
      path: this.#root,
      query: { page_size: input.pageSize ?? 100, next_page_token: input.nextPageToken },
    });
    return {
      items: raw.items.map(fromRaw).filter((routine) => routine.agentId === this.#agentId),
      ...(raw.next_page_token ? { nextPageToken: raw.next_page_token } : {}),
    };
  }

  async update(
    routineId: string,
    input: {
      title?: string;
      prompt?: string;
      schedule?: string;
      enabled?: boolean;
      metadata?: JsonObject;
    },
  ): Promise<Routine> {
    return fromRaw(
      await requestJson<RawRoutine>(this.#config, {
        method: "PATCH",
        path: this.#path(routineId),
        body: {
          title: input.title,
          prompt: input.prompt,
          schedule: input.schedule,
          enabled: input.enabled,
          metadata: input.metadata,
        },
      }),
    );
  }

  pause(routineId: string): Promise<Routine> {
    return this.update(routineId, { enabled: false });
  }

  resume(routineId: string): Promise<Routine> {
    return this.update(routineId, { enabled: true });
  }

  async delete(routineId: string): Promise<void> {
    await requestJson<unknown>(this.#config, { method: "DELETE", path: this.#path(routineId) });
  }

  #path(routineId: string): string {
    return `${this.#root}/${encodeURIComponent(routineId)}`;
  }
}

function fromRaw(raw: RawRoutine): Routine {
  return {
    id: raw.id,
    agentId: raw.agent_inbox_id,
    title: raw.title,
    prompt: raw.prompt,
    schedule: raw.schedule,
    scheduleDescription: raw.schedule_description,
    enabled: raw.enabled,
    nextRunAt: raw.next_run_at,
    ...(raw.last_run_at ? { lastRunAt: raw.last_run_at } : {}),
    ...(raw.last_session_id ? { lastSessionId: raw.last_session_id } : {}),
    ...(raw.last_error ? { lastError: raw.last_error } : {}),
    ...(raw.metadata ? { metadata: raw.metadata } : {}),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}
