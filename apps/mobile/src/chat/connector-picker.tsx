import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import {
  connectorSelectionFromPart,
  type ChatPart,
  type ConnectorSelection,
} from "@tryopenbot/client-runtime";
import { Image } from "@/components/ui/image";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { SPACING } from "@/theme/globals";
import type { MobileOpenBotRuntime } from "@/runtime/openbot-runtime";
import { ConnectorSetupSheet } from "../connector-setup";

export function connectorSelectionForPart(part: ChatPart): ConnectorSelection | undefined {
  return connectorSelectionFromPart(part);
}

/**
 * Native rendering of the agent's connector account picker. Selecting an
 * account round-trips exactly like the web grid; adding a new account opens
 * the native credential setup sheet (API keys, custom schemas, and brokered
 * OAuth through the system browser).
 */
export function ConnectorSelectionPicker({
  selection,
  runtime,
}: {
  selection: ConnectorSelection;
  runtime: MobileOpenBotRuntime;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const muted = useColor("textMuted");
  const border = useColor("border");
  const background = useColor("background");
  const prompt =
    selection.prompt ??
    `Select which account to enable for this bot for ${selection.provider_name}`;

  const choose = (accountId: string) => {
    const agentId = runtime.store.getState().sidebar.selectedAgentId;
    void runtime.client.bindConnector(agentId, accountId);
  };

  if (setupOpen) {
    return (
      <ConnectorSetupSheet
        client={runtime.client}
        controlOrigin={runtime.controlOrigin}
        selection={selection}
        onClose={() => setSetupOpen(false)}
        onComplete={(accountId) => {
          setSetupOpen(false);
          choose(accountId);
        }}
      />
    );
  }

  return (
    <View style={styles.picker}>
      <Text variant="caption" style={{ color: muted }}>
        {prompt}
      </Text>
      <View style={styles.grid}>
        {selection.accounts.map((account) => (
          <Pressable
            accessibilityRole="button"
            key={account.id}
            onPress={() => choose(account.id)}
            style={({ pressed }) => [
              styles.card,
              { borderColor: border, backgroundColor: background },
              pressed && styles.cardPressed,
            ]}
          >
            <View style={[styles.glyph, { borderColor: border }]}>
              {selection.icon_url ? (
                <Image source={{ uri: selection.icon_url }} style={styles.glyphImage} />
              ) : (
                <Text variant="caption">{selection.provider_name.slice(0, 2).toUpperCase()}</Text>
              )}
            </View>
            <View style={styles.copy}>
              <Text numberOfLines={1} variant="caption">
                {selection.provider_name}
              </Text>
              <Text numberOfLines={1} variant="caption" style={{ color: muted }}>
                {account.display_name}
              </Text>
            </View>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => setSetupOpen(true)}
          style={({ pressed }) => [
            styles.card,
            { borderColor: border, backgroundColor: background },
            pressed && styles.cardPressed,
          ]}
        >
          <View style={[styles.glyph, { borderColor: border }]}>
            <Text variant="caption">+</Text>
          </View>
          <View style={styles.copy}>
            <Text numberOfLines={2} variant="caption">
              Add new {selection.provider_name} account
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

// Layout only; colors resolve through useColor above.
const styles = StyleSheet.create({
  picker: { gap: SPACING.sm, marginTop: SPACING.sm },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },
  card: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  cardPressed: { opacity: 0.7 },
  glyph: {
    width: 30,
    height: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  glyphImage: { width: 24, height: 24 },
  copy: { flex: 1, minWidth: 0 },
});
