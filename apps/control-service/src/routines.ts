import type { Hono } from "hono";
import {
  tildeJson,
  tildeOptionsFromEnvironment,
  tildePages,
  tildeUnavailable,
  tildeUnpagedItems,
  tildeUpstreamFailure,
  pageItems,
  text,
  valueRecord,
  type TildeRouteOptions,
} from "./tilde-upstream.js";

export type RoutineRouteOptions = TildeRouteOptions;

interface OpenbotStamp {
  group: string;
  trigger: string;
  instruction?: string;
}

interface UpstreamRoutine {
  id: string;
  agent_inbox_id?: string;
  title?: string;
  prompt?: string;
  schedule?: string;
  schedule_description?: string;
  enabled?: boolean;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_session_id?: string | null;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown> | null;
}

interface JsonEqualsPredicate {
  path: string;
  value: unknown;
}

interface UpstreamRule {
  id: string;
  signal_provider_instance_id?: string;
  display_name?: string;
  status?: string;
  signal_type?: string;
  filter?: { json_equals?: JsonEqualsPredicate[] } | null;
  session_policy?: Record<string, unknown> | null;
  action?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown> | null;
}

type Member =
  | { kind: "schedule"; stamp: OpenbotStamp; routine: UpstreamRoutine }
  | { kind: "event"; stamp: OpenbotStamp; rule: UpstreamRule };

interface ScheduleTriggerSpec {
  kind: "schedule";
  id?: string;
  schedule: string;
}

interface EventTriggerSpec {
  kind: "event";
  id?: string;
  instanceId: string;
  signalType: string;
  filters?: JsonEqualsPredicate[];
}

type TriggerSpec = ScheduleTriggerSpec | EventTriggerSpec;

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

interface SignalTypeCatalogEntry {
  default_session_key_template?: string;
  default_session_title_template?: string | null;
}

/**
 * Owner-facing unified routines. A routine is a group of Tilde ChatKit
 * routines (schedule triggers) and signal rules (event triggers) stamped with
 * `metadata.openbot = { group, trigger }`, reconstructed statelessly on read.
 */
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
    const group = crypto.randomUUID();
    const created: Array<{ kind: "schedule" | "event"; id: string }> = [];
    try {
      const catalog = new SignalTypeCatalog(resolved);
      for (const spec of body.triggers) {
        created.push(
          await createMember(resolved, catalog, spec, {
            agentId: body.agentId,
            name: body.name,
            instruction: body.instruction,
            enabled: body.enabled,
            group,
            trigger: crypto.randomUUID(),
          }),
        );
      }
    } catch (error) {
      await rollbackMembers(resolved, created);
      return tildeUpstreamFailure(context, "routines", error);
    }
    try {
      return context.json({ items: await listRoutines(resolved, body.agentId) }, 201);
    } catch (error) {
      return tildeUpstreamFailure(context, "routines", error);
    }
  });

  app.patch("/api/routines/:groupId", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Routines");
    const agentId = context.req.query("agent_id")?.trim();
    if (!agentId) return context.json({ error: "agent_id is required" }, 400);
    const groupId = context.req.param("groupId");
    let body: UpdateRoutineBody;
    try {
      body = parseUpdateRoutineBody(await context.req.json());
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "Invalid body" }, 400);
    }
    try {
      const members = (await loadMembers(resolved, agentId)).filter(
        (member) => member.stamp.group === groupId,
      );
      if (members.length === 0) return context.json({ error: "Routine not found" }, 404);
      const current = composeRoutine(groupId, agentId, members);
      const name = body.name ?? current.name;
      const instruction = body.instruction ?? current.instruction;
      // Only an explicit `enabled` fans out; otherwise every member keeps the
      // enabled state it already has upstream.
      const shared: SharedContext = {
        agentId,
        name,
        instruction,
        group: groupId,
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      };
      const catalog = new SignalTypeCatalog(resolved);

      if (body.triggers) {
        const existing = new Map(members.map((member) => [member.stamp.trigger, member]));
        for (const spec of body.triggers) {
          if (spec.id === undefined) continue;
          const member = existing.get(spec.id);
          if (!member) return context.json({ error: `Unknown trigger id "${spec.id}"` }, 400);
          if (member.kind !== spec.kind)
            return context.json({ error: "A trigger's kind cannot change" }, 400);
        }
        const kept = new Set<string>();
        for (const spec of body.triggers) {
          if (spec.id === undefined) continue;
          kept.add(spec.id);
          const member = existing.get(spec.id) as Member;
          await updateMember(resolved, catalog, member, spec, shared);
        }
        for (const spec of body.triggers) {
          if (spec.id !== undefined) continue;
          await createMember(resolved, catalog, spec, {
            ...shared,
            enabled: shared.enabled ?? current.enabled,
            trigger: crypto.randomUUID(),
          });
        }
        for (const member of members) {
          if (kept.has(member.stamp.trigger)) continue;
          await deleteMember(resolved, member);
        }
      } else if (
        body.name !== undefined ||
        body.instruction !== undefined ||
        body.enabled !== undefined
      ) {
        for (const member of members) {
          if (member.kind === "schedule") {
            await tildeJson(
              resolved,
              `/chatkit/routines/${encodeURIComponent(member.routine.id)}`,
              {
                method: "PATCH",
                body: {
                  title: name,
                  prompt: instruction,
                  ...(shared.enabled !== undefined ? { enabled: shared.enabled } : {}),
                },
              },
            );
          } else {
            await tildeJson(resolved, `/signals/rules/${encodeURIComponent(member.rule.id)}`, {
              method: "PATCH",
              body: ruleUpdateBody(member.rule, member.stamp, shared),
            });
          }
        }
      }
      return context.json({ items: await listRoutines(resolved, agentId) });
    } catch (error) {
      return tildeUpstreamFailure(context, "routines", error);
    }
  });

  app.delete("/api/routines/:groupId", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Routines");
    const agentId = context.req.query("agent_id")?.trim();
    if (!agentId) return context.json({ error: "agent_id is required" }, 400);
    const groupId = context.req.param("groupId");
    try {
      const members = (await loadMembers(resolved, agentId)).filter(
        (member) => member.stamp.group === groupId,
      );
      if (members.length === 0) return context.json({ error: "Routine not found" }, 404);
      for (const member of members) await deleteMember(resolved, member);
      return context.json({ items: await listRoutines(resolved, agentId) });
    } catch (error) {
      return tildeUpstreamFailure(context, "routines", error);
    }
  });

  app.post("/api/routines/:groupId/run", async (context) => {
    const resolved = options();
    if (!resolved) return tildeUnavailable(context, "Routines");
    const agentId = context.req.query("agent_id")?.trim();
    if (!agentId) return context.json({ error: "agent_id is required" }, 400);
    const groupId = context.req.param("groupId");
    try {
      const members = (await loadMembers(resolved, agentId)).filter(
        (member) => member.stamp.group === groupId,
      );
      if (members.length === 0) return context.json({ error: "Routine not found" }, 404);
      const routine = composeRoutine(groupId, agentId, members);
      const session = (await tildeJson(
        resolved,
        `/chatkit/mission-control/agents/${encodeURIComponent(agentId)}/sessions`,
        { method: "POST", body: { title: routine.name } },
      )) as Record<string, unknown>;
      const sessionId = sessionIdFrom(session);
      if (!sessionId) return context.json({ error: "Tilde returned no session id" }, 502);
      await tildeJson(
        resolved,
        `/chatkit/mission-control/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
        { method: "POST", body: { text: routine.instruction, attachment_ids: [] } },
      );
      return context.json({ session_id: sessionId });
    } catch (error) {
      return tildeUpstreamFailure(context, "routines", error);
    }
  });
}

function sessionIdFrom(response: Record<string, unknown>): string | undefined {
  const session = valueRecord(response.session);
  const id = session?.id ?? response.id;
  return typeof id === "string" && id ? id : undefined;
}

async function listRoutines(options: RoutineRouteOptions, agentId: string) {
  const members = await loadMembers(options, agentId);
  const groups = new Map<string, Member[]>();
  for (const member of members) {
    const list = groups.get(member.stamp.group);
    if (list) list.push(member);
    else groups.set(member.stamp.group, [member]);
  }
  return [...groups.entries()]
    .map(([group, grouped]) => composeRoutine(group, agentId, grouped))
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

async function loadMembers(options: RoutineRouteOptions, agentId: string): Promise<Member[]> {
  const [routines, rules] = await Promise.all([
    tildePages(options, "/chatkit/routines", 100) as Promise<UpstreamRoutine[]>,
    // `/signals/rules` is unpaginated upstream; a partial list would orphan
    // members from their group on the next replace-all edit.
    tildeUnpagedItems(options, "/signals/rules") as Promise<UpstreamRule[]>,
  ]);
  const members: Member[] = [];
  for (const routine of routines) {
    const stamp = openbotStamp(routine.metadata);
    if (!stamp || routine.agent_inbox_id !== agentId) continue;
    members.push({ kind: "schedule", stamp, routine });
  }
  for (const rule of rules) {
    const stamp = openbotStamp(rule.metadata);
    if (!stamp || valueRecord(rule.action)?.agent_inbox_id !== agentId) continue;
    members.push({ kind: "event", stamp, rule });
  }
  return members;
}

function openbotStamp(
  metadata: Record<string, unknown> | null | undefined,
): OpenbotStamp | undefined {
  const openbot = valueRecord(valueRecord(metadata ?? undefined)?.openbot);
  const group = text(openbot?.group);
  const trigger = text(openbot?.trigger);
  if (!group || !trigger) return undefined;
  const instruction = openbot?.instruction;
  return {
    group,
    trigger,
    ...(typeof instruction === "string" ? { instruction } : {}),
  };
}

function composeRoutine(groupId: string, agentId: string, members: Member[]) {
  const ordered = [...members].sort(
    (left, right) =>
      memberCreatedAt(left).localeCompare(memberCreatedAt(right)) ||
      left.stamp.trigger.localeCompare(right.stamp.trigger),
  );
  const latestFirst = [...members].sort((left, right) =>
    memberUpdatedAt(right).localeCompare(memberUpdatedAt(left)),
  );
  const newest = latestFirst[0] as Member;
  const name = (newest.kind === "schedule" ? newest.routine.title : newest.rule.display_name) ?? "";
  const latestSchedule = latestFirst.find(
    (member): member is Member & { kind: "schedule" } => member.kind === "schedule",
  );
  const instruction =
    latestSchedule?.routine.prompt ??
    latestFirst.find((member) => member.stamp.instruction !== undefined)?.stamp.instruction ??
    "";
  const enabled = members.some((member) =>
    member.kind === "schedule" ? member.routine.enabled === true : member.rule.status === "enabled",
  );
  let lastRunAt: string | null = null;
  let lastSessionId: string | null = null;
  for (const member of members) {
    if (member.kind !== "schedule" || !member.routine.last_run_at) continue;
    if (lastRunAt !== null && member.routine.last_run_at.localeCompare(lastRunAt) <= 0) continue;
    lastRunAt = member.routine.last_run_at;
    lastSessionId = member.routine.last_session_id ?? null;
  }
  const latestErrored = latestFirst.find(
    (member): member is Member & { kind: "schedule" } =>
      member.kind === "schedule" && typeof member.routine.last_error === "string",
  );
  return {
    id: groupId,
    agent_id: agentId,
    name,
    instruction,
    enabled,
    triggers: ordered.map(serializeTrigger),
    last_run_at: lastRunAt,
    last_session_id: lastSessionId,
    last_error: latestErrored?.routine.last_error ?? null,
    created_at: memberCreatedAt(ordered[0] as Member),
    updated_at: memberUpdatedAt(newest),
  };
}

function memberCreatedAt(member: Member): string {
  return (member.kind === "schedule" ? member.routine.created_at : member.rule.created_at) ?? "";
}

function memberUpdatedAt(member: Member): string {
  return (member.kind === "schedule" ? member.routine.updated_at : member.rule.updated_at) ?? "";
}

function serializeTrigger(member: Member) {
  if (member.kind === "schedule") {
    return {
      id: member.stamp.trigger,
      kind: "schedule" as const,
      schedule: member.routine.schedule ?? "",
      description: member.routine.schedule_description ?? "",
      next_run_at: member.routine.next_run_at ?? null,
      routine_id: member.routine.id,
    };
  }
  const signalType = member.rule.signal_type ?? "";
  return {
    id: member.stamp.trigger,
    kind: "event" as const,
    instance_id: member.rule.signal_provider_instance_id ?? "",
    provider_type: signalType.split(".")[0] ?? "",
    signal_type: signalType,
    filters: member.rule.filter?.json_equals ?? [],
    rule_id: member.rule.id,
  };
}

interface MemberContext {
  agentId: string;
  name: string;
  instruction: string;
  enabled: boolean;
  group: string;
  trigger: string;
}

/** Group-wide edit context. `enabled` is absent unless the request set it. */
type SharedContext = Omit<MemberContext, "trigger" | "enabled"> & { enabled?: boolean };

/** Lazily fetched provider catalog used to resolve session-policy defaults. */
class SignalTypeCatalog {
  #options: RoutineRouteOptions;
  #entries: Promise<Map<string, SignalTypeCatalogEntry>> | undefined;

  constructor(options: RoutineRouteOptions) {
    this.#options = options;
  }

  async find(signalType: string): Promise<SignalTypeCatalogEntry | undefined> {
    this.#entries ??= this.#load();
    return (await this.#entries).get(signalType);
  }

  async #load(): Promise<Map<string, SignalTypeCatalogEntry>> {
    const page = (await tildeJson(this.#options, "/signals/providers?page_size=100")) as Record<
      string,
      unknown
    >;
    const entries = new Map<string, SignalTypeCatalogEntry>();
    for (const provider of pageItems(page)) {
      const signalTypes = valueRecord(provider)?.signal_types;
      if (!Array.isArray(signalTypes)) continue;
      for (const signalType of signalTypes) {
        const record = valueRecord(signalType);
        const typeId = text(record?.type_id);
        if (typeId) entries.set(typeId, record as SignalTypeCatalogEntry);
      }
    }
    return entries;
  }
}

async function sessionPolicyFor(
  catalog: SignalTypeCatalog,
  signalType: string,
  name: string,
): Promise<Record<string, unknown>> {
  const entry = await catalog.find(signalType);
  const template = text(entry?.default_session_key_template);
  if (!template) return { type: "new_session_per_delivery", title_template: name };
  return {
    type: "session_key_template",
    namespace: "openbot",
    template,
    create_if_missing: true,
    title_template: entry?.default_session_title_template ?? name,
  };
}

async function createMember(
  options: RoutineRouteOptions,
  catalog: SignalTypeCatalog,
  spec: TriggerSpec,
  member: MemberContext,
): Promise<{ kind: "schedule" | "event"; id: string }> {
  if (spec.kind === "schedule") {
    const routine = (await tildeJson(options, "/chatkit/routines", {
      method: "POST",
      body: {
        agent_inbox_id: member.agentId,
        title: member.name,
        prompt: member.instruction,
        schedule: spec.schedule,
        enabled: member.enabled,
        metadata: { openbot: { group: member.group, trigger: member.trigger } },
      },
    })) as UpstreamRoutine;
    return { kind: "schedule", id: routine.id };
  }
  const sessionPolicy = await sessionPolicyFor(catalog, spec.signalType, member.name);
  const body = {
    signal_provider_instance_id: spec.instanceId,
    display_name: member.name,
    signal_type: spec.signalType,
    filter: { json_equals: spec.filters ?? [] },
    session_policy: sessionPolicy,
    action: { type: "invoke_chatkit_agent", agent_inbox_id: member.agentId },
    metadata: {
      openbot: { group: member.group, trigger: member.trigger, instruction: member.instruction },
    },
  };
  const rule = (await tildeJson(options, "/signals/rules", {
    method: "POST",
    body,
  })) as UpstreamRule;
  // Rule creation is forced enabled upstream; a disabled unified routine must
  // immediately flip the fresh rule off.
  if (!member.enabled) {
    try {
      await tildeJson(options, `/signals/rules/${encodeURIComponent(rule.id)}`, {
        method: "PATCH",
        body: {
          display_name: member.name,
          status: "disabled",
          filter: body.filter,
          session_policy: sessionPolicy,
          action: body.action,
          metadata: body.metadata,
        },
      });
    } catch (error) {
      await tildeJson(options, `/signals/rules/${encodeURIComponent(rule.id)}`, {
        method: "DELETE",
      }).catch(() => undefined);
      throw error;
    }
  }
  return { kind: "event", id: rule.id };
}

async function updateMember(
  options: RoutineRouteOptions,
  catalog: SignalTypeCatalog,
  member: Member,
  spec: TriggerSpec,
  shared: SharedContext,
): Promise<void> {
  if (member.kind === "schedule" && spec.kind === "schedule") {
    await tildeJson(options, `/chatkit/routines/${encodeURIComponent(member.routine.id)}`, {
      method: "PATCH",
      body: {
        title: shared.name,
        prompt: shared.instruction,
        schedule: spec.schedule,
        ...(shared.enabled !== undefined ? { enabled: shared.enabled } : {}),
      },
    });
    return;
  }
  if (member.kind !== "event" || spec.kind !== "event") return;
  // Upstream rule updates cannot move a rule to another instance or signal
  // type; recreate under the same trigger id instead.
  if (
    spec.instanceId !== member.rule.signal_provider_instance_id ||
    spec.signalType !== member.rule.signal_type
  ) {
    await createMember(options, catalog, spec, {
      ...shared,
      enabled: shared.enabled ?? member.rule.status === "enabled",
      trigger: member.stamp.trigger,
    });
    await deleteMember(options, member);
    return;
  }
  await tildeJson(options, `/signals/rules/${encodeURIComponent(member.rule.id)}`, {
    method: "PATCH",
    body: ruleUpdateBody(member.rule, member.stamp, shared, spec.filters),
  });
}

function ruleUpdateBody(
  rule: UpstreamRule,
  stamp: OpenbotStamp,
  shared: SharedContext,
  filters?: JsonEqualsPredicate[],
): Record<string, unknown> {
  const status =
    shared.enabled === undefined
      ? (rule.status ?? "enabled")
      : shared.enabled
        ? "enabled"
        : "disabled";
  return {
    display_name: shared.name,
    status,
    filter: { json_equals: filters ?? rule.filter?.json_equals ?? [] },
    session_policy: rule.session_policy ?? {
      type: "new_session_per_delivery",
      title_template: shared.name,
    },
    action: rule.action ?? { type: "invoke_chatkit_agent", agent_inbox_id: shared.agentId },
    metadata: {
      ...rule.metadata,
      openbot: { group: shared.group, trigger: stamp.trigger, instruction: shared.instruction },
    },
  };
}

async function deleteMember(options: RoutineRouteOptions, member: Member): Promise<void> {
  if (member.kind === "schedule") {
    await tildeJson(options, `/chatkit/routines/${encodeURIComponent(member.routine.id)}`, {
      method: "DELETE",
    });
    return;
  }
  await tildeJson(options, `/signals/rules/${encodeURIComponent(member.rule.id)}`, {
    method: "DELETE",
  });
}

async function rollbackMembers(
  options: RoutineRouteOptions,
  created: Array<{ kind: "schedule" | "event"; id: string }>,
): Promise<void> {
  for (const member of [...created].reverse()) {
    const path =
      member.kind === "schedule"
        ? `/chatkit/routines/${encodeURIComponent(member.id)}`
        : `/signals/rules/${encodeURIComponent(member.id)}`;
    await tildeJson(options, path, { method: "DELETE" }).catch(() => undefined);
  }
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
  return value.map((entry) => parseTriggerSpec(entry, allowIds));
}

function parseTriggerSpec(value: unknown, allowIds: boolean): TriggerSpec {
  const record = valueRecord(value);
  if (!record) throw new Error("Invalid trigger");
  const id = record.id === undefined ? undefined : text(record.id);
  if (id !== undefined && (!id || !allowIds)) throw new Error("Invalid trigger id");
  if (record.kind === "schedule") {
    const schedule = text(record.schedule);
    if (!schedule) throw new Error("A schedule trigger requires a schedule");
    return { kind: "schedule", schedule, ...(id !== undefined ? { id } : {}) };
  }
  if (record.kind === "event") {
    const instanceId = text(record.instance_id);
    const signalType = text(record.signal_type);
    if (!instanceId || !signalType)
      throw new Error("An event trigger requires instance_id and signal_type");
    const filters = parseFilters(record.filters);
    return {
      kind: "event",
      instanceId,
      signalType,
      ...(filters !== undefined ? { filters } : {}),
      ...(id !== undefined ? { id } : {}),
    };
  }
  throw new Error('Trigger kind must be "schedule" or "event"');
}

function parseFilters(value: unknown): JsonEqualsPredicate[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("filters must be an array");
  return value.map((entry) => {
    const record = valueRecord(entry);
    const path = text(record?.path);
    if (!record || !path || !("value" in record)) throw new Error("Invalid trigger filter");
    return { path, value: record.value };
  });
}
