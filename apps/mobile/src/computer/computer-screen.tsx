import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import type { ChatAgent } from "@tryopenbot/client-runtime";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { SPACING } from "@/theme/globals";
import type { MobileOpenBotRuntime } from "@/runtime/openbot-runtime";

export function ComputerScreen({
  agent,
  runtime,
  onBack,
}: {
  agent?: ChatAgent;
  runtime: MobileOpenBotRuntime;
  onBack: () => void;
}) {
  const [accessToken, setAccessToken] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState("");
  const [takingControl, setTakingControl] = useState(false);
  const background = useColor("background");
  const card = useColor("card");
  const border = useColor("border");
  const muted = useColor("textMuted");
  const primary = useColor("primary");
  const primaryForeground = useColor("primaryForeground");
  const previewUri = useMemo(
    () =>
      agent ? `${runtime.controlOrigin}/api/computer/${encodeURIComponent(agent.id)}/preview` : "",
    [agent, runtime.controlOrigin],
  );

  useEffect(() => {
    let active = true;
    setAccessToken(undefined);
    setReady(false);
    setFailed("");
    setTakingControl(false);
    if (!agent) return;
    void runtime
      .getAccessToken()
      .then((token) => {
        if (!active) return;
        if (!token) setFailed("Sign in again to open this Computer.");
        else setAccessToken(token);
      })
      .catch(() => {
        if (active) setFailed("The Computer session could not be authorized.");
      });
    return () => {
      active = false;
    };
  }, [agent, revision, runtime]);

  return (
    <View style={[styles.computerCanvas, { backgroundColor: background }]}>
      <View style={styles.computerHeader}>
        <Button label="Back to conversation" size="sm" variant="ghost" onPress={onBack}>
          ‹ Chat
        </Button>
        <View style={styles.computerIdentity}>
          <Text numberOfLines={1} variant="subtitle">
            {agent?.display_name || "Computer"}
          </Text>
          <Text numberOfLines={1} variant="caption" style={{ color: muted }}>
            {failed ||
              (ready ? (takingControl ? "You have control" : "Live preview") : "Connecting…")}
          </Text>
        </View>
        {ready ? (
          <Button
            label={takingControl ? "Release Computer control" : "Take over Computer"}
            size="sm"
            variant={takingControl ? "secondary" : "default"}
            onPress={() => setTakingControl((current) => !current)}
          >
            {takingControl ? "Release" : "Take over"}
          </Button>
        ) : (
          <View style={styles.computerHeaderSpacer} />
        )}
      </View>

      <View style={[styles.computerFrame, { backgroundColor: card, borderColor: border }]}>
        {agent && accessToken ? (
          <WebView
            key={`${agent.id}-${revision}`}
            allowsFullscreenVideo
            cacheEnabled={false}
            originWhitelist={["http://*", "https://*"]}
            pointerEvents={takingControl ? "auto" : "none"}
            setSupportMultipleWindows={false}
            source={{ uri: previewUri, headers: { Authorization: `Bearer ${accessToken}` } }}
            style={styles.computerWebView}
            onError={() => {
              setReady(false);
              setFailed("The Computer preview is unavailable.");
            }}
            onHttpError={(event) => {
              setReady(false);
              setFailed(`The Computer preview returned ${event.nativeEvent.statusCode}.`);
            }}
            onLoadStart={() => {
              setReady(false);
              setFailed("");
            }}
            onLoadEnd={() => setReady(true)}
          />
        ) : null}

        {!ready ? (
          <View style={styles.computerPending}>
            {failed ? null : <Spinner />}
            <Text variant="subtitle">{failed ? "Computer unavailable" : "Opening Computer"}</Text>
            <Text variant="body" style={[styles.computerPendingCopy, { color: muted }]}>
              {failed || "Preparing a secure live view of the selected agent’s screen."}
            </Text>
            {failed && agent ? (
              <Button
                label="Retry Computer preview"
                variant="outline"
                onPress={() => setRevision((current) => current + 1)}
              >
                Retry
              </Button>
            ) : null}
          </View>
        ) : null}

        {ready && !takingControl ? (
          <Pressable
            accessibilityLabel="Take over Computer"
            accessibilityRole="button"
            style={[styles.computerGuard, { backgroundColor: primary }]}
            onPress={() => setTakingControl(true)}
          >
            <Text variant="caption" style={{ color: primaryForeground }}>
              LIVE COMPUTER
            </Text>
            <Text variant="subtitle" style={{ color: primaryForeground }}>
              Tap to take over
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  computerCanvas: { flex: 1 },
  computerHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.sm,
    gap: SPACING.xs,
  },
  computerIdentity: { flex: 1, alignItems: "center" },
  computerHeaderSpacer: { width: 92 },
  computerFrame: {
    flex: 1,
    margin: SPACING.sm,
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
  },
  computerWebView: { flex: 1, backgroundColor: "transparent" },
  computerPending: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    padding: SPACING.xl,
  },
  computerPendingCopy: { maxWidth: 320, textAlign: "center" },
  computerGuard: {
    position: "absolute",
    left: SPACING.md,
    right: SPACING.md,
    bottom: SPACING.md,
    alignItems: "center",
    gap: 2,
    borderRadius: 16,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
  },
});
