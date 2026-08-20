import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File, UploadType } from "expo-file-system";
import type { Attachment, ChatPart, OpenBotClient } from "@tryopenbot/client-runtime";

export interface PendingNativeAttachment {
  id: string;
  name: string;
  uri: string;
  mediaType: string;
  size: number;
  progress: number;
  status: "ready" | "uploading" | "uploaded" | "error";
  attachmentId?: string;
  error?: string;
}

export async function pickNativeAttachments(): Promise<PendingNativeAttachment[]> {
  const selection = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: "*/*",
  });
  if (selection.canceled) return [];
  return selection.assets.slice(0, 10).map((asset) => ({
    id: Crypto.randomUUID(),
    name: asset.name,
    uri: asset.uri,
    mediaType: asset.mimeType || "application/octet-stream",
    size: asset.size ?? new File(asset.uri).size,
    progress: 0,
    status: "ready",
  }));
}

export async function uploadNativeAttachment(
  client: OpenBotClient,
  sessionId: string,
  pending: PendingNativeAttachment,
  onProgress: (progress: number) => void,
): Promise<Attachment> {
  const file = new File(pending.uri);
  const bytes = await file.arrayBuffer();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const created = await client.createAttachment(sessionId, {
    filename: pending.name,
    mediaType: pending.mediaType,
    sizeBytes: pending.size,
    sha256,
  });
  const response = await file.upload(client.rewriteTildeUploadUrl(created.upload_url), {
    headers: created.upload_headers,
    httpMethod: "PUT",
    mimeType: pending.mediaType,
    uploadType: UploadType.BINARY_CONTENT,
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) onProgress(bytesSent / totalBytes);
    },
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error(`Attachment upload failed (${response.status})`);
  return await client.completeAttachment(sessionId, created.attachment.id, {
    sizeBytes: pending.size,
    sha256,
  });
}

export function optimisticNativeParts(
  text: string,
  files: readonly PendingNativeAttachment[],
): ChatPart[] {
  return [
    ...(text ? [{ type: "text", text }] : []),
    ...files.map((file) => ({
      type: "file",
      filename: file.name,
      media_type: file.mediaType,
      size_bytes: file.size,
    })),
  ];
}
