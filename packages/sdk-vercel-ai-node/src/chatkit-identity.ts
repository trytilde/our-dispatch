import type { JsonObject, JsonValue } from "@trytilde/sdk";
import { isJsonObject } from "@trytilde/sdk/json";

/**
 * Address scheme behind a ChatKit identity.
 *
 * Mirrors `ChatKitIdentityKind` in tilde-api. `tilde_user` is a Tilde user with
 * no external address; `agent` is another ChatKit agent.
 */
export type ChatKitIdentityKind = "email" | "mobile_number" | "username" | "tilde_user" | "agent";

/**
 * Who sent a ChatKit message.
 *
 * Delivered as a structured field rather than only as a text prefix. An external
 * sender picks their own display name, so a prefix alone could be forged; this
 * block comes from Tilde's identity table and is the value to branch on.
 *
 * `tildeUserId` is present only when the identity is a *verified* Tilde
 * principal. Its absence means the sender proved nothing about who they are —
 * treat them as an anonymous participant, never as a user with permissions.
 */
export type ChatKitMessageIdentity = {
  identityId: string;
  kind: ChatKitIdentityKind;
  displayName: string;
  externalId?: string;
  providerId?: string;
  isAgent: boolean;
  tildeUserId?: string;
  /** Pre-rendered, sanitized `Display Name (qualifier)` label. */
  speakerLabel: string;
};

/**
 * Where the conversation an agent turn belongs to originated.
 *
 * Use it to tell the model that its reply leaves Tilde. An agent answering an
 * email otherwise writes as if it were in a chat window.
 */
export type ChatKitSessionContext = {
  sessionId: string;
  /** For example `chatkit.channel.github`. */
  providerId: string;
  /** Human-readable provider name for prompt text, for example `GitHub`. */
  providerDisplayName: string;
  /** Whether Tilde delivers this agent's reply back to that platform. */
  repliesRouteToProvider: boolean;
};

const IDENTITY_KINDS: readonly string[] = [
  "email",
  "mobile_number",
  "username",
  "tilde_user",
  "agent",
];

function optionalString(source: JsonObject, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parse the identity block off a wire message.
 *
 * Returns `undefined` rather than throwing for anything malformed: an
 * unattributable message is still a valid message, and failing the whole turn
 * over a speaker label would be a worse outcome than rendering it unattributed.
 */
export function parseChatKitMessageIdentity(
  value: JsonValue | undefined,
): ChatKitMessageIdentity | undefined {
  if (!isJsonObject(value)) return undefined;
  const identityId = optionalString(value, "identity_id") ?? optionalString(value, "identityId");
  const displayName = optionalString(value, "display_name") ?? optionalString(value, "displayName");
  const kind = optionalString(value, "kind");
  if (!identityId || !displayName || !kind || !IDENTITY_KINDS.includes(kind)) {
    return undefined;
  }
  const identity: ChatKitMessageIdentity = {
    identityId,
    kind: kind as ChatKitIdentityKind,
    displayName,
    isAgent: value.is_agent === true || value.isAgent === true,
    speakerLabel:
      optionalString(value, "speaker_label") ??
      optionalString(value, "speakerLabel") ??
      displayName,
  };
  const externalId = optionalString(value, "external_id") ?? optionalString(value, "externalId");
  if (externalId) identity.externalId = externalId;
  const providerId = optionalString(value, "provider_id") ?? optionalString(value, "providerId");
  if (providerId) identity.providerId = providerId;
  const tildeUserId =
    optionalString(value, "tilde_user_id") ?? optionalString(value, "tildeUserId");
  if (tildeUserId) identity.tildeUserId = tildeUserId;
  return identity;
}

/** Parse the session provenance block off a wire request body. */
export function parseChatKitSessionContext(
  value: JsonValue | undefined,
): ChatKitSessionContext | undefined {
  if (!isJsonObject(value)) return undefined;
  const sessionId = optionalString(value, "session_id") ?? optionalString(value, "sessionId");
  const providerId = optionalString(value, "provider_id") ?? optionalString(value, "providerId");
  if (!sessionId || !providerId) return undefined;
  return {
    sessionId,
    providerId,
    providerDisplayName:
      optionalString(value, "provider_display_name") ??
      optionalString(value, "providerDisplayName") ??
      providerId,
    repliesRouteToProvider:
      value.replies_route_to_provider === true || value.repliesRouteToProvider === true,
  };
}

/** Maximum characters of a speaker label rendered into message text. */
const SPEAKER_LABEL_MAX_LENGTH = 160;

/**
 * Render the `Speaker: ` prefix for an inbound message.
 *
 * The label is re-sanitized here even though tilde-api already sanitized it.
 * The prefix is concatenated into model-visible text, so a display name that
 * slipped through carrying a newline or a colon could fake an extra transcript
 * turn. Defending on both sides costs nothing and removes the assumption that
 * the two repos stay in lockstep.
 */
export function formatSpeakerPrefix(identity: ChatKitMessageIdentity): string {
  const label = identity.speakerLabel
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/:/g, "∶")
    .trim()
    .slice(0, SPEAKER_LABEL_MAX_LENGTH);
  return label.length > 0 ? `${label}: ` : "";
}

/**
 * Prepend the speaker to a message's text.
 *
 * Idempotent for an empty label, and leaves text untouched when there is no
 * identity, so a message from an unattributed sender behaves as it did before
 * identities existed.
 */
export function withSpeakerPrefix(
  text: string,
  identity: ChatKitMessageIdentity | undefined,
): string {
  if (!identity) return text;
  const prefix = formatSpeakerPrefix(identity);
  return prefix.length > 0 ? `${prefix}${text}` : text;
}

/**
 * One-line system-prompt instruction describing where a reply is delivered.
 *
 * Returns `undefined` when the reply stays inside Tilde — the web UI and
 * agent-to-agent delegation — so an agent is never told something untrue.
 *
 * Put this in the system prompt rather than on every message: it is a fact
 * about the session that never changes, and repeating it per turn spends
 * tokens for nothing.
 */
export function sessionProvenanceInstruction(
  session: ChatKitSessionContext | undefined,
): string | undefined {
  if (!session?.repliesRouteToProvider) return undefined;
  return (
    `This session originated on ${session.providerDisplayName}. ` +
    "Any response you write is delivered back to the participants on that platform, " +
    "so write it as correspondence to them rather than as a chat message. " +
    "Do not post to that platform with a tool; Tilde delivers your reply."
  );
}
