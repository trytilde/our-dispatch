import { z } from "zod";

/**
 * Connector (Tilde tool-provider) configuration contracts shared by every
 * client surface. The agent's `configure_connector` tool emits a
 * `connector_selection` payload inside its tool output; clients render it as
 * an account picker and drive new-account setup through the control-service
 * `/api/connectors` routes so credentials never travel through the chat
 * transcript.
 */

export const CONNECTOR_SELECTION_TOOL_NAME = "configure_connector";

export const ConnectorAccountSchema = z
  .object({
    id: z.string().min(1),
    display_name: z.string(),
    status: z.string(),
    provider_type_id: z.string().optional(),
    credential_source_type_id: z.string().optional(),
  })
  .passthrough();
export type ConnectorAccount = z.infer<typeof ConnectorAccountSchema>;

export const ConnectorCredentialSourceSchema = z
  .object({
    type_id: z.string().min(1),
    name: z.string(),
    documentation: z.string().optional(),
    requires_brokering: z.boolean(),
    supports_auto_display_name: z.boolean().optional(),
    display_name_description: z.string().optional(),
    /** JSON Schemas straight from Tilde; rendered as credential forms. */
    resource_server_schema: z.unknown().optional(),
    user_credential_schema: z.unknown().optional(),
  })
  .passthrough();
export type ConnectorCredentialSource = z.infer<typeof ConnectorCredentialSourceSchema>;

export const ConnectorProviderSchema = z
  .object({
    type_id: z.string().min(1),
    name: z.string(),
    documentation: z.string().optional(),
    /** Provider branding straight from Tilde catalog metadata (https or data: URI). */
    icon_url: z.string().optional(),
    categories: z.array(z.string()).optional(),
    credential_sources: z.array(ConnectorCredentialSourceSchema),
  })
  .passthrough();
export type ConnectorProvider = z.infer<typeof ConnectorProviderSchema>;

export const ConnectorProviderPageSchema = z.object({
  items: z.array(ConnectorProviderSchema),
});
export const ConnectorAccountPageSchema = z.object({
  items: z.array(ConnectorAccountSchema),
});

/** Payload the agent's `configure_connector` tool embeds in its tool output. */
export const ConnectorSelectionSchema = z
  .object({
    provider_type_id: z.string().min(1),
    provider_name: z.string(),
    icon_url: z.string().optional(),
    prompt: z.string().optional(),
    accounts: z.array(ConnectorAccountSchema),
    credential_sources: z.array(ConnectorCredentialSourceSchema).optional(),
  })
  .passthrough();
export type ConnectorSelection = z.infer<typeof ConnectorSelectionSchema>;

export interface CreateConnectorAccountInput {
  providerTypeId: string;
  credentialSourceTypeId: string;
  displayName: string;
  resourceServerValues?: Record<string, unknown>;
  userCredentialValues?: Record<string, unknown>;
  returnUrl?: string;
}

export const CreateConnectorAccountResultSchema = z.object({
  status: z.enum(["created", "authorize"]),
  account: ConnectorAccountSchema,
  authorization_url: z.string().optional(),
});
export type CreateConnectorAccountResult = z.infer<typeof CreateConnectorAccountResultSchema>;

/**
 * Extract the agent's connector-selection payload from a chat message part.
 * Returns undefined for every part that is not a completed
 * `configure_connector` tool invocation.
 */
export function connectorSelectionFromPart(part: {
  type: string;
  tool_name?: string | undefined;
  toolName?: string | undefined;
  output?: unknown;
}): ConnectorSelection | undefined {
  const isTool =
    part.type === "tool" || part.type === "dynamic-tool" || part.type.startsWith("tool-");
  if (!isTool) return undefined;
  const name = part.tool_name ?? part.toolName ?? part.type.replace(/^tool-/, "");
  if (name !== CONNECTOR_SELECTION_TOOL_NAME) return undefined;
  const output = unwrapToolOutput(part.output);
  if (typeof output !== "object" || output === null) return undefined;
  const selection = (output as { connector_selection?: unknown }).connector_selection;
  const parsed = ConnectorSelectionSchema.safeParse(selection);
  return parsed.success ? parsed.data : undefined;
}

/** Tool outputs may arrive raw or wrapped in AI SDK `{type, value}` envelopes. */
function unwrapToolOutput(output: unknown): unknown {
  if (typeof output !== "object" || output === null) return output;
  const record = output as Record<string, unknown>;
  if (record.type === "json" && "value" in record) return record.value;
  if (
    typeof record.value === "object" &&
    record.value !== null &&
    !("connector_selection" in record)
  )
    return record.value;
  return output;
}

export interface ConnectorSetupField {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  multiline: boolean;
  description?: string;
}

/**
 * Flatten a Tilde credential JSON Schema into renderable form fields. Shared
 * by the web dialog and the native mobile sheet so both surfaces render the
 * same credential forms from the same provider metadata.
 */
export function connectorSetupFields(schema: unknown): ConnectorSetupField[] {
  const record = asRecordValue(schema);
  const properties = asRecordValue(record.properties);
  const required = new Set(
    Array.isArray(record.required) ? record.required.filter((key) => typeof key === "string") : [],
  );
  return Object.entries(properties).map(([key, definition]) => {
    const field = asRecordValue(definition);
    const description = typeof field.description === "string" ? field.description : "";
    return {
      key,
      label:
        typeof field.title === "string" && field.title
          ? field.title
          : key.replaceAll(/[_-]+/g, " ").replace(/^./, (first) => first.toUpperCase()),
      required: required.has(key),
      secret: field.format === "password" || /secret|token|password|api_key/i.test(key),
      multiline: field.type === "object" || field.type === "array",
      ...(description ? { description } : {}),
    };
  });
}

function asRecordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The universal OAuth return target served by the control service. Passing the
 * client kind lets the landing page bounce desktop flows to the openbot://
 * deep link while browser flows simply close the tab.
 */
export function connectorAuthorizedReturnUrl(
  origin: string,
  client: "web" | "electron" | "mobile",
): string {
  return `${origin.replace(/\/$/, "")}/connectors/authorized?client=${client}`;
}

export interface WaitForConnectorAccountOptions {
  providerTypeId: string;
  accountId: string;
  signal?: AbortSignal;
  /** Poll cadence; injectable for tests. */
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Poll the team's connector accounts until the brokered account becomes
 * active — the client-side half of the OAuth return: once Tilde flips the
 * instance status, the waiting dialog finishes the hand-back to the agent
 * without the user clicking anything. Resolves undefined on timeout or abort.
 */
export async function waitForConnectorAccountActive(
  client: {
    listConnectorAccounts(providerTypeId?: string): Promise<ConnectorAccount[]>;
  },
  options: WaitForConnectorAccountOptions,
): Promise<ConnectorAccount | undefined> {
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !options.signal?.aborted) {
    try {
      const accounts = await client.listConnectorAccounts(options.providerTypeId);
      const account = accounts.find((candidate) => candidate.id === options.accountId);
      if (account && account.status === "active") return account;
    } catch {
      // Transient control-service failures should not end the wait.
    }
    await sleep(intervalMs, options.signal);
  }
  return undefined;
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * The message a client sends back after the user picks an account. Plain text
 * so it round-trips through the standard ChatKit send-message route, but
 * structured enough for the agent to act without re-asking.
 */
export function connectorAccountSelectionMessage(
  selection: Pick<ConnectorSelection, "provider_type_id" | "provider_name">,
  account: Pick<ConnectorAccount, "id" | "display_name">,
): string {
  return [
    `I selected the "${account.display_name}" ${selection.provider_name} account for this bot.`,
    `Enable it now: tool_group_source_type_id=${selection.provider_type_id}, tool_group_instance_id=${account.id}.`,
  ].join(" ");
}

/** The message a client sends after creating a brand-new connector account. */
export function connectorAccountCreatedMessage(
  selection: Pick<ConnectorSelection, "provider_type_id" | "provider_name">,
  result: CreateConnectorAccountResult,
): string {
  const account = result.account;
  if (result.status === "authorize") {
    return [
      `I started authorizing a new ${selection.provider_name} account "${account.display_name}"`,
      `(tool_group_source_type_id=${selection.provider_type_id}, tool_group_instance_id=${account.id}).`,
      `Check its status and enable its tools for this bot once it is active.`,
    ].join(" ");
  }
  return [
    `I added a new ${selection.provider_name} account "${account.display_name}"`,
    `(tool_group_source_type_id=${selection.provider_type_id}, tool_group_instance_id=${account.id}).`,
    `Enable its tools for this bot now.`,
  ].join(" ");
}
