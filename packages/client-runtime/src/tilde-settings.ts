import { z } from "zod";
import type {
  CreateRoutineInput,
  Routine,
  RoutineTriggerSpec,
  UpdateRoutineInput,
} from "./contracts/routines.js";
import type {
  CreateSignalInstanceInput,
  SignalDelivery,
  SignalInstance,
  SignalProvider,
  TestSignalInstanceInput,
  TestSignalInstanceResult,
  UpdateSignalInstanceInput,
} from "./contracts/signals.js";

type RequestJson = (path: string, init?: RequestInit) => Promise<unknown>;
type RoutineTriggerWrite = RoutineTriggerSpec & {
  enabled?: boolean;
  metadata?: unknown;
  sessionPolicy?: unknown;
  action?: unknown;
  instructionPolicy?: string;
};
type RoutineWrite = Omit<CreateRoutineInput, "triggers"> & {
  triggers: RoutineTriggerWrite[];
  authorization?: unknown;
  metadata?: unknown;
  expectedVersion?: number;
};

export interface TildeSettingsTransport {
  requestJson: RequestJson;
  apiBaseUrl?: string | (() => string | undefined);
}

const JsonEqualsPredicateSchema = z.object({ path: z.string(), value: z.unknown() }).passthrough();
const UpstreamTriggerSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["schedule", "event"]),
    enabled: z.boolean().optional(),
    schedule: z.string().optional(),
    signal_provider_instance_id: z.string().optional(),
    signal_type: z.string().optional(),
    filter: z
      .object({ json_equals: z.array(JsonEqualsPredicateSchema).optional() })
      .nullable()
      .optional(),
    materialized_resource_id: z.string().nullable().optional(),
    schedule_description: z.string().nullable().optional(),
    next_run_at: z.string().nullable().optional(),
    session_policy: z.unknown().optional(),
    action: z.unknown().optional(),
    instruction_policy: z.string().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough();
const UpstreamAutomationSchema = z
  .object({
    id: z.string(),
    agent_id: z.string(),
    name: z.string(),
    instruction: z.string(),
    enabled: z.boolean(),
    version: z.number().optional(),
    metadata: z.unknown().optional(),
    status: z.enum(["reconciling", "active", "error", "deleting"]).optional(),
    generation: z.number().optional(),
    applied_generation: z.number().optional(),
    error_message: z.string().nullable().optional(),
    last_run_at: z.string().nullable().optional(),
    last_session_id: z.string().nullable().optional(),
    last_error: z.string().nullable().optional(),
    authorization: z.unknown().optional(),
    triggers: z.array(UpstreamTriggerSchema),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();
const AutomationPageSchema = z.object({
  items: z.array(UpstreamAutomationSchema),
  next_page_token: z.string().nullable().optional(),
});
const AutomationRunSchema = z.object({ session_id: z.string().min(1) });

const UpstreamSignalProviderSchema = z
  .object({
    type_id: z.string(),
    name: z.string().optional(),
    documentation: z.string().optional(),
    instructions: z.string().optional(),
    auth_methods: z.array(z.string()).optional(),
    route_descriptors: z.array(z.object({ path: z.string().optional() }).passthrough()).optional(),
    signal_types: z
      .array(
        z
          .object({
            type_id: z.string(),
            name: z.string().optional(),
            documentation: z.string().optional(),
            categories: z.array(z.string()).optional(),
            default_session_key_template: z.string().nullable().optional(),
            default_session_title_template: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
    credential_sources: z
      .array(
        z
          .object({
            type_id: z.string(),
            name: z.string().optional(),
            requires_brokering: z.boolean().optional(),
            display_name_description: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
    interpolation_variables: z
      .array(
        z
          .object({
            key: z.string().optional(),
            description: z.string().optional(),
            example: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    webhook_verification: z
      .object({
        requires_signing_key: z.boolean().optional(),
        signing_key_description: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();
const UpstreamSignalInstanceSchema = z
  .object({
    id: z.string(),
    display_name: z.string().optional(),
    signal_provider_source_type_id: z.string().optional(),
    credential_source_type_id: z.string().optional(),
    status: z.string().optional(),
    ingress_mode: z.string().optional(),
    configuration: z.record(z.string(), z.unknown()).optional(),
    polling_state: z.record(z.string(), z.unknown()).optional(),
    poll_interval_seconds: z.number().nullable().optional(),
    last_error: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();
const UpstreamSignalDeliverySchema = z
  .object({
    id: z.string(),
    signal_provider_instance_id: z.string().optional(),
    signal_type: z.string().optional(),
    summary: z.string().nullable().optional(),
    status: z.string().optional(),
    chatkit_session_id: z.string().nullable().optional(),
    error_message: z.string().nullable().optional(),
    matched_rule_ids: z.array(z.string()).optional(),
    matched_trigger_ids: z.array(z.string()).optional(),
    created_at: z.string().optional(),
  })
  .passthrough();
const SignalProviderPageSchema = z.object({
  items: z.array(UpstreamSignalProviderSchema),
  next_page_token: z.string().nullable().optional(),
});
const SignalInstancePageSchema = z.object({
  items: z.array(UpstreamSignalInstanceSchema),
  next_page_token: z.string().nullable().optional(),
});
const SignalDeliveryPageSchema = z.object({ items: z.array(UpstreamSignalDeliverySchema) });
const SignalTestResultSchema = z.object({
  accepted: z.number().optional(),
  delivery_ids: z.array(z.string()).optional(),
});

export function createTildeRoutineClient(transport: TildeSettingsTransport) {
  const request = transport.requestJson;

  async function listRoutines(agentId: string): Promise<Routine[]> {
    const items: z.infer<typeof UpstreamAutomationSchema>[] = [];
    let token: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ agent_id: agentId, page_size: "100" });
      if (token) query.set("next_page_token", token);
      const response = AutomationPageSchema.parse(
        await request(`/api/tilde/automations?${query.toString()}`),
      );
      items.push(...response.items);
      if (!response.next_page_token) return items.map(serializeRoutine);
      token = response.next_page_token;
    }
    throw new Error("Tilde automation pagination exceeded 100 pages");
  }

  async function putAutomation(id: string, body: RoutineWrite): Promise<void> {
    await request(`/api/tilde/automations/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        agent_id: body.agentId,
        name: body.name,
        instruction: body.instruction,
        enabled: body.enabled ?? true,
        ...(body.authorization === undefined ? {} : { authorization: body.authorization }),
        ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
        ...(body.expectedVersion === undefined ? {} : { expected_version: body.expectedVersion }),
        triggers: body.triggers.map(upstreamTriggerBody),
      }),
    });
  }

  return {
    listRoutines,
    async createRoutine(input: CreateRoutineInput): Promise<Routine[]> {
      await putAutomation(crypto.randomUUID(), input);
      return await listRoutines(input.agentId);
    },
    async updateRoutine(
      id: string,
      agentId: string,
      input: UpdateRoutineInput,
    ): Promise<Routine[]> {
      const current = UpstreamAutomationSchema.parse(
        await request(`/api/tilde/automations/${encodeURIComponent(id)}`),
      );
      if (current.agent_id !== agentId) throw new Error("Routine not found");
      await putAutomation(id, {
        agentId,
        name: input.name ?? current.name,
        instruction: input.instruction ?? current.instruction,
        enabled: input.enabled ?? current.enabled,
        triggers:
          input.triggers === undefined
            ? current.triggers.map(upstreamTriggerSpec)
            : preserveTriggerConfiguration(input.triggers, current.triggers),
        authorization: current.authorization,
        metadata: current.metadata,
        expectedVersion: current.version,
      });
      return await listRoutines(agentId);
    },
    async deleteRoutine(id: string, agentId: string): Promise<Routine[]> {
      const current = UpstreamAutomationSchema.parse(
        await request(`/api/tilde/automations/${encodeURIComponent(id)}`),
      );
      if (current.agent_id !== agentId) throw new Error("Routine not found");
      await request(`/api/tilde/automations/${encodeURIComponent(id)}`, { method: "DELETE" });
      return await listRoutines(agentId);
    },
    async runRoutine(id: string, agentId: string): Promise<string> {
      const current = UpstreamAutomationSchema.parse(
        await request(`/api/tilde/automations/${encodeURIComponent(id)}`),
      );
      if (current.agent_id !== agentId) throw new Error("Routine not found");
      return AutomationRunSchema.parse(
        await request(`/api/tilde/automations/${encodeURIComponent(id)}/run`, {
          method: "POST",
          body: JSON.stringify({ run_id: crypto.randomUUID() }),
        }),
      ).session_id;
    },
  };
}

export function createTildeSignalClient(transport: TildeSettingsTransport) {
  const request = transport.requestJson;
  const apiBaseUrl = () => {
    const configured =
      typeof transport.apiBaseUrl === "function" ? transport.apiBaseUrl() : transport.apiBaseUrl;
    return (configured ?? "https://api.trytilde.ai").replace(/\/+$/, "");
  };

  async function upstreamProviders() {
    const items: z.infer<typeof UpstreamSignalProviderSchema>[] = [];
    let token: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ page_size: "100" });
      if (token) query.set("next_page_token", token);
      const response = SignalProviderPageSchema.parse(
        await request(`/api/tilde/signals/providers?${query.toString()}`),
      );
      items.push(...response.items);
      if (!response.next_page_token) return items;
      token = response.next_page_token;
    }
    throw new Error("Tilde signal provider pagination exceeded 100 pages");
  }

  async function upstreamInstances() {
    const items: z.infer<typeof UpstreamSignalInstanceSchema>[] = [];
    let token: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ page_size: "100" });
      if (token) query.set("next_page_token", token);
      const response = SignalInstancePageSchema.parse(
        await request(`/api/tilde/signals/instances?${query.toString()}`),
      );
      items.push(...response.items);
      if (!response.next_page_token) return items;
      token = response.next_page_token;
    }
    throw new Error("Tilde signal instance pagination exceeded 100 pages");
  }

  return {
    async listSignalProviders(): Promise<SignalProvider[]> {
      return (await upstreamProviders()).map(serializeSignalProvider);
    },
    async listSignalInstances(): Promise<SignalInstance[]> {
      const [items, providers] = await Promise.all([upstreamInstances(), upstreamProviders()]);
      const routes = routePathsByProvider(providers);
      return items.map((instance) => serializeSignalInstance(apiBaseUrl(), instance, routes));
    },
    async createSignalInstance(input: CreateSignalInstanceInput): Promise<SignalInstance> {
      const providers = await upstreamProviders();
      const provider = providers.find((candidate) => candidate.type_id === input.providerType);
      if (!provider) throw new Error("Unknown signal provider");
      const credentialSourceTypeId =
        input.credentialSourceTypeId ??
        provider.credential_sources?.find((source) => source.requires_brokering !== true)?.type_id;
      if (!credentialSourceTypeId) throw new Error("credential_source_type_id is required");
      const instance = UpstreamSignalInstanceSchema.parse(
        await request("/api/tilde/signals/instances", {
          method: "POST",
          body: JSON.stringify({
            id: `spi_${crypto.randomUUID()}`,
            display_name: input.displayName,
            signal_provider_source_type_id: input.providerType,
            credential_source_type_id: credentialSourceTypeId,
            ingress_mode: input.ingressMode ?? "webhook",
            configuration: {
              ...input.configuration,
              ...(input.signingSecret ? { provider_webhook_signing_key: input.signingSecret } : {}),
            },
          }),
        }),
      );
      return serializeSignalInstance(apiBaseUrl(), instance, routePathsByProvider(providers));
    },
    async updateSignalInstance(
      id: string,
      input: UpdateSignalInstanceInput,
    ): Promise<SignalInstance> {
      const existing = UpstreamSignalInstanceSchema.parse(
        await request(`/api/tilde/signals/instances/${encodeURIComponent(id)}`),
      );
      const updated = UpstreamSignalInstanceSchema.parse(
        await request(`/api/tilde/signals/instances/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            display_name: input.displayName ?? existing.display_name ?? id,
            status: input.status ?? existing.status ?? "enabled",
            configuration: {
              ...withoutRedactedValues(input.configuration ?? existing.configuration ?? {}),
              ...(input.signingSecret ? { provider_webhook_signing_key: input.signingSecret } : {}),
            },
            polling_state: existing.polling_state ?? {},
            ...(existing.poll_interval_seconds == null
              ? {}
              : { poll_interval_seconds: existing.poll_interval_seconds }),
          }),
        }),
      );
      const providers = await upstreamProviders();
      return serializeSignalInstance(apiBaseUrl(), updated, routePathsByProvider(providers));
    },
    async deleteSignalInstance(id: string): Promise<void> {
      await request(`/api/tilde/signals/instances/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    async testSignalInstance(
      id: string,
      input: TestSignalInstanceInput = {},
    ): Promise<TestSignalInstanceResult> {
      const result = SignalTestResultSchema.parse(
        await request(`/api/tilde/signals/instances/${encodeURIComponent(id)}/test`, {
          method: "POST",
          body: JSON.stringify({
            ...(input.signalType ? { signal_type: input.signalType } : {}),
            ...(input.summary ? { summary: input.summary } : {}),
            data: input.data ?? {},
          }),
        }),
      );
      return { accepted: result.accepted ?? 0, delivery_ids: result.delivery_ids ?? [] };
    },
    async listSignalDeliveries(instanceId: string): Promise<SignalDelivery[]> {
      const query = new URLSearchParams({ page_size: "20", instance_id: instanceId });
      return SignalDeliveryPageSchema.parse(
        await request(`/api/tilde/signals/deliveries?${query.toString()}`),
      ).items.map(serializeSignalDelivery);
    },
  };
}

function serializeRoutine(automation: z.infer<typeof UpstreamAutomationSchema>): Routine {
  return {
    id: automation.id,
    agent_id: automation.agent_id,
    name: automation.name,
    instruction: automation.instruction,
    enabled: automation.enabled,
    triggers: automation.triggers.map((trigger) => {
      if (trigger.kind === "schedule")
        return {
          id: trigger.id,
          kind: "schedule" as const,
          schedule: trigger.schedule ?? "",
          ...(trigger.schedule_description ? { description: trigger.schedule_description } : {}),
          next_run_at: trigger.next_run_at ?? null,
        };
      const signalType = trigger.signal_type ?? "";
      return {
        id: trigger.id,
        kind: "event" as const,
        instance_id: trigger.signal_provider_instance_id ?? "",
        provider_type: signalType.split(".")[0] ?? "",
        signal_type: signalType,
        filters: trigger.filter?.json_equals ?? [],
      };
    }),
    last_run_at: automation.last_run_at ?? null,
    last_session_id: automation.last_session_id ?? null,
    last_error: automation.last_error ?? null,
    created_at: automation.created_at,
    updated_at: automation.updated_at,
    ...(automation.error_message === undefined ? {} : { error_message: automation.error_message }),
    ...(automation.status === undefined ? {} : { status: automation.status }),
    ...(automation.generation === undefined ? {} : { generation: automation.generation }),
    ...(automation.applied_generation === undefined
      ? {}
      : { applied_generation: automation.applied_generation }),
  };
}

function upstreamTriggerBody(trigger: RoutineTriggerWrite) {
  return {
    id: trigger.id ?? crypto.randomUUID(),
    ...(trigger.enabled === undefined ? {} : { enabled: trigger.enabled }),
    ...(trigger.metadata === undefined ? {} : { metadata: trigger.metadata }),
    ...(trigger.kind === "schedule"
      ? { kind: "schedule", schedule: trigger.schedule }
      : {
          kind: "event",
          signal_provider_instance_id: trigger.instanceId,
          signal_type: trigger.signalType,
          filter: { json_equals: trigger.filters ?? [] },
          ...(trigger.sessionPolicy === undefined ? {} : { session_policy: trigger.sessionPolicy }),
          ...(trigger.action === undefined ? {} : { action: trigger.action }),
          ...(trigger.instructionPolicy === undefined
            ? {}
            : { instruction_policy: trigger.instructionPolicy }),
        }),
  };
}

function upstreamTriggerSpec(trigger: z.infer<typeof UpstreamTriggerSchema>): RoutineTriggerWrite {
  if (trigger.kind === "schedule")
    return {
      id: trigger.id,
      kind: "schedule",
      schedule: trigger.schedule ?? "",
      ...(trigger.enabled === undefined ? {} : { enabled: trigger.enabled }),
      ...(trigger.metadata === undefined ? {} : { metadata: trigger.metadata }),
    };
  return {
    id: trigger.id,
    kind: "event",
    instanceId: trigger.signal_provider_instance_id ?? "",
    signalType: trigger.signal_type ?? "",
    filters: trigger.filter?.json_equals ?? [],
    ...(trigger.enabled === undefined ? {} : { enabled: trigger.enabled }),
    ...(trigger.metadata === undefined ? {} : { metadata: trigger.metadata }),
    ...(trigger.session_policy === undefined ? {} : { sessionPolicy: trigger.session_policy }),
    ...(trigger.action === undefined ? {} : { action: trigger.action }),
    ...(trigger.instruction_policy === undefined
      ? {}
      : { instructionPolicy: trigger.instruction_policy }),
  };
}

function preserveTriggerConfiguration(
  desired: RoutineTriggerSpec[],
  current: z.infer<typeof UpstreamTriggerSchema>[],
): RoutineTriggerWrite[] {
  const currentById = new Map(current.map((trigger) => [trigger.id, trigger]));
  return desired.map((trigger) => {
    if (!trigger.id) return trigger;
    const existing = currentById.get(trigger.id);
    if (existing?.kind !== trigger.kind) return trigger;
    const common = {
      ...(existing.enabled === undefined ? {} : { enabled: existing.enabled }),
      ...(existing.metadata === undefined ? {} : { metadata: existing.metadata }),
    };
    if (trigger.kind === "schedule") return { ...trigger, ...common };
    if (
      existing.signal_provider_instance_id !== trigger.instanceId ||
      existing.signal_type !== trigger.signalType
    )
      return { ...trigger, ...common };
    return {
      ...trigger,
      ...common,
      ...(existing.session_policy === undefined ? {} : { sessionPolicy: existing.session_policy }),
      ...(existing.action === undefined ? {} : { action: existing.action }),
      ...(existing.instruction_policy === undefined
        ? {}
        : { instructionPolicy: existing.instruction_policy }),
    };
  });
}

function serializeSignalProvider(
  provider: z.infer<typeof UpstreamSignalProviderSchema>,
): SignalProvider {
  const signingKeyDescription =
    provider.webhook_verification?.signing_key_description ??
    provider.metadata?.signing_key_description;
  return {
    type_id: provider.type_id,
    name: provider.name ?? provider.type_id,
    documentation: provider.documentation ?? "",
    instructions: provider.instructions ?? "",
    auth_methods: provider.auth_methods ?? [],
    requires_signing_key: provider.webhook_verification?.requires_signing_key ?? false,
    signing_key_description:
      typeof signingKeyDescription === "string" ? signingKeyDescription : null,
    route_path: provider.route_descriptors?.[0]?.path ?? "",
    signal_types: (provider.signal_types ?? []).map((signalType) => ({
      type_id: signalType.type_id,
      name: signalType.name ?? signalType.type_id,
      documentation: signalType.documentation ?? "",
      categories: signalType.categories ?? [],
      default_session_key_template: signalType.default_session_key_template ?? "",
      default_session_title_template: signalType.default_session_title_template ?? null,
    })),
    credential_sources: (provider.credential_sources ?? []).map((source) => ({
      type_id: source.type_id,
      name: source.name ?? source.type_id,
      requires_brokering: source.requires_brokering ?? false,
      display_name_description: source.display_name_description ?? "",
    })),
    interpolation_variables: (provider.interpolation_variables ?? []).map((variable) => ({
      key: variable.key ?? "",
      description: variable.description ?? "",
      example: variable.example ?? "",
    })),
  };
}

function routePathsByProvider(
  providers: z.infer<typeof UpstreamSignalProviderSchema>[],
): Map<string, string> {
  return new Map(
    providers.flatMap((provider) => {
      const path = provider.route_descriptors?.[0]?.path;
      return path ? [[provider.type_id, path] as const] : [];
    }),
  );
}

function serializeSignalInstance(
  apiBaseUrl: string,
  instance: z.infer<typeof UpstreamSignalInstanceSchema>,
  routes: ReadonlyMap<string, string>,
): SignalInstance {
  const providerType = instance.signal_provider_source_type_id ?? "";
  const ingressMode = instance.ingress_mode ?? "webhook";
  const routePath = routes.get(providerType);
  return {
    id: instance.id,
    display_name: instance.display_name ?? instance.id,
    provider_type: providerType,
    status: instance.status ?? "enabled",
    ingress_mode: ingressMode,
    webhook_url:
      ingressMode === "webhook" && providerType && routePath
        ? `${apiBaseUrl}/api/v1/webhooks/${providerType}-signals-${instance.id}/${routePath}`
        : null,
    poll_interval_seconds: instance.poll_interval_seconds ?? null,
    last_error: instance.last_error ?? null,
    created_at: instance.created_at ?? "",
    updated_at: instance.updated_at ?? "",
  };
}

function withoutRedactedValues(configuration: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(configuration).filter(([, value]) => value !== "********"),
  );
}

function serializeSignalDelivery(
  delivery: z.infer<typeof UpstreamSignalDeliverySchema>,
): SignalDelivery {
  return {
    id: delivery.id,
    instance_id: delivery.signal_provider_instance_id ?? "",
    signal_type: delivery.signal_type ?? "",
    summary: delivery.summary ?? null,
    status: delivery.status ?? "pending",
    session_id: delivery.chatkit_session_id ?? null,
    error_message: delivery.error_message ?? null,
    matched_trigger_ids: delivery.matched_trigger_ids ?? delivery.matched_rule_ids ?? [],
    created_at: delivery.created_at ?? "",
  };
}
