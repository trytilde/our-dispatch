import type {
  AgentRun,
  AgentRunEffectReceipt,
  AgentRunStatus,
  AgentRunBudget,
  JsonValue,
} from "@trytilde/sdk";
import { describe, expect, it } from "vite-plus/test";
import {
  executeRunEffect,
  reactivateAgentRun,
  runAgentHostOnce,
  runAgentObjective,
  type AgentRunStore,
} from "../src/agent-run-controller";

class MemoryRunStore implements AgentRunStore {
  run?: AgentRun;
  receipts = new Map<string, AgentRunEffectReceipt>();
  leaseOwner?: string;

  async create(input: {
    sessionId: string;
    agentId: string;
    objective: string;
    goalId?: string;
    budget?: AgentRunBudget;
  }) {
    this.run ??= runFixture(input);
    return structuredClone(this.run);
  }

  async claim(input: { workerId: string }) {
    if (this.leaseOwner && this.leaseOwner !== input.workerId) return [];
    this.leaseOwner = input.workerId;
    this.run!.status = "active";
    return [structuredClone(this.run!)];
  }

  async appendStep(input: {
    continuation: number;
    toolCallCount: number;
    progressFingerprint?: string;
    responseFingerprint?: string;
    inputTokens: number;
    outputTokens: number;
    costMicrousd: number;
    elapsedMs: number;
  }) {
    const run = this.run!;
    run.stepCount += 1;
    run.continuationCount = Math.max(run.continuationCount, input.continuation);
    run.noProgressCount =
      input.toolCallCount === 0 && !input.progressFingerprint ? run.noProgressCount + 1 : 0;
    run.inputTokens += input.inputTokens;
    run.outputTokens += input.outputTokens;
    run.costMicrousd += input.costMicrousd;
    run.elapsedMs += input.elapsedMs;
    return structuredClone(run);
  }

  async transition(input: { status: AgentRunStatus; reason?: string; result?: JsonValue }) {
    Object.assign(this.run!, {
      status: input.status,
      error: input.reason,
      result: input.result,
      generation: this.run!.generation + 1,
    });
    this.leaseOwner = undefined;
    return structuredClone(this.run!);
  }

  async reactivate() {
    this.run!.status = "active";
    this.run!.noProgressCount = 0;
    return structuredClone(this.run!);
  }

  async getEffect(input: { toolName: string; inputFingerprint: string }) {
    return this.receipts.get(`${input.toolName}:${input.inputFingerprint}`);
  }

  async prepareEffect(input: {
    sessionId: string;
    agentId: string;
    runId: string;
    generation: number;
    workerId: string;
    stepId: string;
    toolCallId: string;
    toolName: string;
    inputFingerprint: string;
    idempotencyKey: string;
  }) {
    this.assertEffectLease(input.generation, input.workerId);
    const receipt: AgentRunEffectReceipt = {
      ...input,
      status: "planned",
      createdAt: new Date(0).toISOString(),
    };
    this.receipts.set(`${input.toolName}:${input.inputFingerprint}`, receipt);
    return receipt;
  }

  async finishEffect(input: {
    sessionId: string;
    agentId: string;
    runId: string;
    generation: number;
    workerId: string;
    stepId: string;
    toolCallId: string;
    toolName: string;
    inputFingerprint: string;
    idempotencyKey: string;
    status: "committed" | "uncertain";
    output?: JsonValue;
  }) {
    this.assertEffectLease(input.generation, input.workerId);
    const receipt: AgentRunEffectReceipt = {
      ...input,
      createdAt: new Date(0).toISOString(),
    };
    this.receipts.set(`${input.toolName}:${input.inputFingerprint}`, receipt);
    return receipt;
  }

  private assertEffectLease(generation: number, workerId: string): void {
    if (generation !== this.run?.generation || workerId !== this.leaseOwner)
      throw new Error("stale effect writer");
  }
}

describe("durable AgentRun controller", () => {
  it("continues a side-effecting objective beyond 30 steps across invocation boundaries", async () => {
    const store = new MemoryRunStore();
    let effects = 0;
    const executeTurn = async ({ run, stepId }: { run: AgentRun; stepId: string }) => {
      await executeRunEffect({
        store,
        sessionId: run.sessionId,
        agentId: run.agentId,
        runId: run.id,
        stepId,
        toolCallId: `call-${run.continuationCount + 1}`,
        toolName: "increment",
        args: { sequence: run.continuationCount + 1 },
        expectedGeneration: run.generation,
        workerId: store.leaseOwner!,
        async execute() {
          effects += 1;
          return { effects };
        },
      });
      const next = run.continuationCount + 1;
      return {
        toolCallCount: 1,
        progress: `step-${next}`,
        response: `working-${next}`,
        usage: { inputTokens: 10, outputTokens: 2, costMicrousd: 1, elapsedMs: 5 },
        objectiveComplete: next >= 35,
        result: next >= 35 ? { completed: true } : undefined,
      };
    };
    const base = {
      store,
      sessionId: "session",
      agentId: "factory",
      workerId: "worker-a",
      objective: "perform 35 durable effects",
      idempotencyKey: "message-1",
      maxContinuationsPerInvocation: 20,
      executeTurn,
    };

    const first = await runAgentObjective(base);
    expect(first.run.status).toBe("waiting");
    expect(first.run.stepCount).toBe(20);
    const second = await runAgentObjective({ ...base, workerId: "worker-b" });
    expect(second.run.status).toBe("completed");
    expect(second.run.stepCount).toBe(35);
    expect(effects).toBe(35);
  });

  it("reuses a persisted effect receipt after a crash without repeating the effect", async () => {
    const store = new MemoryRunStore();
    store.run = runFixture({ sessionId: "session", agentId: "factory", objective: "effect" });
    store.leaseOwner = "worker-uncertain";
    let externalEffects = 0;
    const call = () =>
      executeRunEffect({
        store,
        sessionId: "session",
        agentId: "factory",
        runId: store.run!.id,
        stepId: "1:1",
        toolCallId: "call-1",
        toolName: "charge-card",
        args: { invoice: "inv-1" },
        expectedGeneration: store.run!.generation,
        workerId: store.leaseOwner!,
        async execute(idempotencyKey) {
          externalEffects += 1;
          return { idempotencyKey, charged: true };
        },
      });

    const beforeCrash = await call();
    const afterRestart = await call();
    expect(afterRestart).toEqual(beforeCrash);
    expect(externalEffects).toBe(1);
  });

  it("marks a planned non-idempotent effect uncertain after restart and never repeats it", async () => {
    const store = new MemoryRunStore();
    store.run = runFixture({ sessionId: "session", agentId: "factory", objective: "effect" });
    store.leaseOwner = "worker-uncertain";
    let externalEffects = 0;
    const args = { invoice: "inv-uncertain" };
    const inputFingerprint = await sha(JSON.stringify(args));
    await store.prepareEffect({
      sessionId: "session",
      agentId: "factory",
      runId: store.run.id,
      generation: store.run.generation,
      workerId: "worker-uncertain",
      stepId: "1:1",
      toolCallId: "call-uncertain",
      toolName: "legacy-charge",
      inputFingerprint,
      idempotencyKey: `${store.run.id}:1:1:call-uncertain`,
    });
    externalEffects += 1; // process crashes after the external effect, before commit

    await expect(
      executeRunEffect({
        store,
        sessionId: "session",
        agentId: "factory",
        runId: store.run.id,
        stepId: "1:1",
        toolCallId: "call-uncertain",
        toolName: "legacy-charge",
        args,
        expectedGeneration: store.run.generation,
        workerId: store.leaseOwner!,
        async execute() {
          externalEffects += 1;
          return { charged: true };
        },
      }),
    ).rejects.toThrow("uncertain outcome");
    expect(externalEffects).toBe(1);
    expect([...store.receipts.values()][0]?.status).toBe("uncertain");
    expect(store.run.status).toBe("waiting");
  });

  it("pauses after three no-progress turns and reactivates on a new user message", async () => {
    const store = new MemoryRunStore();
    const result = await runAgentObjective({
      store,
      sessionId: "session",
      agentId: "factory",
      workerId: "worker",
      objective: "wait",
      idempotencyKey: "message-1",
      executeTurn: async () => ({
        toolCallCount: 0,
        usage: { inputTokens: 1, outputTokens: 1, costMicrousd: 0, elapsedMs: 1 },
      }),
    });
    expect(result.run.status).toBe("paused");
    expect(result.run.noProgressCount).toBe(3);
    const reactivated = await reactivateAgentRun(store, {
      sessionId: "session",
      agentId: "factory",
      runId: result.run.id,
    });
    expect(reactivated.status).toBe("active");
  });

  it("fails visibly at a configured token budget", async () => {
    const store = new MemoryRunStore();
    const result = await runAgentObjective({
      store,
      sessionId: "session",
      agentId: "factory",
      workerId: "worker",
      objective: "bounded",
      idempotencyKey: "message-1",
      budget: { maxInputTokens: 20 },
      executeTurn: async () => ({
        toolCallCount: 1,
        progress: crypto.randomUUID(),
        usage: { inputTokens: 10, outputTokens: 1, costMicrousd: 1, elapsedMs: 1 },
      }),
    });
    expect(result.run.status).toBe("failed");
    expect(result.run.error).toBe("max_input_tokens_exceeded");
    expect(result.run.stepCount).toBe(2);
  });

  it("allows only one concurrent lease winner", async () => {
    const store = new MemoryRunStore();
    await store.create({ sessionId: "session", agentId: "factory", objective: "lease" });
    const [first, second] = await Promise.all([
      store.claim({ workerId: "worker-a" }),
      store.claim({ workerId: "worker-b" }),
    ]);
    expect([first.length, second.length].sort((left, right) => left - right)).toEqual([0, 1]);
  });

  it("restarts a worker and completes a waiting run through a hidden continuation", async () => {
    const store = new MemoryRunStore();
    const first = await runAgentObjective({
      store,
      sessionId: "session",
      agentId: "factory",
      workerId: "service-before-restart",
      objective: "continue after restart",
      idempotencyKey: "message-restart",
      maxContinuationsPerInvocation: 1,
      executeTurn: async () => ({
        toolCallCount: 1,
        progress: "boundary reached",
        usage: { inputTokens: 1, outputTokens: 1, costMicrousd: 0, elapsedMs: 1 },
      }),
    });
    expect(first.run.status).toBe("waiting");
    let hiddenInvocations = 0;

    const claimed = await runAgentHostOnce({
      store,
      sessionId: "session",
      agentId: "factory",
      workerId: "service-after-restart",
      async handle(run) {
        hiddenInvocations += 1;
        await store.transition({ status: "completed", result: { resumedRunId: run.id } });
      },
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(first.run.id);
    expect(hiddenInvocations).toBe(1);
    expect(store.run?.status).toBe("completed");
  });

  it("does not overwrite a concurrent owner transition after a worker failure", async () => {
    const store = new MemoryRunStore();
    await store.create({
      sessionId: "session",
      agentId: "factory",
      objective: "respect owner transition",
    });

    await expect(
      runAgentHostOnce({
        store,
        sessionId: "session",
        agentId: "factory",
        workerId: "worker",
        async handle() {
          await store.transition({ status: "paused", reason: "owner paused" });
          throw new Error("worker failed after owner pause");
        },
      }),
    ).rejects.toThrow("worker failed after owner pause");

    expect(store.run?.status).toBe("paused");
  });
});

function runFixture(input: {
  sessionId: string;
  agentId: string;
  objective: string;
  goalId?: string;
  budget?: AgentRunBudget;
}): AgentRun {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    orgId: "org",
    teamId: "team",
    sessionId: input.sessionId,
    agentId: input.agentId,
    objective: input.objective,
    goalId: input.goalId,
    status: "active",
    budget: input.budget ?? {},
    stepCount: 0,
    continuationCount: 0,
    noProgressCount: 0,
    repeatedPatternCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    costMicrousd: 0,
    elapsedMs: 0,
    generation: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

async function sha(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
