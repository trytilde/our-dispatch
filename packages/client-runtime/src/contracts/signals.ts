import { z } from "zod";

/**
 * Signal provider management contracts shared by every client surface. The
 * control-service `/api/signals` routes project the Tilde signals catalog,
 * provider instances, and delivery history; signing secrets are write-only and
 * never echoed back.
 */

export const SignalTypeSchema = z
  .object({
    type_id: z.string().min(1),
    name: z.string(),
    documentation: z.string().optional(),
    categories: z.array(z.string()).optional(),
    default_session_key_template: z.string().nullable().optional(),
    default_session_title_template: z.string().nullable().optional(),
  })
  .passthrough();
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const SignalCredentialSourceSchema = z
  .object({
    type_id: z.string().min(1),
    name: z.string(),
    requires_brokering: z.boolean(),
    display_name_description: z.string().nullable().optional(),
  })
  .passthrough();
export type SignalCredentialSource = z.infer<typeof SignalCredentialSourceSchema>;

export const SignalInterpolationVariableSchema = z
  .object({
    key: z.string(),
    description: z.string().optional(),
    example: z.string().optional(),
  })
  .passthrough();
export type SignalInterpolationVariable = z.infer<typeof SignalInterpolationVariableSchema>;

export const SignalProviderSchema = z
  .object({
    type_id: z.string().min(1),
    name: z.string(),
    documentation: z.string().optional(),
    /** Setup markdown with `{{webhook_url}}` style placeholders. */
    instructions: z.string().optional(),
    auth_methods: z.array(z.string()).optional(),
    requires_signing_key: z.boolean(),
    signing_key_description: z.string().nullable().optional(),
    route_path: z.string().optional(),
    signal_types: z.array(SignalTypeSchema),
    credential_sources: z.array(SignalCredentialSourceSchema).optional(),
    interpolation_variables: z.array(SignalInterpolationVariableSchema).optional(),
  })
  .passthrough();
export type SignalProvider = z.infer<typeof SignalProviderSchema>;

export const SignalInstanceSchema = z
  .object({
    id: z.string().min(1),
    display_name: z.string(),
    provider_type: z.string(),
    status: z.string(),
    ingress_mode: z.string(),
    webhook_url: z.string().nullable().optional(),
    poll_interval_seconds: z.number().nullable().optional(),
    last_error: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();
export type SignalInstance = z.infer<typeof SignalInstanceSchema>;

export const SignalDeliverySchema = z
  .object({
    id: z.string().min(1),
    instance_id: z.string(),
    signal_type: z.string(),
    summary: z.string().nullable().optional(),
    status: z.string(),
    session_id: z.string().nullable().optional(),
    error_message: z.string().nullable().optional(),
    /** Rules this delivery fired; run history filters on it. */
    matched_rule_ids: z.array(z.string()).optional(),
    created_at: z.string(),
  })
  .passthrough();
export type SignalDelivery = z.infer<typeof SignalDeliverySchema>;

export const SignalProviderListSchema = z.object({ items: z.array(SignalProviderSchema) });
export const SignalInstanceListSchema = z.object({ items: z.array(SignalInstanceSchema) });
export const SignalDeliveryListSchema = z.object({ items: z.array(SignalDeliverySchema) });

export const TestSignalInstanceResultSchema = z.object({
  accepted: z.number(),
  delivery_ids: z.array(z.string()),
});
export type TestSignalInstanceResult = z.infer<typeof TestSignalInstanceResultSchema>;

export const DeleteSignalInstanceResultSchema = z.object({ deleted: z.boolean() });

export interface CreateSignalInstanceInput {
  providerType: string;
  displayName: string;
  signingSecret?: string;
  credentialSourceTypeId?: string;
  configuration?: Record<string, unknown>;
  ingressMode?: "webhook";
}

export interface UpdateSignalInstanceInput {
  displayName?: string;
  status?: "enabled" | "disabled";
  signingSecret?: string;
  configuration?: Record<string, unknown>;
}

export interface TestSignalInstanceInput {
  signalType?: string;
  summary?: string;
  data?: Record<string, unknown>;
}

export function signalProviderById(
  providers: SignalProvider[],
  typeId: string,
): SignalProvider | undefined {
  return providers.find((provider) => provider.type_id === typeId);
}
