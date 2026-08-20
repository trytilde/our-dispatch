import { useMemo, useState, type FormEvent } from "react";
import { connectorSetupFields, type ConnectorSetupField } from "@tryopenbot/client-runtime";
import type { MessagePart } from "./rich-message-components.js";

export { connectorSetupFields, type ConnectorSetupField };

/**
 * In-chat connector configuration, ported from Grok Bot's connector cards.
 * The agent's `configure_connector` tool emits a `connector_selection`
 * payload; the grid lets the owner pick an existing provider account or add a
 * new one, and the setup dialog renders the provider's credential form from
 * its Tilde configuration schemas. Presentation-only: callers own data
 * fetching and the message round trip back to the agent.
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
            <ConnectorGlyph name={selection.providerName} />
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

function ConnectorGlyph({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
  const nameRequired = !(source?.supportsAutoDisplayName ?? false);
  const missingRequired =
    (nameRequired && !displayName.trim()) ||
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
      displayName: displayName.trim() || `${providerName} account`,
      ...(resourceServerValues ? { resourceServerValues } : {}),
      ...(userCredentialValues ? { userCredentialValues } : {}),
    });
  }

  return (
    <div
      aria-label={`Add ${providerName} account`}
      className="connector-setup-overlay"
      role="dialog"
    >
      <form className="connector-setup" onSubmit={handleSubmit}>
        <h2>Add a {providerName} account</h2>
        {authorizationUrl ? (
          <div className="connector-setup-waiting">
            <p>
              Waiting for {providerName} authorization… Finish signing in with your browser, then
              return here.
            </p>
            <div className="connector-setup-actions">
              <button onClick={() => onReopenAuthorization?.()} type="button">
                Reopen authorization
              </button>
              <button className="primary" onClick={onClose} type="button">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {credentialSources.length > 1 ? (
              <label className="connector-setup-field">
                <span>Sign-in method</span>
                <select
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
            ) : null}
            {source?.documentation ? (
              <p className="connector-setup-hint">{source.documentation}</p>
            ) : null}
            {nameRequired ? (
              <label className="connector-setup-field">
                <span>Account name</span>
                <input
                  autoFocus
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={
                    source?.displayNameDescription || "Label this account — e.g. work, personal"
                  }
                  value={displayName}
                />
              </label>
            ) : null}
            {fields.map((field) => (
              <label className="connector-setup-field" key={field.key}>
                <span>
                  {field.label}
                  {field.required ? null : <em> (optional)</em>}
                </span>
                {field.multiline ? (
                  <textarea
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                    rows={5}
                    spellCheck={false}
                    value={values[field.key] ?? ""}
                  />
                ) : (
                  <input
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                    placeholder={field.description ?? field.key}
                    spellCheck={false}
                    type={field.secret ? "password" : "text"}
                    value={values[field.key] ?? ""}
                  />
                )}
              </label>
            ))}
            {source?.requiresBrokering && fields.length === 0 ? (
              <p className="connector-setup-hint">
                You will sign in with your browser to authorize this account.
              </p>
            ) : null}
            {error ? <p className="connector-setup-error">{error}</p> : null}
            <div className="connector-setup-actions">
              <button disabled={submitting} onClick={onClose} type="button">
                Cancel
              </button>
              <button className="primary" disabled={submitting || missingRequired} type="submit">
                {submitting
                  ? "Connecting…"
                  : source?.requiresBrokering
                    ? "Allow access"
                    : "Connect"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
