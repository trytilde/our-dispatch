import type { Tool } from "@ai-sdk/provider-utils";
import { isRecord } from "@tryopenbot/utilities/json";
import { tool } from "ai";
import { z } from "zod";

type ResolvableValue = string | (() => string | Promise<string>);

/**
 * Binds the connector-configuration tool to one Tilde team. The agent's own
 * Tilde API key authorizes the catalog and account reads; credential values
 * never pass through this tool — new-account setup happens in the owner's
 * client against the control service.
 */
export interface ConnectorToolOptions {
  apiKey: ResolvableValue;
  orgId?: ResolvableValue;
  teamId?: ResolvableValue;
  baseUrl?: ResolvableValue;
  fetch?: typeof globalThis.fetch;
}

const defaultBaseUrl = "https://api.trytilde.ai";

async function resolveValue(
  value: ResolvableValue | undefined,
  environmentName: string,
  fallback?: string,
): Promise<string> {
  if (value !== undefined) return typeof value === "function" ? value() : value;
  const environmentValue = process.env[environmentName]?.trim();
  if (environmentValue) return environmentValue;
  if (fallback !== undefined) return fallback;
  throw new Error(`${environmentName} is required for connector tools`);
}

interface TildeContext {
  apiKey: string;
  orgId: string;
  teamId: string;
  baseUrl: string;
  fetch: typeof globalThis.fetch;
}

async function tildeContext(options: ConnectorToolOptions): Promise<TildeContext> {
  return {
    apiKey: await resolveValue(options.apiKey, "TILDE_API_KEY"),
    orgId: await resolveValue(options.orgId, "TILDE_ORG_ID"),
    teamId: await resolveValue(options.teamId, "TILDE_TEAM_ID"),
    baseUrl: await resolveValue(options.baseUrl, "TILDE_BASE_URL", defaultBaseUrl),
    fetch: options.fetch ?? globalThis.fetch,
  };
}

async function tildeGet(context: TildeContext, teamPath: string): Promise<unknown> {
  const url = new URL(
    `/api/v1/team/${encodeURIComponent(context.teamId)}${teamPath}`,
    context.baseUrl,
  );
  const response = await context.fetch(url, {
    headers: {
      accept: "application/json",
      "x-api-key": context.apiKey,
      "x-tilde-org-id": context.orgId,
      "x-tilde-team-id": context.teamId,
    },
  });
  if (!response.ok) throw new Error(`Tilde request failed (${response.status}): ${teamPath}`);
  return await response.json();
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function setupFieldsSchema(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const fields = value.filter(isRecord);
  return {
    type: "object",
    properties: Object.fromEntries(
      fields.map((field) => [
        asText(field.name),
        {
          type: "string",
          title: asText(field.label) || asText(field.name),
          ...(asText(field.help_text) ? { description: asText(field.help_text) } : {}),
          ...(asText(field.field_type) === "password" ? { format: "password" } : {}),
        },
      ]),
    ),
    required: fields.filter((field) => field.required === true).map((field) => asText(field.name)),
  };
}

const cardShownNote = [
  "The client renders an account picker from this result.",
  "Point the user at it in one sentence, wrap up anything else in flight, and stop — their choice arrives as the next user message.",
  "Do not paste authorization links and do not request credential values in chat while the selection is pending.",
].join(" ");

/**
 * In-chat connector account selection. Lists the team's enabled accounts for
 * one Tilde tool provider and emits a `connector_selection` payload that the
 * OpenBot clients render as an interactive account-picker card.
 */
export function createConfigureConnectorTool(options: ConnectorToolOptions): Tool {
  return tool({
    description: [
      "Show the user an in-chat account picker for one connector (Tilde tool provider), so they can choose which account to enable for this bot or add a new one.",
      "Use it when a task needs a provider (for example google_mail) whose tools are not on your MCP server yet, after confirming the provider exists with tilde_search_available_capabilities.",
      "The client renders the picker from this tool's result: after calling it, give a one-sentence reason and stop your turn.",
      "Skip it for providers already fully connected to this bot, and never ask the user to type credentials in chat.",
    ].join(" "),
    inputSchema: z.object({
      provider_type_id: z
        .string()
        .min(1)
        .describe(
          'The Tilde tool_group_source_type_id, e.g. "google_mail". Discover it with tilde_search_available_capabilities first; never guess.',
        ),
      prompt: z
        .string()
        .optional()
        .describe("Optional one-line reason shown above the picker, e.g. what the task needs."),
    }),
    execute: async (input) => {
      const context = await tildeContext(options);
      const catalog = await tildeGet(context, "/provider-setup/catalog?domain=mcp");
      const catalogRecord = isRecord(catalog) ? catalog : {};
      const providers = Array.isArray(catalogRecord.providers)
        ? catalogRecord.providers.filter(isRecord)
        : [];
      const provider =
        providers.find((candidate) => asText(candidate.provider_id) === input.provider_type_id) ??
        providers.find(
          (candidate) =>
            asText(candidate.display_name).toLowerCase() === input.provider_type_id.toLowerCase(),
        );
      if (!provider) {
        return {
          status: "unknown_provider",
          instructions:
            "No Tilde tool provider matches that provider_type_id. Search the catalog with tilde_search_available_capabilities and retry with the exact type_id, or tell the user the service has no connector.",
          known_provider_type_ids: providers.map((candidate) => asText(candidate.provider_id)),
        };
      }
      const providerTypeId = asText(provider.provider_id);
      const providerName = asText(provider.display_name) || providerTypeId;
      const accounts = (
        Array.isArray(catalogRecord.resources) ? catalogRecord.resources.filter(isRecord) : []
      ).filter((account) => asText(account.tool_group_source_type_id) === providerTypeId);
      const credentialSources = Array.isArray(provider.auth_methods)
        ? provider.auth_methods.filter(isRecord)
        : [];
      return {
        status: "selection_required",
        instructions: cardShownNote,
        connector_selection: {
          provider_type_id: providerTypeId,
          provider_name: providerName,
          ...(input.prompt ? { prompt: input.prompt } : {}),
          accounts: accounts.map((account) => ({
            id: asText(account.id),
            display_name: asText(account.display_name) || asText(account.id),
            status: asText(account.status) || "unknown",
            credential_source_type_id: asText(account.credential_source_type_id),
          })),
          credential_sources: credentialSources.map((source) => {
            return {
              type_id: asText(source.credential_source_type_id) || asText(source.id),
              name: asText(source.display_name) || asText(source.id),
              ...(asText(source.documentation)
                ? { documentation: asText(source.documentation) }
                : {}),
              requires_brokering: asText(source.setup_kind).includes("oauth"),
              supports_auto_display_name: false,
              resource_server_schema: setupFieldsSchema(source.fields),
              user_credential_schema: null,
            };
          }),
        },
      };
    },
  });
}
