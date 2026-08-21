import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { configHeaders, type Client, type JsonObject } from "@trytilde/harness-sdk";
import type {
  ChatKitEndpointContext,
  ChatKitUiFilePart,
  ConvertToAiSdkCacheHandler,
  ConvertToAiSdkFileUploadHandler,
  ConvertToAiSdkHydrateHandler,
} from "@trytilde/harness-sdk-vercel-ai-node";
import type { UIMessage } from "ai";

/** Reference the browser can resolve through the control service's attachment routes. */
export interface UploadedMedia {
  attachment_id: string;
  media_type: string;
  filename: string;
}

export interface MediaUpload {
  bytes: Uint8Array;
  mediaType: string;
  filename: string;
}

/** Uploads tool-produced media and returns its ChatKit attachment reference. */
export type MediaUploader = (media: MediaUpload) => Promise<UploadedMedia>;

/** Downloads one session attachment as bytes without exposing an encoded payload to the model. */
export type MediaDownloader = (attachmentId: string) => Promise<MediaUpload>;

export interface TildeAttachmentTarget {
  /** Tilde API origin, for example `https://api.trytilde.ai`. */
  baseUrl: string;
  /** Headers carrying the agent's Tilde credential, org, and team. */
  headers: () => Headers | Promise<Headers>;
  teamId: string;
  /** ChatKit session the media belongs to; every attachment route is session-scoped. */
  sessionId: string;
  fetch?: typeof fetch;
}

/**
 * Uploads bytes as a ChatKit attachment using Tilde's three-step protocol: reserve the row and its
 * presigned destination, put the bytes where the reservation says, then mark the upload complete.
 * The reservation decides whether the bytes go straight to object storage or back through the API,
 * so the returned `upload_url` is always followed rather than assumed.
 */
export function createTildeMediaUploader(target: TildeAttachmentTarget): MediaUploader {
  const request = target.fetch ?? fetch;
  const origin = target.baseUrl.replace(/\/+$/, "");
  const session = `${origin}/api/v1/team/${encodeURIComponent(target.teamId)}/chatkit/session/${encodeURIComponent(target.sessionId)}`;

  return async ({ bytes, mediaType, filename }) => {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const headers = new Headers(await target.headers());

    const reservation = await request(`${session}/attachment/upload`, {
      method: "POST",
      headers: withContentType(headers, "application/json"),
      body: JSON.stringify({
        filename,
        media_type: mediaType,
        sha256,
        size_bytes: bytes.byteLength,
      }),
    });
    if (!reservation.ok)
      throw new Error(`Tilde rejected the attachment reservation (${reservation.status})`);
    const created = (await reservation.json()) as {
      attachment: { id: string };
      upload_headers?: Record<string, string>;
      upload_url: string;
    };

    const uploadHeaders = new Headers(created.upload_headers ?? {});
    if (!uploadHeaders.has("content-type")) uploadHeaders.set("content-type", mediaType);
    // A presigned object-store URL must not carry the Tilde credential; the API fallback must.
    const uploadUrl = new URL(created.upload_url, `${origin}/`);
    assertHttpUrl(uploadUrl);
    if (uploadUrl.origin === new URL(origin).origin)
      for (const [name, value] of headers) uploadHeaders.set(name, value);
    const upload = await request(uploadUrl, {
      method: "PUT",
      headers: uploadHeaders,
      body: Buffer.from(bytes),
    });
    if (!upload.ok) throw new Error(`Attachment upload failed (${upload.status})`);

    const completion = await request(
      `${session}/attachment/${encodeURIComponent(created.attachment.id)}/complete`,
      {
        method: "POST",
        headers: withContentType(headers, "application/json"),
        body: JSON.stringify({ sha256, size_bytes: bytes.byteLength }),
      },
    );
    if (!completion.ok) throw new Error(`Attachment completion failed (${completion.status})`);

    return { attachment_id: created.attachment.id, media_type: mediaType, filename };
  };
}

/** Resolve a Tilde attachment to raw bytes for a session-bound computer tool. */
export function createTildeMediaDownloader(
  client: Client,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): MediaDownloader {
  return async (attachmentId) => {
    const resolved = await client.chatkit.getAttachmentDownloadUrl({ sessionId, attachmentId });
    const downloadUrl = new URL(
      resolved.downloadUrl,
      `${client.config.baseUrl.replace(/\/+$/, "")}/`,
    );
    assertHttpUrl(downloadUrl);
    const apiOrigin = new URL(client.config.baseUrl).origin;
    const response = await fetchImpl(
      downloadUrl,
      downloadUrl.origin === apiOrigin ? { headers: configHeaders(client.config) } : {},
    );
    if (!response.ok) throw new Error(`Attachment download failed (${response.status})`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      filename: resolved.attachment.filename ?? `attachment-${attachmentId}`,
      mediaType:
        resolved.attachment.media_type ??
        response.headers.get("content-type") ??
        "application/octet-stream",
    };
  };
}

/**
 * Convert browser-supplied ChatKit attachments to fresh signed URLs for the model. File-bearing
 * messages deliberately bypass the converted-message cache: caching either inline bytes or an
 * expiring signed URL would make the representation unsafe to persist or invalid on a later turn.
 */
export function createTildeAttachmentMessageHandlers(
  client: Client,
  context: Pick<ChatKitEndpointContext, "sessionId">,
): {
  fileUpload: ConvertToAiSdkFileUploadHandler;
  onCacheMessage: ConvertToAiSdkCacheHandler;
  onHydrateMessage: ConvertToAiSdkHydrateHandler;
} {
  return {
    async fileUpload({ part }) {
      const attachmentId = chatKitAttachmentId(part);
      if (!attachmentId) throw new Error("ChatKit file part is missing its Tilde attachment ID");
      const resolved = await client.chatkit.getAttachmentDownloadUrl({
        sessionId: context.sessionId,
        attachmentId,
      });
      const url = new URL(resolved.downloadUrl, `${client.config.baseUrl.replace(/\/+$/, "")}/`);
      assertHttpUrl(url);
      return {
        type: "file",
        mediaType:
          part.media_type ??
          part.mediaType ??
          part.mimeType ??
          resolved.attachment.media_type ??
          "application/octet-stream",
        filename: part.filename ?? resolved.attachment.filename ?? undefined,
        url: url.toString(),
      };
    },
    onCacheMessage({ message, convertedMessage }) {
      if (message.type === "ui" && message.parts.some((part) => part.type === "file")) return null;
      return {
        chatKitMessageId: message.id,
        message: JSON.parse(JSON.stringify(convertedMessage)) as JsonObject,
      };
    },
    onHydrateMessage({ cachedAgentRepresentation }) {
      if (!isUiMessage(cachedAgentRepresentation) || containsInlineData(cachedAgentRepresentation))
        return null;
      if (
        cachedAgentRepresentation.parts.some((part) => isJsonObject(part) && part.type === "file")
      )
        return null;
      return cachedAgentRepresentation as unknown as UIMessage;
    },
  };
}

function isUiMessage(value: JsonObject): value is JsonObject & { parts: unknown[] } {
  return (
    typeof value.id === "string" &&
    (value.role === "system" || value.role === "user" || value.role === "assistant") &&
    Array.isArray(value.parts)
  );
}

function containsInlineData(value: unknown): boolean {
  if (typeof value === "string") return value.startsWith("data:");
  if (Array.isArray(value)) return value.some(containsInlineData);
  return isJsonObject(value) && Object.values(value).some(containsInlineData);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chatKitAttachmentId(part: ChatKitUiFilePart): string | undefined {
  return (
    part.attachment_id ??
    nestedString(part.provider_metadata, "chatkit", "attachmentId") ??
    nestedString(part.providerMetadata, "chatkit", "attachmentId") ??
    nestedString(part.provider_metadata, "chatkit", "id") ??
    nestedString(part.providerMetadata, "chatkit", "id")
  );
}

function nestedString(value: JsonObject | null | undefined, parent: string, key: string) {
  const nested = value?.[parent];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return undefined;
  const result = nested[key];
  return typeof result === "string" && result ? result : undefined;
}

function withContentType(headers: Headers, mediaType: string): Headers {
  const next = new Headers(headers);
  next.set("content-type", mediaType);
  return next;
}

function assertHttpUrl(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(`Unsupported Tilde attachment URL protocol: ${url.protocol}`);
}
