import type { DeployableProvider } from "@tryopenbot/runtime-provider";

export interface InferenceAgentTemplateFile {
  /** Path relative to configuration/templates/agent. */
  path: string;
  /** Provider-owned Handlebars source copied into the fork-owned template. */
  source: string;
}

export interface InferenceAgentTemplate {
  files: readonly InferenceAgentTemplateFile[];
}

/**
 * Inference account lifecycle plus provider-owned defaults for newly authored
 * agents. Generated agent code imports vendor SDKs directly.
 */
export interface InferenceProvider extends DeployableProvider {
  readonly agentTemplate: InferenceAgentTemplate;
}
