import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

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

function withContentType(headers: Headers, mediaType: string): Headers {
  const next = new Headers(headers);
  next.set("content-type", mediaType);
  return next;
}
