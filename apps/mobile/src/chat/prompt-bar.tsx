import { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react-native";
import { Button } from "@/components/ui/button";
import { ScrollView } from "@/components/ui/scroll-view";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { SPACING } from "@/theme/globals";
import type { PendingNativeAttachment } from "./native-attachments";

export function MobilePromptBar({
  busy,
  composerSeed,
  error,
  files,
  submitting,
  onAttach,
  onFilesOnly,
  onRemoveFile,
  onStop,
}: {
  busy: boolean;
  composerSeed: { revision: number; text: string };
  error: string;
  files: readonly PendingNativeAttachment[];
  submitting: boolean;
  onAttach: () => void;
  onFilesOnly: () => void;
  onRemoveFile: (file: PendingNativeAttachment) => void;
  onStop: () => void;
}) {
  const surface = useColor("card");
  const border = useColor("border");
  const muted = useColor("textMuted");
  const destructive = useColor("destructive");
  const text = useColor("text");
  const aui = useAui();
  const composerEmpty = useAuiState((state) => state.composer.isEmpty);
  const hasContent = !composerEmpty || files.length > 0;

  useEffect(() => {
    if (composerSeed.revision > 0) aui.composer.setText(composerSeed.text);
  }, [aui, composerSeed]);

  return (
    <ComposerPrimitive.Root
      style={[styles.promptFrame, { backgroundColor: surface, borderColor: border }]}
    >
      {files.length ? (
        <ScrollView
          horizontal
          contentContainerStyle={styles.promptFiles}
          showsHorizontalScrollIndicator={false}
        >
          {files.map((file) => (
            <View key={file.id} style={[styles.promptFile, { borderColor: border }]}>
              <View style={styles.promptFileCopy}>
                <Text numberOfLines={1} variant="caption">
                  {file.name}
                </Text>
                <Text numberOfLines={1} variant="caption" style={{ color: muted }}>
                  {file.status === "uploading"
                    ? `${Math.round(file.progress * 100)}%`
                    : file.error || formatBytes(file.size)}
                </Text>
              </View>
              <Button
                label={`Remove ${file.name}`}
                size="icon"
                variant="ghost"
                onPress={() => onRemoveFile(file)}
              >
                ×
              </Button>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <ComposerPrimitive.Input
        accessibilityLabel="Message"
        multiline
        placeholderTextColor={muted}
        placeholder="Message your agent"
        submitMode="none"
        style={[styles.promptInput, { borderColor: border, color: text }]}
      />

      <View style={styles.promptToolbar}>
        <View style={styles.promptLeadingActions}>
          <Button
            disabled={submitting}
            label="Attach files"
            size="icon"
            variant="ghost"
            onPress={onAttach}
          >
            +
          </Button>
          <Text numberOfLines={1} variant="caption" style={[styles.promptStatus, { color: muted }]}>
            {error ||
              (busy
                ? "New prompts join the queue"
                : files.length
                  ? `${files.length} attached`
                  : "Ready")}
          </Text>
        </View>
        <View style={styles.promptTrailingActions}>
          {busy ? (
            <Button
              label="Stop current turn"
              size="icon"
              textStyle={{ color: destructive }}
              variant="ghost"
              onPress={onStop}
            >
              ■
            </Button>
          ) : null}
          {composerEmpty && files.length ? (
            <Pressable
              accessibilityLabel={busy ? "Queue attachments" : "Send attachments"}
              disabled={submitting}
              style={[styles.promptSend, { backgroundColor: text }, submitting && styles.disabled]}
              onPress={onFilesOnly}
            >
              <Text variant="subtitle" style={{ color: surface }}>
                ↑
              </Text>
            </Pressable>
          ) : (
            <ComposerPrimitive.Send
              accessibilityLabel={busy ? "Queue message" : "Send message"}
              disabled={!hasContent || submitting}
              style={[styles.promptSend, { backgroundColor: text }, submitting && styles.disabled]}
            >
              <Text variant="subtitle" style={{ color: surface }}>
                ↑
              </Text>
            </ComposerPrimitive.Send>
          )}
        </View>
      </View>
    </ComposerPrimitive.Root>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  promptFrame: {
    marginHorizontal: SPACING.sm,
    marginTop: SPACING.xs,
    borderWidth: 1,
    borderRadius: 18,
    padding: SPACING.sm,
    gap: SPACING.xs,
  },
  promptFiles: { gap: SPACING.sm, paddingBottom: SPACING.xs },
  promptFile: {
    width: 220,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingLeft: SPACING.sm,
  },
  promptFileCopy: { flex: 1 },
  promptInput: {
    width: "100%",
    minHeight: 56,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: 17,
    textAlignVertical: "top",
  },
  promptToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  promptLeadingActions: { flex: 1, flexDirection: "row", alignItems: "center" },
  promptTrailingActions: { flexDirection: "row", alignItems: "center" },
  promptStatus: { flex: 1 },
  promptSend: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.45 },
});
