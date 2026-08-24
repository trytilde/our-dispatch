import { useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import type { SignalDelivery, SignalInstance, SignalProvider } from "@tryopenbot/client-runtime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";
import { Spinner } from "./components/ui/spinner.js";
import { DialogSurface } from "./overlay-components.js";
import { StatusBadge } from "./primitive-components.js";
import { relativeRunTime } from "./relative-time.js";
import { SignalProviderGlyph } from "./signal-provider-glyph.js";
import { WebhookUrlField } from "./signal-provider-dialog.js";

/**
 * Settings → Signals: the team's provider connections with row actions and
 * an expandable recent-deliveries view. All data arrives via props.
 */

export interface SignalsSettingsProps {
  providers: readonly SignalProvider[];
  instances: readonly SignalInstance[];
  deliveriesByInstanceId: Record<string, SignalDelivery[]>;
  settled: boolean;
  error?: string;
  /** Transient per-row notices, e.g. a test-fire result. */
  rowNotices?: Record<string, { text: string; tone: "success" | "danger" }>;
  onConnectProvider: (providerTypeId: string) => void;
  onToggleInstance: (instance: SignalInstance, enabled: boolean) => void;
  onRotateSigningKey: (instance: SignalInstance, signingSecret: string) => void;
  onTestInstance: (instance: SignalInstance) => void;
  onViewDeliveries: (instanceId: string) => void;
  onDeleteInstance: (instance: SignalInstance) => void;
}

export function SignalsSettings({
  providers,
  instances,
  deliveriesByInstanceId,
  settled,
  error,
  rowNotices = {},
  onConnectProvider,
  onToggleInstance,
  onRotateSigningKey,
  onTestInstance,
  onViewDeliveries,
  onDeleteInstance,
}: SignalsSettingsProps) {
  const [expandedId, setExpandedId] = useState("");
  const [rotating, setRotating] = useState<SignalInstance | null>(null);
  const [rotateSecret, setRotateSecret] = useState("");
  const [deleting, setDeleting] = useState<SignalInstance | null>(null);

  return (
    <section aria-label="Signals" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[13px] font-medium text-ink">Signals</h3>
          <p className="text-[12.5px] text-ink-3">
            Connections that let routines run when something happens in a connected tool.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="h-8 shrink-0 rounded-control bg-ink px-3 text-[12.5px] font-medium
                text-surface"
              type="button"
            >
              Connect provider
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            {providers.map((provider) => (
              <DropdownMenuItem
                key={provider.type_id}
                onSelect={() => onConnectProvider(provider.type_id)}
              >
                <SignalProviderGlyph
                  className="size-4 text-ink-2"
                  providerType={provider.type_id}
                />
                {provider.name}
              </DropdownMenuItem>
            ))}
            {providers.length === 0 ? (
              <DropdownMenuItem disabled>No providers available</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error ? <p className="text-[12px] text-red">{error}</p> : null}

      <div className="flex flex-col gap-2">
        {instances.map((instance) => {
          const notice = rowNotices[instance.id];
          const deliveries = deliveriesByInstanceId[instance.id] ?? [];
          const expanded = expandedId === instance.id;
          return (
            <div
              className="flex flex-col gap-2.5 rounded-[12px] bg-surface p-3.5 shadow-hairline"
              key={instance.id}
            >
              <div className="flex items-center gap-2.5">
                <SignalProviderGlyph
                  className="size-4 shrink-0 text-ink-2"
                  providerType={instance.provider_type}
                />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                  {instance.display_name}
                </span>
                <StatusBadge tone={instance.status === "enabled" ? "success" : "neutral"}>
                  {instance.status === "enabled" ? "Enabled" : "Disabled"}
                </StatusBadge>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={`Actions for ${instance.display_name}`}
                      className="flex size-7 items-center justify-center rounded-control
                        text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                      type="button"
                    >
                      ⋯
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => onToggleInstance(instance, instance.status !== "enabled")}
                    >
                      {instance.status === "enabled" ? "Disable" : "Enable"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setRotateSecret("");
                        setRotating(instance);
                      }}
                    >
                      Rotate signing key
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onTestInstance(instance)}>
                      Send test event
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        const next = expanded ? "" : instance.id;
                        setExpandedId(next);
                        if (next) onViewDeliveries(instance.id);
                      }}
                    >
                      {expanded ? "Hide recent deliveries" : "View recent deliveries"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red data-[highlighted]:text-red"
                      onSelect={() => setDeleting(instance)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {instance.last_error ? (
                <p className="text-[12px] text-red">{instance.last_error}</p>
              ) : null}
              {notice ? (
                <p
                  className={`text-[12px] ${notice.tone === "success" ? "text-green" : "text-red"}`}
                >
                  {notice.text}
                </p>
              ) : null}
              {instance.webhook_url ? <WebhookUrlField url={instance.webhook_url} /> : null}
              {expanded ? (
                <div className="flex flex-col gap-0.5 border-t border-line pt-2">
                  {deliveries.length === 0 ? (
                    <p className="text-[12px] text-ink-3">No deliveries yet</p>
                  ) : (
                    deliveries.slice(0, 20).map((delivery) => (
                      <div
                        className="flex h-7 items-center gap-2 px-1 text-[12px]"
                        key={delivery.id}
                        title={delivery.error_message ?? delivery.summary ?? undefined}
                      >
                        <span className="w-[110px] shrink-0 text-ink-3">
                          {relativeRunTime(delivery.created_at)}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-ink-2">
                          {delivery.signal_type}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink-2">
                          {delivery.summary ?? ""}
                        </span>
                        {delivery.status === "pending" || delivery.status === "processing" ? (
                          <Spinner aria-label="Running" className="size-3 text-ink-2" />
                        ) : delivery.status === "completed" ? (
                          <CheckIcon
                            aria-label="Succeeded"
                            className="size-3 text-green"
                            role="img"
                          />
                        ) : (
                          <XIcon aria-label="Failed" className="size-3 text-red" role="img" />
                        )}
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
        {instances.length === 0 && settled ? (
          <p className="text-[12.5px] text-ink-3">
            No connections yet. Connect a provider to let routines react to events.
          </p>
        ) : null}
      </div>

      <DialogSurface
        actions={
          <>
            <button onClick={() => setRotating(null)} type="button">
              Cancel
            </button>
            <button
              className="primary"
              disabled={!rotateSecret.trim()}
              onClick={() => {
                if (rotating) onRotateSigningKey(rotating, rotateSecret.trim());
                setRotating(null);
              }}
              type="button"
            >
              Rotate key
            </button>
          </>
        }
        description="Stored encrypted. You choose this value and paste the same value into the provider."
        onClose={() => setRotating(null)}
        open={rotating !== null}
        title={`Rotate signing key for "${rotating?.display_name ?? ""}"`}
      >
        <input
          aria-label="New signing key"
          autoFocus
          className="h-8 w-full rounded-control border border-line-strong bg-transparent px-2.5
            text-[13px] text-ink outline-none focus-visible:border-accent"
          onChange={(event) => setRotateSecret(event.target.value)}
          spellCheck={false}
          type="password"
          value={rotateSecret}
        />
      </DialogSurface>

      <DialogSurface
        actions={
          <>
            <button onClick={() => setDeleting(null)} type="button">
              Cancel
            </button>
            <button
              className="primary destructive"
              onClick={() => {
                if (deleting) onDeleteInstance(deleting);
                setDeleting(null);
              }}
              type="button"
            >
              Delete
            </button>
          </>
        }
        description="This permanently deletes the connection. Routines with triggers on it will stop firing. This can't be undone."
        onClose={() => setDeleting(null)}
        open={deleting !== null}
        title={`Delete "${deleting?.display_name ?? ""}"`}
      />
    </section>
  );
}
