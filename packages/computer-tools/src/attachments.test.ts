import type { Client } from "@trytilde/sdk";
import type { ChatKitMessage } from "@trytilde/sdk-vercel-ai-node";
import { describe, expect, it, vi } from "vite-plus/test";
import { createTildeAttachmentMessageHandlers, createTildeMediaDownloader } from "./attachments.js";

function clientWithAttachment(downloadUrl = "https://objects.example.test/signed-image") {
  const getAttachmentDownloadUrl = vi.fn(async () => ({
    attachment: {
      filename: "image.png",
      media_type: "image/png",
    },
    downloadUrl,
    expiresAt: "2026-08-20T12:00:00Z",
  }));
  const client = {
    config: { baseUrl: "https://api.trytilde.ai" },
    chatkit: { getAttachmentDownloadUrl },
  } as unknown as Client;
  return { client, getAttachmentDownloadUrl };
}

describe("Tilde attachment boundaries", () => {
  it("passes browser attachments to the model as signed URLs without downloading or encoding", async () => {
    const { client, getAttachmentDownloadUrl } = clientWithAttachment();
    const handlers = createTildeAttachmentMessageHandlers(client, { sessionId: "session-one" });

    const part = await handlers.fileUpload({
      message: { id: "message-one", role: "user", type: "ui", parts: [] },
      part: {
        type: "file",
        url: "/attachment/download-url",
        attachment_id: "attachment-one",
        media_type: "image/png",
        filename: "image.png",
      },
    });

    expect(getAttachmentDownloadUrl).toHaveBeenCalledWith({
      sessionId: "session-one",
      attachmentId: "attachment-one",
    });
    expect(part).toEqual({
      type: "file",
      mediaType: "image/png",
      filename: "image.png",
      url: "https://objects.example.test/signed-image",
    });
    expect(JSON.stringify(part)).not.toContain("data:");
  });

  it("never persists file representations in the converted-message cache", async () => {
    const { client } = clientWithAttachment();
    const { onCacheMessage } = createTildeAttachmentMessageHandlers(client, {
      sessionId: "session-one",
    });

    expect(
      await onCacheMessage({
        message: {
          id: "message-file",
          role: "user",
          type: "ui",
          parts: [{ type: "file", url: "/download", attachment_id: "attachment-one" }],
        },
        convertedMessage: {
          id: "message-file",
          role: "user",
          parts: [{ type: "file", mediaType: "image/png", url: "https://signed.test" }],
        },
      }),
    ).toBeNull();

    expect(
      await onCacheMessage({
        message: { id: "message-text", role: "user", type: "text", text: "hello" },
        convertedMessage: {
          id: "message-text",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
      }),
    ).toEqual({
      chatKitMessageId: "message-text",
      message: {
        id: "message-text",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
    });
  });

  it("rejects legacy cached file and inline-data representations", async () => {
    const { client } = clientWithAttachment();
    const { onHydrateMessage } = createTildeAttachmentMessageHandlers(client, {
      sessionId: "session-one",
    });
    const message: ChatKitMessage = {
      id: "message-file",
      role: "user",
      type: "ui",
      parts: [],
    };

    expect(
      await onHydrateMessage({
        message,
        cachedAgentRepresentation: {
          id: "message-file",
          role: "user",
          parts: [{ type: "file", mediaType: "image/png", url: "https://signed.test" }],
        },
      }),
    ).toBeNull();
    expect(
      await onHydrateMessage({
        message,
        cachedAgentRepresentation: {
          id: "message-file",
          role: "user",
          parts: [{ type: "text", text: "data:image/png;base64,discard-me" }],
        },
      }),
    ).toBeNull();
  });

  it("downloads attachment bytes without forwarding Tilde credentials to object storage", async () => {
    const { client } = clientWithAttachment();
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.headers).toBeUndefined();
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    });

    const media = await createTildeMediaDownloader(
      client,
      "session-one",
      fetchMock as typeof fetch,
    )("attachment-one");

    expect(media).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "image.png",
      mediaType: "image/png",
    });
  });
});
