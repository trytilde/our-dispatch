import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  CHATKIT_COMPACTION_SUMMARY_PREFIX,
  chatKitCompactionCheckpointMessage,
  composeChatKitCompactionPrepareStep,
  createChatKitCompactionController,
  estimateModelMessagesTokens,
} from "../src/chatkit-compaction";

const model = {} as LanguageModel;

function prepareInput(messages: ModelMessage[]) {
  return {
    steps: [],
    stepNumber: 0,
    model,
    instructions: undefined,
    initialInstructions: undefined,
    messages,
    initialMessages: messages,
    responseMessages: [],
    toolsContext: undefined,
    runtimeContext: undefined,
  } as never;
}

describe("ChatKit compaction controller", () => {
  it("leaves context alone below the configured threshold", async () => {
    const reportCompaction = vi.fn();
    const controller = createChatKitCompactionController<ToolSet>({
      session: { reportCompaction },
      agentId: "factory",
      contextWindowTokens: 10_000,
      summarize: vi.fn(),
    });

    await expect(
      controller.prepareStep(prepareInput([{ role: "user", content: "hello" }])),
    ).resolves.toEqual({});
    expect(reportCompaction).not.toHaveBeenCalled();
  });

  it("reports a durable lifecycle and replaces old context with a final handoff", async () => {
    const reportCompaction = vi.fn(async () => ({ eventId: crypto.randomUUID() }));
    const summarize = vi.fn(async () => ({
      summary: "- Goal: finish the migration\n- Next: run focused tests",
      inputTokens: 91,
      outputTokens: 14,
    }));
    const messages: ModelMessage[] = [
      { role: "user", content: "old ".repeat(80) },
      { role: "assistant", content: "worked ".repeat(80) },
      { role: "user", content: "most recent request" },
    ];
    const controller = createChatKitCompactionController<ToolSet>({
      session: { reportCompaction },
      agentId: "factory",
      sourceMessageIds: ["old-user", "old-assistant", "recent-user"],
      contextWindowTokens: 100,
      compactedThroughMessageId: "boundary-message",
      triggerRatio: 0.5,
      retainedTokens: 10,
      summarize,
      createId: () => "6d9cb9c3-37a7-4f8a-85ad-3ad5cf52c185",
    });

    const result = await controller.prepareStep(prepareInput(messages));

    expect(summarize).toHaveBeenCalledOnce();
    expect(reportCompaction).toHaveBeenNthCalledWith(1, {
      agentId: "factory",
      compactionId: "6d9cb9c3-37a7-4f8a-85ad-3ad5cf52c185",
      lifecycle: expect.objectContaining({
        status: "started",
        inputMessageCount: 3,
        compactedThroughMessageId: "boundary-message",
      }),
    });
    expect(reportCompaction).toHaveBeenNthCalledWith(2, {
      agentId: "factory",
      compactionId: "6d9cb9c3-37a7-4f8a-85ad-3ad5cf52c185",
      lifecycle: {
        status: "ended",
        summary: "- Goal: finish the migration\n- Next: run focused tests",
        compactedMessageIds: ["old-user", "old-assistant"],
        retainedMessageIds: ["recent-user"],
        inputTokens: 91,
        outputTokens: 14,
      },
    });
    expect(result).toEqual({
      messages: [
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining(CHATKIT_COMPACTION_SUMMARY_PREFIX),
        }),
        { role: "user", content: "most recent request" },
      ],
    });
  });

  it("reduces summarization input and retries transient failures", async () => {
    const reportCompaction = vi.fn(async () => ({ eventId: crypto.randomUUID() }));
    const seenMessageCounts: number[] = [];
    const summarize = vi.fn(async ({ messages }: { messages: ModelMessage[] }) => {
      seenMessageCounts.push(messages.length);
      if (seenMessageCounts.length < 3) throw new Error("input too long");
      return { summary: "Recovered summary", inputTokens: 20, outputTokens: 3 };
    });
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${index} ${"x".repeat(80)}`,
    }));
    const controller = createChatKitCompactionController<ToolSet>({
      session: { reportCompaction },
      agentId: "factory",
      contextWindowTokens: 100,
      compactedThroughMessageId: "boundary-message",
      triggerRatio: 0.5,
      summaryAttempts: 3,
      summarize,
    });

    await controller.prepareStep(prepareInput(messages));

    expect(seenMessageCounts).toHaveLength(3);
    expect(seenMessageCounts[1]).toBeLessThan(seenMessageCounts[0]!);
    expect(seenMessageCounts[2]).toBeLessThan(seenMessageCounts[1]!);
    expect(reportCompaction).toHaveBeenLastCalledWith(
      expect.objectContaining({ lifecycle: expect.objectContaining({ status: "ended" }) }),
    );
  });

  it("reports failure and keeps the original transcript authoritative", async () => {
    const reportCompaction = vi.fn(async () => ({ eventId: crypto.randomUUID() }));
    const controller = createChatKitCompactionController<ToolSet>({
      session: { reportCompaction },
      agentId: "factory",
      contextWindowTokens: 100,
      compactedThroughMessageId: "boundary-message",
      triggerRatio: 0.5,
      summaryAttempts: 1,
      summarize: async () => {
        throw new Error("summarizer unavailable");
      },
      createId: () => "c5c3ae44-2a3b-4520-9733-b830b1da5b10",
    });
    const messages: ModelMessage[] = [{ role: "user", content: "x".repeat(1_000) }];

    await expect(controller.prepareStep(prepareInput(messages))).rejects.toThrow(
      "summarizer unavailable",
    );
    expect(reportCompaction).toHaveBeenLastCalledWith({
      agentId: "factory",
      compactionId: "c5c3ae44-2a3b-4520-9733-b830b1da5b10",
      lifecycle: {
        status: "failed",
        error: "summarizer unavailable",
        retryable: true,
      },
    });
  });

  it("accounts for serialized structured content", () => {
    expect(
      estimateModelMessagesTokens([
        {
          role: "assistant",
          content: [{ type: "text", text: "x".repeat(400) }],
        },
      ]),
    ).toBeGreaterThan(100);
  });

  it("retains from a user boundary without orphaning a tool trajectory", async () => {
    const reportCompaction = vi.fn(async () => ({ eventId: crypto.randomUUID() }));
    const messages: ModelMessage[] = [
      { role: "user", content: "old request" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "read_file",
            input: { path: "/tmp/a" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "read_file",
            output: { type: "text", value: "contents" },
          },
        ],
      },
      { role: "assistant", content: "The file says contents." },
      { role: "user", content: "new request" },
    ];
    const controller = createChatKitCompactionController<ToolSet>({
      session: { reportCompaction },
      agentId: "factory",
      contextWindowTokens: 100,
      compactedThroughMessageId: "boundary-message",
      triggerRatio: 0.5,
      retainedTokens: 1_000,
      summarize: async () => ({ summary: "handoff", inputTokens: 100, outputTokens: 2 }),
    });

    const result = await controller.prepareStep(prepareInput(messages));
    const replacement = result?.messages;

    expect(replacement?.slice(1)).toEqual(messages);
    expect(replacement?.[1]?.role).toBe("user");
  });

  it("composes provider preparation before compaction without dropping provider overrides", async () => {
    const providerModel = { modelId: "provider-model" } as LanguageModel;
    const providerMessages: ModelMessage[] = [{ role: "user", content: "provider context" }];
    const providerPrepare = vi.fn(async () => ({
      model: providerModel,
      messages: providerMessages,
      activeTools: ["read_file"],
      providerOptions: { openai: { cacheKey: "stable" } },
    }));
    const compactionPrepare = vi.fn(async (input: { messages: ModelMessage[] }) => ({
      messages: [{ role: "user" as const, content: `summary of ${input.messages.length}` }],
    }));
    const composed = composeChatKitCompactionPrepareStep<ToolSet>(
      providerPrepare as never,
      compactionPrepare as never,
    );

    const result = await composed(prepareInput([{ role: "user", content: "original" }]));

    expect(compactionPrepare).toHaveBeenCalledWith(
      expect.objectContaining({ model: providerModel, messages: providerMessages }),
    );
    expect(result).toEqual({
      model: providerModel,
      activeTools: ["read_file"],
      providerOptions: { openai: { cacheKey: "stable" } },
      messages: [{ role: "user", content: "summary of 1" }],
    });
  });

  it("reuses a byte-stable successful checkpoint on the next request without resummarizing", async () => {
    const firstReports: Array<{ lifecycle: { status: string; summary?: string } }> = [];
    const first = createChatKitCompactionController<ToolSet>({
      session: {
        async reportCompaction(input) {
          firstReports.push(input);
          return { eventId: crypto.randomUUID() };
        },
      },
      agentId: "factory",
      contextWindowTokens: 100,
      compactedThroughMessageId: "boundary-message",
      triggerRatio: 0.5,
      retainedTokens: 20,
      summarize: async () => ({
        summary: "Stable cross-request handoff",
        inputTokens: 100,
        outputTokens: 5,
      }),
      createId: () => "checkpoint-stable",
    });
    const firstResult = await first.prepareStep(
      prepareInput([
        { role: "user", content: "old ".repeat(100) },
        { role: "user", content: "latest" },
      ]),
    );
    const ended = firstReports.find((report) => report.lifecycle.status === "ended");
    expect(ended?.lifecycle.summary).toBe("Stable cross-request handoff");
    const restoredCheckpoint = chatKitCompactionCheckpointMessage({
      compactionId: "checkpoint-stable",
      summary: ended!.lifecycle.summary!,
    });
    expect(restoredCheckpoint).toEqual(firstResult?.messages?.[0]);

    const secondSummarize = vi.fn();
    const secondReport = vi.fn();
    const second = createChatKitCompactionController<ToolSet>({
      session: { reportCompaction: secondReport },
      agentId: "factory",
      contextWindowTokens: 10_000,
      summarize: secondSummarize,
    });
    const secondMessages = [
      restoredCheckpoint,
      { role: "user" as const, content: "latest" },
      { role: "user" as const, content: "append-only new message" },
    ];

    await expect(second.prepareStep(prepareInput(secondMessages))).resolves.toEqual({});
    expect(secondSummarize).not.toHaveBeenCalled();
    expect(secondReport).not.toHaveBeenCalled();
    expect(secondMessages[0]).toEqual(restoredCheckpoint);
  });
});
