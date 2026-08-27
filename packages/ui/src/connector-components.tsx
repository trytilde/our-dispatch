import { useMemo, useState, type FormEvent } from "react";
import { connectorSetupFields, type ConnectorSetupField } from "@tryopenbot/client-runtime";
import { ExternalLinkIcon, KeyRoundIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react";
import { Button } from "./beautiful-ui/atoms/button.js";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog.js";
import { ProviderIcon } from "./provider-icon.js";
import type { MessagePart } from "./rich-message-components.js";

export { connectorSetupFields, type ConnectorSetupField };

/**
 * In-chat connector configuration. The agent's `configure_connector` tool
 * emits a `connector_selection` payload; the grid lets the owner pick an
 * existing provider account or add a new one, and the setup dialog renders
 * the provider's credential form from its Tilde configuration schemas.
 * Presentation-only: callers own data fetching and the message round trip
 * back to the agent.
 */

export const CONNECTOR_SELECTION_TOOL_NAME = "configure_connector";

export interface ConnectorAccountView {
  id: string;
  displayName: string;
  status: string;
  credentialSourceTypeId?: string;
}

export interface ConnectorCredentialSourceView {
  typeId: string;
  name: string;
  documentation?: string;
  requiresBrokering: boolean;
  supportsAutoDisplayName: boolean;
  displayNameDescription?: string;
  resourceServerSchema?: unknown;
  userCredentialSchema?: unknown;
}

export interface ConnectorSelectionView {
  providerTypeId: string;
  providerName: string;
  /** Provider branding from Tilde catalog metadata (https or data: URI). */
  iconUrl?: string;
  prompt?: string;
  accounts: ConnectorAccountView[];
  credentialSources: ConnectorCredentialSourceView[];
}

export function isConnectorSelectionPart(part: MessagePart): boolean {
  return connectorSelectionViewFromPart(part) !== undefined;
}

/** Tolerant extraction so a malformed payload degrades to the JSON block. */
export function connectorSelectionViewFromPart(
  part: MessagePart,
): ConnectorSelectionView | undefined {
  const isTool =
    part.type === "tool" || part.type === "dynamic-tool" || part.type.startsWith("tool-");
  if (!isTool) return undefined;
  const name = part.tool_name ?? part.toolName ?? part.type.replace(/^tool-/, "");
  if (name !== CONNECTOR_SELECTION_TOOL_NAME) return undefined;
  const output = unwrapOutput(part.output);
  const selection = asRecord(output).connector_selection;
  const record = asRecord(selection);
  const providerTypeId = asText(record.provider_type_id);
  const providerName = asText(record.provider_name) || providerTypeId;
  if (!providerTypeId || !Array.isArray(record.accounts)) return undefined;
  return {
    providerTypeId,
    providerName,
    ...(asText(record.icon_url) ? { iconUrl: asText(record.icon_url) } : {}),
    ...(asText(record.prompt) ? { prompt: asText(record.prompt) } : {}),
    accounts: record.accounts.flatMap((entry) => {
      const account = asRecord(entry);
      const id = asText(account.id);
      if (!id) return [];
      return [
        {
          id,
          displayName: asText(account.display_name) || id,
          status: asText(account.status) || "unknown",
          ...(asText(account.credential_source_type_id)
            ? { credentialSourceTypeId: asText(account.credential_source_type_id) }
            : {}),
        },
      ];
    }),
    credentialSources: (Array.isArray(record.credential_sources)
      ? record.credential_sources
      : []
    ).flatMap((entry) => {
      const source = asRecord(entry);
      const typeId = asText(source.type_id);
      if (!typeId) return [];
      return [
        {
          typeId,
          name: asText(source.name) || typeId,
          ...(asText(source.documentation) ? { documentation: asText(source.documentation) } : {}),
          requiresBrokering: source.requires_brokering === true,
          supportsAutoDisplayName: source.supports_auto_display_name === true,
          ...(asText(source.display_name_description)
            ? { displayNameDescription: asText(source.display_name_description) }
            : {}),
          resourceServerSchema: source.resource_server_schema,
          userCredentialSchema: source.user_credential_schema,
        },
      ];
    }),
  };
}

function unwrapOutput(output: unknown): unknown {
  const record = asRecord(output);
  if (record.type === "json" && "value" in record) return record.value;
  return output;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export interface ConnectorAccountGridProps {
  selection: ConnectorSelectionView;
  /** Absent handlers render the grid inert (history replay, mobile preview). */
  onSelectAccount?: (account: ConnectorAccountView) => void;
  onAddAccount?: () => void;
  /** Marks the account the owner already picked so replays stay legible. */
  selectedAccountId?: string;
  busy?: boolean;
}

export function ConnectorAccountGrid({
  selection,
  onSelectAccount,
  onAddAccount,
  selectedAccountId,
  busy = false,
}: ConnectorAccountGridProps) {
  const prompt =
    selection.prompt ?? `Select which account to enable for this bot for ${selection.providerName}`;
  return (
    <section aria-label={`${selection.providerName} accounts`} className="connector-select">
      <p className="connector-select-prompt">{prompt}</p>
      <div className="connector-select-grid">
        {selection.accounts.map((account) => (
          <button
            className={`connector-select-card${
              selectedAccountId === account.id ? " selected" : ""
            }`}
            disabled={busy || !onSelectAccount}
            key={account.id}
            onClick={() => onSelectAccount?.(account)}
            title={`Use ${account.displayName}`}
            type="button"
          >
            <ConnectorGlyph iconUrl={selection.iconUrl} name={selection.providerName} />
            <span className="connector-select-copy">
              <strong>{selection.providerName}</strong>
              <small>{account.displayName}</small>
            </span>
            {selectedAccountId === account.id ? (
              <span aria-hidden className="connector-select-check">
                ✓
              </span>
            ) : null}
          </button>
        ))}
        <button
          className="connector-select-card connector-select-add"
          disabled={busy || !onAddAccount}
          key="add-account"
          onClick={() => onAddAccount?.()}
          title={`Add a new ${selection.providerName} account`}
          type="button"
        >
          <span aria-hidden className="connector-glyph connector-glyph-add">
            +
          </span>
          <span className="connector-select-copy">
            <strong>Add new {selection.providerName} account</strong>
            <small>Connect another account</small>
          </span>
        </button>
      </div>
    </section>
  );
}

function ConnectorGlyph({
  iconUrl,
  name,
  providerSize = false,
}: {
  iconUrl?: string | undefined;
  name: string;
  providerSize?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  if (providerSize) {
    return (
      <ProviderIcon
        backgroundColor="#777"
        fallback={initials || "?"}
        {...(iconUrl ? { imageUrl: iconUrl } : {})}
      />
    );
  }
  if (iconUrl) {
    return (
      <span aria-hidden className="connector-glyph">
        <img alt="" src={iconUrl} />
      </span>
    );
  }
  return (
    <span aria-hidden className="connector-glyph">
      {initials || "?"}
    </span>
  );
}

export interface ConnectorSetupSubmit {
  credentialSourceTypeId: string;
  displayName: string;
  resourceServerValues?: Record<string, unknown>;
  userCredentialValues?: Record<string, unknown>;
}

export interface ConnectorSetupDialogProps {
  providerName: string;
  /** Provider branding from Tilde catalog metadata (https or data: URI). */
  providerIconUrl?: string;
  credentialSources: ConnectorCredentialSourceView[];
  submitting?: boolean;
  error?: string;
  /** When set, the OAuth window is open; the dialog shows the waiting state. */
  authorizationUrl?: string;
  onSubmit: (input: ConnectorSetupSubmit) => void;
  onReopenAuthorization?: () => void;
  onClose: () => void;
}

export function ConnectorSetupDialog({
  providerName,
  providerIconUrl,
  credentialSources,
  submitting = false,
  error,
  authorizationUrl,
  onSubmit,
  onReopenAuthorization,
  onClose,
}: ConnectorSetupDialogProps) {
  const [sourceTypeId, setSourceTypeId] = useState(credentialSources[0]?.typeId ?? "");
  const source =
    credentialSources.find((candidate) => candidate.typeId === sourceTypeId) ??
    credentialSources[0];
  const [displayName, setDisplayName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const resourceFields = useMemo(
    () => connectorSetupFields(source?.resourceServerSchema),
    [source],
  );
  const userFields = useMemo(
    () => (source?.requiresBrokering ? [] : connectorSetupFields(source?.userCredentialSchema)),
    [source],
  );
  const fields = [...resourceFields, ...userFields];
  const missingRequired =
    !source ||
    !displayName.trim() ||
    fields.some((field) => field.required && !values[field.key]?.trim());

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!source || missingRequired || submitting) return;
    const bucket = (candidates: ConnectorSetupField[]): Record<string, unknown> | undefined => {
      const entries = candidates
        .map((field) => [field.key, values[field.key]?.trim() ?? ""] as const)
        .filter(([, value]) => value.length > 0);
      return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    };
    const resourceServerValues = bucket(resourceFields);
    const userCredentialValues = bucket(userFields);
    onSubmit({
      credentialSourceTypeId: source.typeId,
      displayName: displayName.trim(),
      ...(resourceServerValues ? { resourceServerValues } : {}),
      ...(userCredentialValues ? { userCredentialValues } : {}),
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[80vh] max-w-[460px] overflow-y-auto p-[22px]"
      >
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <header className="flex items-start gap-3">
            <ConnectorGlyph iconUrl={providerIconUrl} name={providerName} providerSize />
            <div className="min-w-0 flex-1">
              <DialogTitle className="m-0 text-base font-semibold text-ink">
                Add {indefiniteArticle(providerName)} {providerName} account
              </DialogTitle>
            </div>
          </header>

          {authorizationUrl ? (
            <div className="grid gap-4">
              <div className="flex gap-3 rounded-xl bg-inset p-3 text-[12.5px] text-ink-2">
                <ExternalLinkIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <p className="m-0 leading-[18px]">
                  Waiting for {providerName} authorization. Finish signing in with your browser,
                  then return here.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button onClick={() => onReopenAuthorization?.()} variant="secondary">
                  <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
                  Reopen authorization
                </Button>
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              {credentialSources.length > 1 ? (
                <label className="grid gap-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
                    <ShieldCheckIcon aria-hidden="true" className="size-3.5" />
                    Sign-in method
                  </span>
                  <select
                    className="h-9 rounded-lg border-[0.5px] border-line-strong bg-field px-3
                      text-[12.5px] text-ink shadow-inset-field outline-none focus:border-accent"
                    onChange={(event) => {
                      setSourceTypeId(event.target.value);
                      setValues({});
                    }}
                    value={source?.typeId ?? ""}
                  >
                    {credentialSources.map((candidate) => (
                      <option key={candidate.typeId} value={candidate.typeId}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : !source ? (
                <p className="m-0 rounded-xl bg-red-tint p-3 text-xs text-red">
                  No connection methods are available for this provider.
                </p>
              ) : null}

              <label className="grid gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
                  <UserRoundIcon aria-hidden="true" className="size-3.5" />
                  Account name
                </span>
                <input
                  autoFocus
                  className="h-9 rounded-lg border-[0.5px] border-line-strong bg-field px-3
                    text-[12.5px] text-ink shadow-inset-field outline-none focus:border-accent"
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  value={displayName}
                />
                <span className="text-[11px] leading-4 text-ink-3">
                  Used to identify this account when choosing it for a bot.
                </span>
              </label>

              {fields.map((field) => (
                <label className="grid gap-1.5" key={field.key}>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
                    <KeyRoundIcon aria-hidden="true" className="size-3.5" />
                    {field.label}
                    {field.required ? null : (
                      <em className="font-normal text-ink-3 not-italic">(optional)</em>
                    )}
                  </span>
                  {field.multiline ? (
                    <textarea
                      className="min-h-24 resize-y rounded-lg border-[0.5px] border-line-strong
                        bg-field px-3 py-2 text-[12.5px] text-ink shadow-inset-field outline-none
                        focus:border-accent"
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                      required={field.required}
                      rows={5}
                      spellCheck={false}
                      value={values[field.key] ?? ""}
                    />
                  ) : (
                    <input
                      className="h-9 rounded-lg border-[0.5px] border-line-strong bg-field px-3
                        text-[12.5px] text-ink shadow-inset-field outline-none focus:border-accent"
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                      required={field.required}
                      spellCheck={false}
                      type={field.secret ? "password" : "text"}
                      value={values[field.key] ?? ""}
                    />
                  )}
                  {field.description ? (
                    <span className="text-[11px] leading-4 text-ink-3">{field.description}</span>
                  ) : null}
                </label>
              ))}

              {source?.requiresBrokering ? (
                <div
                  className="flex gap-3 rounded-xl border-[0.5px] border-line bg-surface p-3
                  text-[11.5px] leading-4 text-ink-2"
                >
                  <ExternalLinkIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <p className="m-0">
                    You’ll continue in your browser to sign in and authorize this account.
                  </p>
                </div>
              ) : null}

              {error ? (
                <p className="m-0 rounded-lg bg-red-tint px-3 py-2 text-xs text-red">{error}</p>
              ) : null}

              <div className="flex justify-end gap-2 pt-1">
                <Button disabled={submitting} onClick={onClose} variant="secondary">
                  Cancel
                </Button>
                <Button disabled={submitting || missingRequired} type="submit">
                  {submitting ? (
                    "Connecting…"
                  ) : source?.requiresBrokering ? (
                    <>
                      Continue
                      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
                    </>
                  ) : (
                    "Connect"
                  )}
                </Button>
              </div>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function indefiniteArticle(value: string): "a" | "an" {
  return /^[aeiou]/i.test(value.trim()) ? "an" : "a";
}
