import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  type PrepareStepFunction,
  pruneMessages,
  type ToolSet,
} from "ai";
import type { ChatKitSessionClient } from "./handler";
import type { ChatKitCompactionCheckpoint } from "@trytilde/sdk";

const APPROXIMATE_CHARS_PER_TOKEN = 4;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const DEFAULT_TRIGGER_RATIO = 0.8;
const DEFAULT_RETAINED_TOKENS = 10_000;
const DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS = 4_096;
const DEFAULT_SUMMARY_ATTEMPTS = 3;

export const CHATKIT_COMPACTION_SUMMARY_PREFIX =
  "Another language model previously worked on this conversation. Continue from the handoff below, trust the durable transcript and workspace over stale claims, inspect current state when needed, and do not repeat completed work.";

export const CHATKIT_COMPACTION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another language model that will resume the task.

Include:
- The user's current request and intended outcome
- Current progress and concrete work already completed
- Key decisions, constraints, permissions, and user preferences
- Important files, identifiers, tool results, errors, and unresolved state
- What remains to be done, in an executable order
- Critical evidence or references needed to continue without rereading the full transcript

Preserve exact values when they matter. Distinguish verified facts from assumptions. Do not claim unfinished work is complete. Do not make tool calls. Return only the concise, structured handoff summary.`;

export type ChatKitCompactionSummaryResult = {
  summary: string;
  inputTokens: number;
  outputTokens: number;
};

export type ChatKitCompactionSummarizer = (input: {
  model: LanguageModel;
  messages: ModelMessage[];
  maxOutputTokens: number;
}) => Promise<ChatKitCompactionSummaryResult>;

export type CreateChatKitCompactionControllerOptions = {
  session: Pick<ChatKitSessionClient, "reportCompaction">;
  agentId: string;
  /** Message IDs in exact one-to-one order with the ModelMessage array; omitted when conversion splits. */
  sourceMessageIds?: Array<string | null>;
  /** Last durable raw ChatKit message covered by the summarization input. */
  compactedThroughMessageId?: string;
  contextWindowTokens?: number;
  triggerRatio?: number;
  retainedTokens?: number;
  summaryMaxOutputTokens?: number;
  summaryAttempts?: number;
  summarize?: ChatKitCompactionSummarizer;
  createId?: () => string;
};

export type ChatKitCompactionController<TOOLS extends ToolSet> = {
  prepareStep: PrepareStepFunction<TOOLS>;
};

/** Compose provider preparation with compaction while preserving every non-context override. */
export function composeChatKitCompactionPrepareStep<TOOLS extends ToolSet>(
  providerPrepareStep: PrepareStepFunction<TOOLS> | undefined,
  compactionPrepareStep: PrepareStepFunction<TOOLS>,
): PrepareStepFunction<TOOLS> {
  return async (input) => {
    const providerResult = await providerPrepareStep?.(input);
    const preparedInput = providerResult
      ? {
          ...input,
          model: providerResult.model ?? input.model,
          messages: providerResult.messages ?? input.messages,
          instructions: providerResult.instructions ?? providerResult.system ?? input.instructions,
          toolsContext: providerResult.toolsContext ?? input.toolsContext,
          runtimeContext: providerResult.runtimeContext ?? input.runtimeContext,
        }
      : input;
    const compactionResult = await compactionPrepareStep(preparedInput);
    return {
      ...providerResult,
      ...compactionResult,
      messages: compactionResult?.messages ?? providerResult?.messages,
    };
  };
}

/**
 * Creates one request-scoped, provider-neutral context compaction controller.
 *
 * ChatKit records lifecycle only. The authored agent owns the threshold,
 * summarization model call, retained context, retry policy, and prepareStep wiring.
 */
export function createChatKitCompactionController<TOOLS extends ToolSet>(
  options: CreateChatKitCompactionControllerOptions,
): ChatKitCompactionController<TOOLS> {
  const contextWindowTokens = positiveInteger(
    options.contextWindowTokens,
    DEFAULT_CONTEXT_WINDOW_TOKENS,
  );
  const triggerRatio = ratio(options.triggerRatio, DEFAULT_TRIGGER_RATIO);
  const triggerTokens = Math.floor(contextWindowTokens * triggerRatio);
  const retainedTokens = positiveInteger(options.retainedTokens, DEFAULT_RETAINED_TOKENS);
  const summaryMaxOutputTokens = positiveInteger(
    options.summaryMaxOutputTokens,
    DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS,
  );
  const summaryAttempts = positiveInteger(options.summaryAttempts, DEFAULT_SUMMARY_ATTEMPTS);
  const summarize = options.summarize ?? summarizeWithModel;
  const createId = options.createId ?? (() => crypto.randomUUID());
  let compacting: Promise<ModelMessage[] | undefined> | undefined;
  let compacted = false;

  return {
    prepareStep: async ({ messages, model }) => {
      if (compacted) return {};
      const estimatedInputTokens = estimateModelMessagesTokens(messages);
      if (estimatedInputTokens < triggerTokens) return {};
      compacting ??= compactMessages({
        options,
        messages,
        model,
        estimatedInputTokens,
        retainedTokens,
        summaryMaxOutputTokens,
        summaryAttempts,
        summarize,
        createId,
      });
      const replacement = await compacting;
      if (replacement === undefined) return {};
      compacted = true;
      return { messages: replacement };
    },
  };
}

/** Recreate the byte-stable summary carrier stored by the latest successful checkpoint. */
export function chatKitCompactionCheckpointMessage(
  checkpoint: Pick<ChatKitCompactionCheckpoint, "compactionId" | "summary">,
): ModelMessage {
  return {
    role: "user",
    content: `${CHATKIT_COMPACTION_SUMMARY_PREFIX}\n\n${checkpoint.summary}`,
    providerOptions: {
      openbot: {
        compactionId: checkpoint.compactionId,
        isCompactionSummary: true,
      },
    },
  };
}

async function compactMessages(input: {
  options: CreateChatKitCompactionControllerOptions;
  messages: ModelMessage[];
  model: LanguageModel;
  estimatedInputTokens: number;
  retainedTokens: number;
  summaryMaxOutputTokens: number;
  summaryAttempts: number;
  summarize: ChatKitCompactionSummarizer;
  createId: () => string;
}): Promise<ModelMessage[]> {
  const compactionId = input.createId();
  if (!input.options.compactedThroughMessageId) {
    throw new Error("Compaction requires a durable ChatKit message boundary");
  }
  await input.options.session.reportCompaction({
    agentId: input.options.agentId,
    compactionId,
    lifecycle: {
      status: "started",
      inputMessageCount: input.messages.length,
      estimatedInputTokens: input.estimatedInputTokens,
      compactedThroughMessageId: input.options.compactedThroughMessageId,
    },
  });

  try {
    const summary = await summarizeWithRetries(input);
    if (!summary.summary.trim()) {
      throw new Error("Compaction produced an empty summary");
    }
    const retained = retainRecentCompleteTail(input.messages, input.retainedTokens);
    const summaryMessage = chatKitCompactionCheckpointMessage({
      compactionId,
      summary: summary.summary.trim(),
    });
    const replacement = [summaryMessage, ...retained.messages];
    const alignedMessageIds =
      input.options.sourceMessageIds?.length === input.messages.length
        ? input.options.sourceMessageIds
        : undefined;
    const retainedMessageIds =
      alignedMessageIds?.slice(retained.startIndex).filter((id): id is string => id !== null) ?? [];
    const compactedMessageIds =
      alignedMessageIds?.slice(0, retained.startIndex).filter((id): id is string => id !== null) ??
      [];
    await input.options.session.reportCompaction({
      agentId: input.options.agentId,
      compactionId,
      lifecycle: {
        status: "ended",
        summary: summary.summary.trim(),
        compactedMessageIds,
        retainedMessageIds,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
      },
    });
    return replacement;
  } catch (error) {
    await input.options.session.reportCompaction({
      agentId: input.options.agentId,
      compactionId,
      lifecycle: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
      },
    });
    throw error;
  }
}

async function summarizeWithRetries(input: {
  messages: ModelMessage[];
  model: LanguageModel;
  summaryMaxOutputTokens: number;
  summaryAttempts: number;
  summarize: ChatKitCompactionSummarizer;
}): Promise<ChatKitCompactionSummaryResult> {
  let messages = pruneMessages({
    messages: input.messages,
    reasoning: "all",
    toolCalls: "before-last-3-messages",
  });
  let lastError: unknown;
  for (let attempt = 1; attempt <= input.summaryAttempts; attempt += 1) {
    try {
      return await input.summarize({
        model: input.model,
        messages,
        maxOutputTokens: input.summaryMaxOutputTokens,
      });
    } catch (error) {
      lastError = error;
      if (attempt < input.summaryAttempts) {
        messages = reduceSummaryInput(messages);
      }
    }
  }
  throw lastError ?? new Error("Compaction summary failed");
}

async function summarizeWithModel(input: {
  model: LanguageModel;
  messages: ModelMessage[];
  maxOutputTokens: number;
}): Promise<ChatKitCompactionSummaryResult> {
  const result = await generateText({
    model: input.model,
    instructions: CHATKIT_COMPACTION_PROMPT,
    messages: input.messages,
    maxOutputTokens: input.maxOutputTokens,
    maxRetries: 2,
  });
  return {
    summary: result.text,
    inputTokens: result.usage.inputTokens ?? estimateModelMessagesTokens(input.messages),
    outputTokens: result.usage.outputTokens ?? Math.ceil(result.text.length / 4),
  };
}

/** Estimate persisted context before the first step, where AI SDK step usage is unavailable. */
export function estimateModelMessagesTokens(messages: ModelMessage[]): number {
  const serialized = JSON.stringify(messages);
  return Math.ceil(serialized.length / APPROXIMATE_CHARS_PER_TOKEN) + messages.length * 4;
}

function retainRecentCompleteTail(
  messages: ModelMessage[],
  maxTokens: number,
): { messages: ModelMessage[]; startIndex: number } {
  if (messages.length === 0) return { messages: [], startIndex: 0 };
  let start = messages.length;
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const tokens = estimateModelMessagesTokens([messages[index]!]);
    if (start < messages.length && used + tokens > maxTokens) break;
    start = index;
    used += tokens;
  }
  while (start < messages.length && messages[start]?.role !== "user") {
    start += 1;
  }
  return { messages: messages.slice(start), startIndex: start };
}

function reduceSummaryInput(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= 2) return messages;
  let start = Math.floor(messages.length / 2);
  while (start < messages.length && messages[start]?.role === "tool") {
    start += 1;
  }
  return messages.slice(start);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function ratio(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 && value < 1 ? value : fallback;
}
