export interface AgentInstrumentationContext {
  agentName: string;
}

export interface AgentInstrumentation {
  setup?(context: AgentInstrumentationContext): void | Promise<void>;
}

/** Define a startup hook that runs before an agent endpoint module is imported. */
export function defineInstrumentation(instrumentation: AgentInstrumentation): AgentInstrumentation {
  return instrumentation;
}
