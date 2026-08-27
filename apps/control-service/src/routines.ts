import type { Hono } from "hono";
import {
  pageItems,
  text,
  tildeJson,
  tildeOptionsFromEnvironment,
  tildeUnavailable,
  tildeUpstreamFailure,
  valueRecord,
  type TildeRouteOptions,
} from "./tilde-upstream.js";

export type RoutineRouteOptions = TildeRouteOptions;

interface JsonEqualsPredicate {
  path: string;
  value: unknown;
}

type TriggerSpec =
  | { kind: "schedule"; id?: string; schedule: string }
  | {
      kind: "event";
      id?: string;
      instanceId: string;
      signalType: string;
      filters?: JsonEqualsPredicate[];
      sessionPolicy?: unknown;
    };

interface CreateRoutineBody {
  agentId: string;
  name: string;
  instruction: string;
  enabled: boolean;
  triggers: TriggerSpec[];
}

interface UpdateRoutineBody {
  name?: string;
  instruction?: string;
  enabled?: boolean;
  triggers?: TriggerSpec[];
}

interface UpstreamTrigger {
  id: string;
  kind: "schedule" | "event";
  schedule?: string;
  signal_provider_instance_id?: string;
  signal_type?: string;
  filter?: { json_equals?: JsonEqualsPredicate[] } | null;
  materialized_resource_id?: string | null;
  schedule_description?: string | null;
  next_run_at?: string | null;
  session_policy?: unknown;
  created_at?: string;
  updated_at?: string;
}

interface UpstreamAutomation {
  id: string;
  agent_id: string;
  name: string;
  instruction: string;
  enabled: boolean;
  status?: "reconciling" | "active" | "error" | "deleting";
  generation?: number;
  applied_generation?: number;
  error_message?: string | null;
  last_run_at?: string | null;
  last_session_id?: string | null;
  last_error?: string | null;
  authorization?: unknown;
  triggers: UpstreamTrigger[];
  created_at: string;
  updated_at: string;
}

/** Thin compatibility facade over Tilde's authoritative unified automations API. */
export function registerRoutineRoutes(app: Hono, configuredOptions?: RoutineRouteOptions): void {
  const options = (): RoutineRouteOptions | undefined =>
    configuredOptions ?? tildeOptionsFromEnvironment();

  app.get("/api/routines", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Routines");
    const agentId = context.req.query("agent_id")?.trim();
    if (!agentId) return context.json({ error: "agent_id is required" }, 400);
    try {
      return context.json({ items: await listRoutines(resolved, agentId) });
    } catch (error) {
      return tildeUpstreamFailure(context, "routines", error);
    }
  });

  app.post("/api/routines", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Routines");
    let body: CreateRoutineBody;
    try {
      body = parseCreateRoutineBody(await context.req.json());
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "Invalid body" }, 400);
    }
    try {
      await putAutomation(resolved, crypto.randomUUID(), body);
      return context.json({ items: await listRoutines(resolved, body.agentId) }, 201);
    } catch (error) {
      return tildeUpstreamFailure(context, "routines", error);
    }
  });

  app.patch("/api/routines/:automationId", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Routines");
    const agentId = context.req.query("agent_id")?.trim();
    if (!agentId) return context.json({ error: "agent_id is required" }, 400);
    let body: UpdateRoutineBody;
    try {
      body = parseUpdateRoutineBody(await context.req.json());
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "Invalid body" }, 400);
    }
    try {
      const automationId = context.req.param("automationId");
      const current = await getAutomation(resolved, automationId);
      if (current.agent_id !== agentId) return context.json({ error: "Routine not found" }, 404);
      await putAutomation(resolved, automationId, {
        agentId,
        name: body.name ?? current.name,
        instruction: body.instruction ?? current.instruction,
        enabled: body.enabled ?? current.enabled,
        triggers:
          body.triggers === undefined
            ? current.triggers.map(upstreamTriggerSpec)
            : preserveSessionPolicies(body.triggers, current.triggers),
        authorization: current.authorization,
      });
      return context.json({ items: await listRoutines(resolved, agentId) });
    } catch (error) {
      return tildeUpstreamFailure(context, "routines", error);
    }
  });

  app.delete("/api/routines/:automationId", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Routines");
    const agentId = context.req.query("agent_id")?.trim();
    if (!agentId) return context.json({ error: "agent_id is required" }, 400);
    try {
      const automationId = context.req.param("automationId");
      const current = await getAutomation(resolved, automationId);
      if (current.agent_id !== agentId) return context.json({ error: "Routine not found" }, 404);
      await tildeJson(resolved, `/automations/${encodeURIComponent(automationId)}`, {
        method: "DELETE",
      });
      return context.json({ items: await listRoutines(resolved, agentId) });
    } catch (error) {
      return tildeUpstreamFailure(context, "routines", error);
    }
  });

  app.post("/api/routines/:automationId/run", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Routines");
    const agentId = context.req.query("agent_id")?.trim();
    if (!agentId) return context.json({ error: "agent_id is required" }, 400);
    try {
      const automationId = context.req.param("automationId");
      const current = await getAutomation(resolved, automationId);
      if (current.agent_id !== agentId) return context.json({ error: "Routine not found" }, 404);
      const result = valueRecord(
        await tildeJson(resolved, `/automations/${encodeURIComponent(automationId)}/run`, {
          method: "POST",
          body: { run_id: crypto.randomUUID() },
        }),
      );
      const sessionId = text(result?.session_id);
      if (!sessionId) return context.json({ error: "Tilde returned no session id" }, 502);
      return context.json({ session_id: sessionId });
    } catch (error) {
      return tildeUpstreamFailure(context, "routines", error);
    }
  });
}

async function listRoutines(options: RoutineRouteOptions, agentId: string) {
  const items: UpstreamAutomation[] = [];
  let token: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ agent_id: agentId, page_size: "100" });
    if (token) query.set("next_page_token", token);
    const response = valueRecord(await tildeJson(options, `/automations?${query.toString()}`));
    if (!response) throw new Error("Tilde returned an invalid automation page");
    items.push(...(pageItems(response) as UpstreamAutomation[]));
    const next = text(response.next_page_token);
    if (!next) return items.map(serializeRoutine);
    token = next;
  }
  throw new Error("Tilde automation pagination exceeded 100 pages");
}

async function getAutomation(
  options: RoutineRouteOptions,
  automationId: string,
): Promise<UpstreamAutomation> {
  const result = valueRecord(
    await tildeJson(options, `/automations/${encodeURIComponent(automationId)}`),
  );
  if (!result) throw new Error("Tilde returned an invalid automation");
  return result as unknown as UpstreamAutomation;
}

async function putAutomation(
  options: RoutineRouteOptions,
  automationId: string,
  body: CreateRoutineBody & { authorization?: unknown },
): Promise<void> {
  await tildeJson(options, `/automations/${encodeURIComponent(automationId)}`, {
    method: "PUT",
    body: {
      agent_id: body.agentId,
      name: body.name,
      instruction: body.instruction,
      enabled: body.enabled,
      ...(body.authorization === undefined ? {} : { authorization: body.authorization }),
      triggers: body.triggers.map((trigger) => ({
        id: trigger.id ?? crypto.randomUUID(),
        ...(trigger.kind === "schedule"
          ? { kind: "schedule", schedule: trigger.schedule }
          : {
              kind: "event",
              signal_provider_instance_id: trigger.instanceId,
              signal_type: trigger.signalType,
              filter: { json_equals: trigger.filters ?? [] },
              ...(trigger.sessionPolicy === undefined
                ? {}
                : { session_policy: trigger.sessionPolicy }),
            }),
      })),
    },
  });
}

function serializeRoutine(automation: UpstreamAutomation) {
  return {
    id: automation.id,
    agent_id: automation.agent_id,
    name: automation.name,
    instruction: automation.instruction,
    enabled: automation.enabled,
    triggers: automation.triggers.map(serializeTrigger),
    last_run_at: automation.last_run_at ?? null,
    last_session_id: automation.last_session_id ?? null,
    last_error: automation.last_error ?? null,
    error_message: automation.error_message ?? null,
    created_at: automation.created_at,
    updated_at: automation.updated_at,
    status: automation.status,
    generation: automation.generation,
    applied_generation: automation.applied_generation,
  };
}

function serializeTrigger(trigger: UpstreamTrigger) {
  const resourceId = trigger.materialized_resource_id ?? trigger.id;
  if (trigger.kind === "schedule") {
    return {
      id: trigger.id,
      kind: "schedule" as const,
      schedule: trigger.schedule ?? "",
      ...(trigger.schedule_description ? { description: trigger.schedule_description } : {}),
      next_run_at: trigger.next_run_at ?? null,
      routine_id: resourceId,
    };
  }
  const signalType = trigger.signal_type ?? "";
  return {
    id: trigger.id,
    kind: "event" as const,
    instance_id: trigger.signal_provider_instance_id ?? "",
    provider_type: signalType.split(".")[0] ?? "",
    signal_type: signalType,
    filters: trigger.filter?.json_equals ?? [],
    rule_id: resourceId,
  };
}

function upstreamTriggerSpec(trigger: UpstreamTrigger): TriggerSpec {
  if (trigger.kind === "schedule")
    return { id: trigger.id, kind: "schedule", schedule: trigger.schedule ?? "" };
  return {
    id: trigger.id,
    kind: "event",
    instanceId: trigger.signal_provider_instance_id ?? "",
    signalType: trigger.signal_type ?? "",
    filters: trigger.filter?.json_equals ?? [],
    ...(trigger.session_policy === undefined ? {} : { sessionPolicy: trigger.session_policy }),
  };
}

function preserveSessionPolicies(
  desired: TriggerSpec[],
  current: UpstreamTrigger[],
): TriggerSpec[] {
  const currentById = new Map(current.map((trigger) => [trigger.id, trigger]));
  return desired.map((trigger) => {
    if (trigger.kind !== "event" || !trigger.id) return trigger;
    const existing = currentById.get(trigger.id);
    if (
      existing?.kind !== "event" ||
      existing.signal_provider_instance_id !== trigger.instanceId ||
      existing.signal_type !== trigger.signalType ||
      existing.session_policy === undefined
    )
      return trigger;
    return { ...trigger, sessionPolicy: existing.session_policy };
  });
}

function parseCreateRoutineBody(value: unknown): CreateRoutineBody {
  const record = valueRecord(value);
  if (!record) throw new Error("Invalid routine request");
  const agentId = text(record.agent_id);
  const name = text(record.name);
  const instruction = typeof record.instruction === "string" ? record.instruction : "";
  if (!agentId || !name || !instruction)
    throw new Error("agent_id, name, and instruction are required");
  if (record.enabled !== undefined && typeof record.enabled !== "boolean")
    throw new Error("enabled must be a boolean");
  return {
    agentId,
    name,
    instruction,
    enabled: record.enabled ?? true,
    triggers: parseTriggerSpecs(record.triggers, false),
  };
}

function parseUpdateRoutineBody(value: unknown): UpdateRoutineBody {
  const record = valueRecord(value);
  if (!record) throw new Error("Invalid routine request");
  if (record.name !== undefined && !text(record.name)) throw new Error("name must not be empty");
  if (record.instruction !== undefined && typeof record.instruction !== "string")
    throw new Error("instruction must be a string");
  if (record.enabled !== undefined && typeof record.enabled !== "boolean")
    throw new Error("enabled must be a boolean");
  return {
    ...(record.name !== undefined ? { name: text(record.name) } : {}),
    ...(record.instruction !== undefined ? { instruction: record.instruction as string } : {}),
    ...(record.enabled !== undefined ? { enabled: record.enabled } : {}),
    ...(record.triggers !== undefined
      ? { triggers: parseTriggerSpecs(record.triggers, true) }
      : {}),
  };
}

function parseTriggerSpecs(value: unknown, allowIds: boolean): TriggerSpec[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8)
    throw new Error("triggers must contain between 1 and 8 entries");
  const parsed = value.map((entry) => parseTriggerSpec(entry, allowIds));
  const ids = parsed.flatMap((trigger) => (trigger.id ? [trigger.id] : []));
  if (new Set(ids).size !== ids.length) throw new Error("Trigger ids must be unique");
  return parsed;
}

function parseTriggerSpec(value: unknown, allowIds: boolean): TriggerSpec {
  const record = valueRecord(value);
  if (!record) throw new Error("Invalid trigger");
  const id = record.id === undefined ? undefined : text(record.id);
  if (id !== undefined && (!id || !allowIds)) throw new Error("Invalid trigger id");
  if (record.kind === "schedule") {
    const schedule = text(record.schedule);
    if (!schedule) throw new Error("A schedule trigger requires a schedule");
    return { kind: "schedule", schedule, ...(id ? { id } : {}) };
  }
  if (record.kind === "event") {
    const instanceId = text(record.instance_id);
    const signalType = text(record.signal_type);
    if (!instanceId || !signalType)
      throw new Error("An event trigger requires instance_id and signal_type");
    return {
      kind: "event",
      instanceId,
      signalType,
      ...(record.filters === undefined ? {} : { filters: parseFilters(record.filters) }),
      ...(id ? { id } : {}),
    };
  }
  throw new Error('Trigger kind must be "schedule" or "event"');
}

function parseFilters(value: unknown): JsonEqualsPredicate[] {
  if (!Array.isArray(value)) throw new Error("filters must be an array");
  return value.map((entry) => {
    const record = valueRecord(entry);
    const path = text(record?.path);
    if (!record || !path || !("value" in record)) throw new Error("Invalid trigger filter");
    return { path, value: record.value };
  });
}
