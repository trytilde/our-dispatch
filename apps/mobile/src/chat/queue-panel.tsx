import { StyleSheet } from "react-native";
import { queuedTurnText, type QueuedTurn } from "@tryopenbot/client-runtime";
import { Button } from "@/components/ui/button";
import { ScrollView } from "@/components/ui/scroll-view";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { SPACING } from "@/theme/globals";

export function MobileQueuePanel({
  turns,
  onEdit,
  onMove,
  onRemove,
  onRunNow,
}: {
  turns: readonly QueuedTurn[];
  onEdit: (turn: QueuedTurn) => void;
  onMove: (turn: QueuedTurn, position: number) => void;
  onRemove: (turn: QueuedTurn) => void;
  onRunNow: (turn: QueuedTurn) => void;
}) {
  const surface = useColor("card");
  const border = useColor("border");
  const muted = useColor("textMuted");
  if (!turns.length) return null;

  return (
    <View
      accessibilityLabel={`${turns.length} queued ${turns.length === 1 ? "prompt" : "prompts"}`}
      style={[styles.queueSurface, { backgroundColor: surface, borderColor: border }]}
    >
      <View style={styles.queueHeading}>
        <Text variant="subtitle">Prompt queue</Text>
        <Text variant="caption" style={{ color: muted }}>
          {turns.length}
        </Text>
      </View>
      <ScrollView style={styles.queueScroll}>
        {turns.map((turn, index) => (
          <View key={turn.id} style={[styles.queueRow, index > 0 && { borderTopColor: border }]}>
            <View style={styles.queueCopy}>
              <Text variant="caption" style={{ color: muted }}>
                NEXT {index + 1}
              </Text>
              <Text numberOfLines={2} variant="body">
                {queuedTurnText(turn)}
              </Text>
            </View>
            <View style={styles.queueActions}>
              <Button
                disabled={index === 0}
                label="Move prompt earlier"
                size="icon"
                variant="ghost"
                onPress={() => onMove(turn, turn.queue_position - 1)}
              >
                ↑
              </Button>
              <Button
                disabled={index === turns.length - 1}
                label="Move prompt later"
                size="icon"
                variant="ghost"
                onPress={() => onMove(turn, turn.queue_position + 1)}
              >
                ↓
              </Button>
              <Button
                label="Edit queued prompt"
                size="sm"
                variant="ghost"
                onPress={() => onEdit(turn)}
              >
                Edit
              </Button>
              <Button
                label="Run queued prompt now"
                size="sm"
                variant="secondary"
                onPress={() => onRunNow(turn)}
              >
                Run
              </Button>
              <Button
                label="Remove queued prompt"
                size="icon"
                variant="ghost"
                onPress={() => onRemove(turn)}
              >
                ×
              </Button>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  queueSurface: { borderTopWidth: 1, borderBottomWidth: 1 },
  queueScroll: { maxHeight: 260 },
  queueHeading: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
  },
  queueRow: { borderTopWidth: 1, padding: SPACING.sm, gap: SPACING.sm },
  queueCopy: { gap: 2, paddingHorizontal: SPACING.xs },
  queueActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
});
