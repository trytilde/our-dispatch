import { useCallback, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { useExternalStoreRuntime } from "@assistant-ui/core/react";
import { getExternalStoreMessages } from "@assistant-ui/core";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  type AppendMessage,
  useAuiState,
} from "@assistant-ui/react-native";
import type { ChatMessage } from "@tryopenbot/client-runtime";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { SPACING } from "@/theme/globals";
import type { MobileOpenBotRuntime } from "@/runtime/openbot-runtime";
import { toAssistantMessage } from "./assistant-message";
import { MobileMessageParts } from "./message-parts";

export function MobileAssistantProvider({
  busy,
  children,
  messages,
  onSend,
}: {
  busy: boolean;
  children: ReactNode;
  messages: readonly ChatMessage[];
  onSend: (text: string) => Promise<void>;
}) {
  const handleNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter(
          (part): part is Extract<(typeof message.content)[number], { type: "text" }> =>
            part.type === "text",
        )
        .map((part) => part.text)
        .join("\n")
        .trim();
      await onSend(text);
    },
    [onSend],
  );
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: toAssistantMessage,
    // Tilde owns busy-turn queueing. Keeping assistant-ui's local run lane idle lets a
    // second submit reach OpenBot immediately, where the shared runtime queues it.
    isRunning: false,
    onNew: handleNew,
    extras: { openBotAgentBusy: busy },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

export function AssistantMessageList({
  loading,
  runtime,
}: {
  loading: boolean;
  runtime: MobileOpenBotRuntime;
}) {
  const muted = useColor("textMuted");
  if (loading)
    return (
      <View style={styles.emptyThread}>
        <Text variant="caption" style={{ color: muted }}>
          Loading conversation…
        </Text>
      </View>
    );

  return (
    <ThreadPrimitive.Root style={styles.threadRoot}>
      <ThreadPrimitive.MessagesFlatList
        autoScroll
        contentContainerStyle={styles.messageList}
        ListEmptyComponent={
          <View style={styles.emptyThread}>
            <Text variant="title">Start a conversation</Text>
            <Text variant="body" style={[styles.emptyThreadCopy, { color: muted }]}>
              Ask your agent to research, build, or inspect something.
            </Text>
          </View>
        }
      >
        {() => <AssistantMessageRow runtime={runtime} />}
      </ThreadPrimitive.MessagesFlatList>
    </ThreadPrimitive.Root>
  );
}

function AssistantMessageRow({ runtime }: { runtime: MobileOpenBotRuntime }) {
  const message = useAuiState(
    (state) => getExternalStoreMessages<ChatMessage>(state.message)[0] ?? null,
  );
  const role = useAuiState((state) => state.message.role);
  const owner = role === "user";
  const card = useColor("card");
  const primary = useColor("primary");
  const primaryForeground = useColor("primaryForeground");
  if (!message) return null;

  return (
    <MessagePrimitive.Root style={[styles.messageRow, owner && styles.ownerMessageRow]}>
      <View
        style={[
          styles.messageBubble,
          { backgroundColor: owner ? primary : card },
          owner ? styles.ownerBubble : styles.agentBubble,
        ]}
      >
        <MobileMessageParts
          message={message}
          runtime={runtime}
          textColor={owner ? primaryForeground : undefined}
        />
      </View>
    </MessagePrimitive.Root>
  );
}

const styles = StyleSheet.create({
  threadRoot: { flex: 1 },
  messageList: { flexGrow: 1, gap: SPACING.sm, padding: SPACING.md },
  emptyThread: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    padding: SPACING.xl,
  },
  emptyThreadCopy: { textAlign: "center" },
  messageRow: { flexDirection: "row", justifyContent: "flex-start" },
  ownerMessageRow: { justifyContent: "flex-end" },
  messageBubble: {
    maxWidth: "86%",
    borderRadius: 18,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  agentBubble: { borderBottomLeftRadius: SPACING.xs },
  ownerBubble: { borderBottomRightRadius: SPACING.xs },
});
