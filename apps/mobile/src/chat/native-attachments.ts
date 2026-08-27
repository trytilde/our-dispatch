import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File, UploadType } from "expo-file-system";
import type {
  Attachment,
  AttachmentCompletion,
  ChatPart,
  OpenBotClient,
} from "@tryopenbot/client-runtime";

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

export interface UploadedNativeAttachment {
  attachment: Attachment;
  completion: AttachmentCompletion;
}

export async function uploadNativeAttachments(
  client: OpenBotClient,
  sessionId: string,
  pendingFiles: PendingNativeAttachment[],
  onProgress: (index: number, progress: number) => void,
): Promise<UploadedNativeAttachment[]> {
  const files = pendingFiles.map((pending) => new File(pending.uri));
  const sha256Values = await Promise.all(
    files.map(async (file) => {
      const digest = await Crypto.digest(
        Crypto.CryptoDigestAlgorithm.SHA256,
        await file.arrayBuffer(),
      );
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }),
  );
  const created = await client.createAttachments(
    sessionId,
    pendingFiles.map((pending, index) => ({
      filename: pending.name,
      mediaType: pending.mediaType,
      sizeBytes: pending.size,
      sha256: sha256Values[index]!,
    })),
  );
  await Promise.all(
    created.map(async (upload, index) => {
      const pending = pendingFiles[index]!;
      const response = await files[index]!.upload(client.rewriteTildeUploadUrl(upload.upload_url), {
        headers: upload.upload_headers,
        httpMethod: "PUT",
        mimeType: pending.mediaType,
        uploadType: UploadType.BINARY_CONTENT,
        onProgress: ({ bytesSent, totalBytes }) => {
          if (totalBytes > 0) onProgress(index, bytesSent / totalBytes);
        },
      });
      if (response.status < 200 || response.status >= 300)
        throw new Error(`Attachment upload failed (${response.status})`);
    }),
  );
  return created.map((upload, index) => ({
    attachment: upload.attachment,
    completion: {
      attachmentId: upload.attachment.id,
      sizeBytes: pendingFiles[index]!.size,
      sha256: sha256Values[index],
    },
  }));
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
