import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { SignalInstance, SignalProvider } from "@tryopenbot/client-runtime";
import { DialogSurface } from "./overlay-components.js";
import { MarkdownText } from "./rich-message-components.js";
import { SignalProviderGlyph } from "./signal-provider-glyph.js";

/**
 * Connect dialog for a signal provider. The control service assigns the
 * webhook URL when the instance is created, so the flow is: name (and
 * signing key) → Create → webhook URL, setup instructions, and test fire.
 */

export type SignalTestStatus = "idle" | "sending" | "delivered" | "failed";

export interface SignalProviderDialogProps {
  open: boolean;
  provider: SignalProvider;
  creating: boolean;
  error?: string;
  /** Set once the connection was created; switches to the setup step. */
  instance?: SignalInstance | undefined;
  testStatus?: SignalTestStatus;
  testError?: string;
  onCreate: (input: { displayName: string; signingSecret?: string }) => void;
  onTest: () => void;
  onClose: () => void;
}

export function SignalProviderDialog({
  open,
  provider,
  creating,
  error,
  instance,
  testStatus = "idle",
  testError,
  onCreate,
  onTest,
  onClose,
}: SignalProviderDialogProps) {
  const [displayName, setDisplayName] = useState(provider.name);
  const [signingSecret, setSigningSecret] = useState("");

  useEffect(() => {
    if (!open) return;
    setDisplayName(provider.name);
    setSigningSecret("");
  }, [open, provider]);

  const requiresKey = provider.requires_signing_key;
  const canCreate =
    Boolean(displayName.trim()) && (!requiresKey || Boolean(signingSecret.trim())) && !creating;
  const webhookUrl = instance?.webhook_url ?? "";
  const instructions = provider.instructions?.replaceAll("{{webhook_url}}", webhookUrl || "");

  return (
    <DialogSurface
      actions={
        instance ? (
          <>
            <button disabled={testStatus === "sending"} onClick={onTest} type="button">
              {testStatus === "sending" ? "Sending…" : "Send test event"}
            </button>
            <button className="primary" onClick={onClose} type="button">
              Done
            </button>
          </>
        ) : (
          <>
            <button disabled={creating} onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="primary"
              disabled={!canCreate}
              onClick={() =>
                onCreate({
                  displayName: displayName.trim(),
                  ...(signingSecret.trim() ? { signingSecret: signingSecret.trim() } : {}),
                })
              }
              type="button"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </>
        )
      }
      onClose={onClose}
      open={open}
      title={`Connect ${provider.name}`}
      width={480}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <SignalProviderGlyph className="size-4 text-ink-2" providerType={provider.type_id} />
          {instance ? instance.display_name : `New ${provider.name} connection`}
        </div>

        {!instance ? (
          <>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
              Connection name
              <input
                autoFocus
                className="h-8 rounded-control border border-line-strong bg-transparent px-2.5
                  text-[13px] font-normal text-ink outline-none focus-visible:border-accent"
                onChange={(event) => setDisplayName(event.target.value)}
                value={displayName}
              />
            </label>
            {requiresKey ? (
              <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
                {provider.signing_key_description || `${provider.name} webhook signing key`}
                <input
                  className="h-8 rounded-control border border-line-strong bg-transparent px-2.5
                    text-[13px] font-normal text-ink outline-none focus-visible:border-accent"
                  onChange={(event) => setSigningSecret(event.target.value)}
                  spellCheck={false}
                  type="password"
                  value={signingSecret}
                />
                <span className="text-[11.5px] font-normal text-ink-3">
                  Stored encrypted. You choose this value and paste the same value into the
                  provider.
                </span>
              </label>
            ) : (
              <p className="text-[11.5px] text-ink-3">
                This provider does not sign requests. Treat the webhook URL as a secret.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
              Webhook URL
              <WebhookUrlField url={webhookUrl} />
            </div>
            {instance.status ? (
              <p className="text-[12px] text-ink-2">
                Status: <span className="text-ink">{instance.status}</span>
                {instance.last_error ? (
                  <span className="text-red"> — {instance.last_error}</span>
                ) : null}
              </p>
            ) : null}
            {instructions ? (
              <div className="max-h-[220px] overflow-y-auto rounded-card bg-inset p-2.5 text-[12.5px]">
                <MarkdownText text={instructions} />
              </div>
            ) : null}
            {testStatus === "delivered" ? (
              <p className="text-[12px] text-green">Test delivered</p>
            ) : null}
            {testStatus === "failed" && testError ? (
              <p className="text-[12px] text-red">{testError}</p>
            ) : null}
          </>
        )}
        {error ? <p className="text-[12px] text-red">{error}</p> : null}
      </div>
    </DialogSurface>
  );
}

export function WebhookUrlField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef(0);
  useEffect(() => () => window.clearTimeout(resetRef.current), []);
  return (
    <span className="flex items-center gap-1.5">
      <input
        aria-label="Webhook URL"
        className="h-8 min-w-0 flex-1 rounded-control border border-line-strong bg-inset px-2.5
          font-mono text-[11.5px] text-ink-2 outline-none"
        readOnly
        value={url}
      />
      <button
        aria-label="Copy webhook URL"
        className="flex size-7 shrink-0 items-center justify-center rounded-control text-ink-2
          transition-colors hover:bg-hover hover:text-ink"
        onClick={() => {
          void navigator.clipboard.writeText(url);
          setCopied(true);
          window.clearTimeout(resetRef.current);
          resetRef.current = window.setTimeout(() => setCopied(false), 1500);
        }}
        type="button"
      >
        {copied ? (
          <CheckIcon aria-hidden className="size-3.5 text-green" />
        ) : (
          <CopyIcon aria-hidden className="size-3.5" />
        )}
      </button>
    </span>
  );
}
