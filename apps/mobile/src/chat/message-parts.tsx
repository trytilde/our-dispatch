import { useEffect, useMemo, useState } from "react";
import { Linking, Modal, Pressable, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import type { ChatMessage, ChatPart } from "@tryopenbot/client-runtime";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Image } from "@/components/ui/image";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { SPACING } from "@/theme/globals";
import type { MobileOpenBotRuntime } from "@/runtime/openbot-runtime";
import { ConnectorSelectionPicker, connectorSelectionForPart } from "./connector-picker";
import { projectActivityParts } from "./part-projection";

export function MobileMessageParts({
  message,
  runtime,
  textColor,
}: {
  message: ChatMessage;
  runtime: MobileOpenBotRuntime;
  textColor?: string;
}) {
  const parts = projectActivityParts(
    message.parts?.length
      ? message.parts
      : message.text
        ? ([{ type: "text", text: message.text }] satisfies ChatPart[])
        : [],
  );

  return (
    <View style={styles.partStack}>
      {parts.map((part, index) => (
        <MobileMessagePart
          key={part.tool_invocation_id || part.toolCallId || `${part.type}-${index}`}
          message={message}
          part={part}
          runtime={runtime}
          textColor={textColor}
        />
      ))}
    </View>
  );
}

function MobileMessagePart({
  message,
  part,
  runtime,
  textColor,
}: {
  message: ChatMessage;
  part: ChatPart;
  runtime: MobileOpenBotRuntime;
  textColor?: string;
}) {
  const muted = useColor("textMuted");
  const border = useColor("border");

  if (part.type === "file" || part.type === "image")
    return <MobileAttachment message={message} part={part} runtime={runtime} />;

  if (part.type === "reasoning")
    return (
      <View style={[styles.reasoningPart, { borderLeftColor: border }]}>
        <Text variant="caption" style={{ color: muted }}>
          {part.state === "streaming" ? "Thinking" : "Reasoning"}
        </Text>
        {part.text ? (
          <Text variant="body" style={textColor ? { color: textColor } : undefined}>
            {part.text}
          </Text>
        ) : null}
      </View>
    );

  const connectorSelection = connectorSelectionForPart(part);
  if (connectorSelection)
    return <ConnectorSelectionPicker runtime={runtime} selection={connectorSelection} />;

  if (part.type === "tool" || part.type.startsWith("tool-"))
    return (
      <Card style={styles.toolPart}>
        <Text variant="caption" style={{ color: muted }}>
          TOOL · {formatState(part.state)}
        </Text>
        <Text variant="subtitle">{humanize(part.tool_name || part.toolName || part.type)}</Text>
        {part.error_text || part.errorText ? (
          <Text variant="caption">{part.error_text || part.errorText}</Text>
        ) : null}
      </Card>
    );

  return part.text ? (
    <Text variant="body" style={textColor ? { color: textColor } : undefined}>
      {part.text}
    </Text>
  ) : null;
}

function MobileAttachment({
  message,
  part,
  runtime,
}: {
  message: ChatMessage;
  part: ChatPart;
  runtime: MobileOpenBotRuntime;
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const muted = useColor("textMuted");
  const border = useColor("border");
  const card = useColor("card");
  const mediaType =
    part.media_type ||
    part.mediaType ||
    (part.type === "image" ? "image/*" : "application/octet-stream");
  const attachmentId = part.attachment_id || part.attachmentId;
  const title = part.filename || (mediaType.startsWith("image/") ? "Image" : "Attachment");
  const directUrl = useMemo(
    () =>
      safeMobileUrl(part.url, runtime.controlOrigin, (value) =>
        runtime.client.rewriteTildeUrl(value),
      ),
    [part.url, runtime.client, runtime.controlOrigin],
  );

  useEffect(() => {
    let active = true;
    setError("");
    if (directUrl) {
      setResolvedUrl(directUrl);
      return;
    }
    if (!attachmentId) return;
    setLoading(true);
    void runtime.client
      .getAttachmentDownloadUrl(message.session_id, attachmentId)
      .then((url) => {
        if (active) setResolvedUrl(safeMobileUrl(url, runtime.controlOrigin, (value) => value));
      })
      .catch(() => {
        if (active) setError("Preview unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attachmentId, directUrl, message.session_id, runtime.client, runtime.controlOrigin]);

  return (
    <>
      <Pressable
        accessibilityLabel={`Open ${title}`}
        accessibilityRole="button"
        disabled={!resolvedUrl}
        style={({ pressed }) => [
          styles.attachmentCard,
          { backgroundColor: card, borderColor: border, opacity: pressed ? 0.72 : 1 },
        ]}
        onPress={() => setOpen(true)}
      >
        {mediaType.startsWith("image/") && resolvedUrl ? (
          <Image
            accessibilityLabel={title}
            contentFit="cover"
            height={150}
            source={{ uri: resolvedUrl }}
            width="100%"
          />
        ) : (
          <View style={styles.attachmentGlyph}>
            {loading ? <Spinner /> : <Text variant="title">{mediaGlyph(mediaType)}</Text>}
          </View>
        )}
        <View style={styles.attachmentCopy}>
          <Text numberOfLines={1} variant="subtitle">
            {title}
          </Text>
          <Text numberOfLines={1} variant="caption" style={{ color: muted }}>
            {error || mediaType}
          </Text>
        </View>
      </Pressable>
      <MediaModal
        mediaType={mediaType}
        open={open}
        title={title}
        url={resolvedUrl}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function MediaModal({
  open,
  title,
  url,
  mediaType,
  onClose,
}: {
  open: boolean;
  title: string;
  url?: string;
  mediaType: string;
  onClose: () => void;
}) {
  const background = useColor("background");
  const muted = useColor("textMuted");
  if (!url) return null;
  const embeddable = mediaType.startsWith("video/") || mediaType.startsWith("audio/");
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={open}
    >
      <View style={[styles.mediaCanvas, { backgroundColor: background }]}>
        <View style={styles.mediaHeader}>
          <View style={styles.mediaHeading}>
            <Text numberOfLines={1} variant="subtitle">
              {title}
            </Text>
            <Text numberOfLines={1} variant="caption" style={{ color: muted }}>
              {mediaType}
            </Text>
          </View>
          <Button label="Close media preview" size="sm" variant="ghost" onPress={onClose}>
            Done
          </Button>
        </View>
        {mediaType.startsWith("image/") ? (
          <Image
            accessibilityLabel={title}
            contentFit="contain"
            source={{ uri: url }}
            style={styles.mediaImage}
          />
        ) : embeddable ? (
          <WebView
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction
            source={{ html: mediaDocument(url, mediaType, background) }}
            style={styles.mediaWebView}
          />
        ) : (
          <View style={styles.documentActions}>
            <Text variant="title">Open this file in another app?</Text>
            <Text variant="body" style={[styles.documentCopy, { color: muted }]}>
              OpenBot keeps the signed download URL out of the transcript and hands it directly to
              your device.
            </Text>
            <Button label={`Open ${title}`} onPress={() => void Linking.openURL(url)}>
              Open file
            </Button>
          </View>
        )}
      </View>
    </Modal>
  );
}

function safeMobileUrl(
  value: string | undefined,
  controlOrigin: string,
  rewrite: (value: string) => string,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(rewrite(value), controlOrigin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function mediaDocument(url: string, mediaType: string, background: string): string {
  const tag = mediaType.startsWith("video/") ? "video" : "audio";
  const safeUrl = JSON.stringify(url).slice(1, -1).replaceAll("<", "\\u003c");
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{height:100%;margin:0;background:${background};display:grid;place-items:center}${tag}{width:100%;max-height:100%}</style><${tag} controls playsinline src="${safeUrl}"></${tag}>`;
}

function mediaGlyph(mediaType: string): string {
  if (mediaType.startsWith("video/")) return "▶";
  if (mediaType.startsWith("audio/")) return "♪";
  return "↗";
}

function humanize(value: string): string {
  const spaced = value
    .replace(/^tool-/, "")
    .replaceAll(/[_-]+/g, " ")
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "Tool";
}

function formatState(value?: string | null): string {
  return value ? humanize(value) : "Complete";
}

const styles = StyleSheet.create({
  partStack: { gap: SPACING.sm },
  reasoningPart: { borderLeftWidth: 2, gap: SPACING.xs, paddingLeft: SPACING.sm },
  toolPart: { gap: SPACING.xs, padding: SPACING.md },
  attachmentCard: { borderWidth: 1, borderRadius: 18, overflow: "hidden" },
  attachmentGlyph: { minHeight: 92, alignItems: "center", justifyContent: "center" },
  attachmentCopy: { gap: 2, padding: SPACING.sm },
  mediaCanvas: { flex: 1 },
  mediaHeader: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  mediaHeading: { flex: 1 },
  mediaImage: { flex: 1, width: "100%", height: "100%" },
  mediaWebView: { flex: 1, backgroundColor: "transparent" },
  documentActions: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.md,
    padding: SPACING.xl,
  },
  documentCopy: { maxWidth: 380, textAlign: "center" },
});
