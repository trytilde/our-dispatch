import { defineInstrumentation } from "@tryopenbot/configuration/instrumentation";

export default defineInstrumentation({
  async setup({ agentName }: { agentName: string }): Promise<void> {
    void agentName;
  },
});
