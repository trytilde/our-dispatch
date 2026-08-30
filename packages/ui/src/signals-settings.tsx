import { useMemo, useState } from "react";
import { MoreHorizontalIcon, PlusIcon, SearchIcon } from "lucide-react";
import type { SignalInstance, SignalProvider } from "@tryopenbot/client-runtime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";
import { SignalProviderGlyph } from "./signal-provider-glyph.js";

export interface RoutineProvidersSettingsProps {
  providers: readonly SignalProvider[];
  instances: readonly SignalInstance[];
  settled: boolean;
  error?: string;
  rowNotices?: Record<string, { text: string; tone: "success" | "danger" }>;
  onConnectProvider: (providerTypeId: string) => void;
  onToggleInstance: (instance: SignalInstance, enabled: boolean) => void;
  onDeleteInstance: (instance: SignalInstance) => void;
}

export function RoutineProvidersSettings({
  providers,
  instances,
  settled,
  error,
  rowNotices = {},
  onConnectProvider,
  onToggleInstance,
  onDeleteInstance,
}: RoutineProvidersSettingsProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      providers
        .map((provider) => ({
          provider,
          instances: instances.filter((instance) => instance.provider_type === provider.type_id),
        }))
        .filter(
          ({ provider, instances: connected }) =>
            !needle ||
            `${provider.name} ${provider.documentation ?? ""} ${connected
              .map((instance) => instance.display_name)
              .join(" ")}`
              .toLowerCase()
              .includes(needle),
        ),
    [instances, needle, providers],
  );

  return (
    <section aria-label="Routine providers" className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 max-[720px]:items-start">
        <div>
          <h1 className="m-0 text-[15px] font-semibold text-ink">Routine providers</h1>
          <p className="mt-1 mb-0 text-[12.5px] text-ink-3">
            Connect services that can start a routine when something changes.
          </p>
        </div>
      </div>
      <label className="flex h-9 items-center gap-2 rounded-control border border-line bg-surface px-3">
        <SearchIcon aria-hidden className="size-4 text-ink-3" />
        <span className="sr-only">Search routine providers</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none max-[720px]:text-base"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search routine providers"
          type="search"
          value={query}
        />
      </label>
      {error ? <p className="m-0 text-[12px] text-red">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2 max-[980px]:grid-cols-1">
        {rows.map(({ provider, instances: connected }) => (
          <article
            aria-label={`Routine provider ${provider.name}`}
            className="flex min-h-[88px] flex-col gap-3 rounded-2xl bg-surface p-3 shadow-hairline"
            key={provider.type_id}
          >
            <div className="flex items-start gap-3">
              <span className="grid size-[45px] shrink-0 place-items-center rounded-[10px] bg-field">
                <SignalProviderGlyph
                  className="size-5 text-ink-2"
                  providerType={provider.type_id}
                />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[13px] font-medium text-ink">
                  {provider.name}
                </strong>
                <small className="mt-0.5 block line-clamp-2 text-[11.5px] leading-[1.35] text-ink-3">
                  {provider.documentation || "Start routines from this service."}
                </small>
              </span>
              <button
                aria-label={`Add ${provider.name} connection`}
                className="grid size-8 shrink-0 place-items-center rounded-control text-ink-2 hover:bg-hover hover:text-ink"
                onClick={() => onConnectProvider(provider.type_id)}
                type="button"
              >
                <PlusIcon aria-hidden className="size-4" />
              </button>
            </div>
            {connected.length ? (
              <div className="flex flex-col gap-1 border-t border-line pt-2">
                {connected.map((instance) => {
                  const notice = rowNotices[instance.id];
                  return (
                    <div className="flex min-h-8 items-center gap-2" key={instance.id}>
                      <span
                        className={`size-1.5 rounded-full ${instance.status === "enabled" ? "bg-green" : "bg-ink-3"}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
                        {instance.display_name}
                      </span>
                      <span className="text-[10.5px] text-ink-3">
                        {instance.status === "enabled" ? "Enabled" : "Paused"}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            aria-label={`Actions for ${instance.display_name}`}
                            className="grid size-7 place-items-center rounded-control text-ink-3 hover:bg-hover"
                            type="button"
                          >
                            <MoreHorizontalIcon aria-hidden className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() =>
                              onToggleInstance(instance, instance.status !== "enabled")
                            }
                          >
                            {instance.status === "enabled" ? "Pause" : "Enable"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red data-[highlighted]:text-red"
                            onSelect={() => onDeleteInstance(instance)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {notice ? (
                        <span
                          className={`sr-only ${notice.tone === "danger" ? "text-red" : "text-green"}`}
                        >
                          {notice.text}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <button
                className="h-8 w-fit rounded-control border border-line px-3 text-[12px] font-medium text-ink-2 hover:bg-hover"
                onClick={() => onConnectProvider(provider.type_id)}
                type="button"
              >
                Connect
              </button>
            )}
          </article>
        ))}
        {rows.length === 0 && settled ? (
          <p className="col-span-full py-8 text-center text-[12.5px] text-ink-3">
            {providers.length === 0
              ? "No routine providers are available."
              : "No providers match this search."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
