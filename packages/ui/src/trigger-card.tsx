import { useEffect, useRef, useState } from "react";
import { ClockIcon, PlusIcon, XIcon } from "lucide-react";
import {
  cronForPreset,
  MAX_ROUTINE_TRIGGERS,
  type RoutineTriggerSpec,
  type SignalInstance,
  type SignalProvider,
} from "@tryopenbot/client-runtime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";
import { eventEditorConfig, EventTriggerEditor } from "./event-trigger-editor.js";
import { clockLabel } from "./relative-time.js";
import { ScheduleEditor, type ScheduleMode, scheduleSpecSentence } from "./schedule-editor.js";
import { SignalProviderGlyph } from "./signal-provider-glyph.js";

/**
 * The "When to run" card inside the routine editor: trigger rows, the add
 * menu, and the anchored trigger-fields popover. Trigger edits buffer while
 * the popover is open and commit through `onChange` when it closes.
 */

export interface EditableTrigger {
  key: string;
  spec: RoutineTriggerSpec;
}

export interface TriggerSentence {
  lead: string;
  rest: string;
}

/** Lead/rest sentence for a locally edited trigger spec. */
export function triggerSpecSentence(
  spec: RoutineTriggerSpec,
  providers: readonly SignalProvider[],
  instances: readonly SignalInstance[] = [],
): TriggerSentence {
  if (spec.kind === "schedule") return scheduleSpecSentence(spec.schedule);
  const match = providerForSpec(spec, providers, instances);
  const config = match ? eventEditorConfig(match) : undefined;
  const option = config?.groups
    .flatMap((group) => group.options)
    .find((candidate) => candidate.value === spec.signalType);
  const filterText = (spec.filters ?? [])
    .map((filter) => (typeof filter.value === "string" ? filter.value : ""))
    .filter(Boolean)
    .join(", ");
  return {
    lead: match?.name ?? spec.signalType.split(".")[0] ?? "Event",
    rest: `${option?.label ?? spec.signalType}${filterText ? ` in ${filterText}` : ""}`,
  };
}

/**
 * Resolve the provider from the trigger's own connection first, then the
 * catalog, so signal types outside the curated option lists stay editable.
 */
export function providerForSpec(
  spec: RoutineTriggerSpec,
  providers: readonly SignalProvider[],
  instances: readonly SignalInstance[] = [],
): SignalProvider | undefined {
  if (spec.kind !== "event") return undefined;
  const providerType = instances.find(
    (candidate) => candidate.id === spec.instanceId,
  )?.provider_type;
  const byInstance = providerType
    ? providers.find((candidate) => candidate.type_id === providerType)
    : undefined;
  if (byInstance) return byInstance;
  const byCatalog = providers.find((candidate) =>
    candidate.signal_types.some((signalType) => signalType.type_id === spec.signalType),
  );
  if (byCatalog) return byCatalog;
  const prefix = spec.signalType.split(".")[0];
  const byPrefix = prefix ? providers.find((candidate) => candidate.type_id === prefix) : undefined;
  if (byPrefix) return byPrefix;
  return providers.find((candidate) =>
    eventEditorConfig(candidate).groups.some((group) =>
      group.options.some((option) => option.value === spec.signalType),
    ),
  );
}

function providerMenuLabel(provider: SignalProvider): string {
  switch (provider.type_id) {
    case "github":
      return "GitHub event";
    case "slack":
      return "Slack message";
    case "sentry":
      return "Sentry alert";
    case "firecrawl":
      return "Firecrawl monitor";
    default:
      return `${provider.name} event`;
  }
}

const timeGrid = Array.from({ length: 24 * 4 }, (_, slot) => ({
  hour: Math.floor(slot / 4),
  minute: (slot % 4) * 15,
}));

export interface TriggerCardProps {
  triggers: readonly EditableTrigger[];
  providers: readonly SignalProvider[];
  instances: readonly SignalInstance[];
  onChange: (triggers: EditableTrigger[]) => void;
  /** A provider in the add menu has no enabled connection yet. */
  onConnectProvider: (providerTypeId: string) => void;
  /** Set after a connect dialog succeeds so the event trigger draft opens. */
  connectedInstance?: { instance: SignalInstance; nonce: number } | undefined;
}

interface PopoverState {
  key: string;
  spec: RoutineTriggerSpec;
  isNew: boolean;
  valid: boolean;
  initialMode?: ScheduleMode;
}

export function TriggerCard({
  triggers,
  providers,
  instances,
  onChange,
  onConnectProvider,
  connectedInstance,
}: TriggerCardProps) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  // Emptying the list is held locally so the rows disappear even though a saved
  // routine keeps its stored triggers; the routine routes require 1..8.
  const [cleared, setCleared] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const consumedNonceRef = useRef(0);

  const visible = cleared ? [] : triggers;

  const enabledInstances = (providerType: string) =>
    instances.filter(
      (instance) => instance.provider_type === providerType && instance.status === "enabled",
    );

  useEffect(() => {
    if (!connectedInstance || connectedInstance.nonce === consumedNonceRef.current) return;
    consumedNonceRef.current = connectedInstance.nonce;
    const provider = providers.find(
      (candidate) => candidate.type_id === connectedInstance.instance.provider_type,
    );
    if (!provider) return;
    openEventDraft(provider, connectedInstance.instance);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per connect nonce
  }, [connectedInstance]);

  /**
   * Report every trigger list, including an emptied one, so an unsaved draft
   * cannot commit triggers the user deleted. The owner decides what an empty
   * list means; it is never persisted.
   */
  function applyTriggers(next: EditableTrigger[]): void {
    setCleared(next.length === 0);
    if (next.length === 0) setAddMenuOpen(true);
    onChange(next);
  }

  function commitTrigger(state: PopoverState): void {
    if (state.isNew) {
      if (state.valid) applyTriggers([...visible, { key: state.key, spec: state.spec }]);
      return;
    }
    if (!state.valid) return;
    const existing = visible.find((trigger) => trigger.key === state.key);
    if (!existing) return;
    if (JSON.stringify(existing.spec) === JSON.stringify(state.spec)) return;
    applyTriggers(
      visible.map((trigger) =>
        trigger.key === state.key ? { ...trigger, spec: state.spec } : trigger,
      ),
    );
  }

  function closePopover(commit: boolean): void {
    if (popover && commit) commitTrigger(popover);
    setPopover(null);
  }

  function appendSchedule(schedule: string, openEditor?: ScheduleMode): void {
    if (visible.length >= MAX_ROUTINE_TRIGGERS) return;
    const key = crypto.randomUUID();
    const trigger: EditableTrigger = { key, spec: { kind: "schedule", schedule } };
    applyTriggers([...visible, trigger]);
    setAddMenuOpen(false);
    if (openEditor) {
      setPopover({ key, spec: trigger.spec, isNew: false, valid: true, initialMode: openEditor });
    }
  }

  function openEventDraft(provider: SignalProvider, instance: SignalInstance): void {
    if (visible.length >= MAX_ROUTINE_TRIGGERS) return;
    const config = eventEditorConfig(provider);
    const firstEvent = config.groups[0]?.options[0]?.value ?? "";
    setAddMenuOpen(false);
    setPopover({
      key: crypto.randomUUID(),
      spec: { kind: "event", instanceId: instance.id, signalType: firstEvent, filters: [] },
      isNew: true,
      valid: true,
    });
  }

  function selectProvider(provider: SignalProvider): void {
    const connected = enabledInstances(provider.type_id);
    if (connected.length === 0) {
      setAddMenuOpen(false);
      onConnectProvider(provider.type_id);
      return;
    }
    openEventDraft(provider, connected[0]!);
  }

  function removeTrigger(trigger: EditableTrigger): void {
    if (popover?.key === trigger.key) setPopover(null);
    applyTriggers(visible.filter((candidate) => candidate.key !== trigger.key));
  }

  const rows: { trigger: EditableTrigger; pendingNew: boolean }[] = [
    ...visible.map((trigger) => ({ trigger, pendingNew: false })),
    ...(popover?.isNew
      ? [{ trigger: { key: popover.key, spec: popover.spec }, pendingNew: true }]
      : []),
  ];

  return (
    <div className="relative flex flex-col gap-1" ref={listRef}>
      {rows.length > 0 ? (
        <div aria-label="Triggers" className="flex flex-col gap-0.5" role="list">
          {rows.map(({ trigger, pendingNew }) => {
            const active = popover?.key === trigger.key;
            const sentence = triggerSpecSentence(
              active ? popover!.spec : trigger.spec,
              providers,
              instances,
            );
            return (
              <div className="group relative" key={trigger.key} role="listitem">
                <button
                  className={`flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left
                    transition-colors hover:bg-hover ${active ? "bg-hover" : ""}`}
                  onClick={() => {
                    if (popover && popover.key !== trigger.key) closePopover(true);
                    if (pendingNew) return;
                    setPopover({
                      key: trigger.key,
                      spec: trigger.spec,
                      isNew: false,
                      valid: true,
                    });
                  }}
                  type="button"
                >
                  {trigger.spec.kind === "schedule" ? (
                    <ClockIcon aria-hidden className="size-4 shrink-0 text-ink-2" />
                  ) : (
                    <SignalProviderGlyph
                      className="size-4 shrink-0 text-ink-2"
                      providerType={
                        providerForSpec(trigger.spec, providers, instances)?.type_id ??
                        trigger.spec.signalType.split(".")[0] ??
                        ""
                      }
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">
                    <span className="text-ink">{sentence.lead}</span>{" "}
                    <span className="text-ink-2">{sentence.rest}</span>
                  </span>
                </button>
                {!pendingNew ? (
                  <button
                    aria-label={`Remove trigger: ${sentence.lead} ${sentence.rest}`}
                    className="absolute right-1.5 top-1/2 hidden size-6 -translate-y-1/2 items-center
                      justify-center rounded-control text-ink-3 hover:bg-hover-2 hover:text-ink
                      group-hover:flex"
                    onClick={() => removeTrigger(trigger)}
                    type="button"
                  >
                    <XIcon aria-hidden className="size-3.5" />
                  </button>
                ) : null}
                {active ? (
                  <TriggerFieldsPopover
                    onClose={(commit) => closePopover(commit)}
                    state={popover!}
                    onStateChange={setPopover}
                    providers={providers}
                    instances={instances}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {visible.length < MAX_ROUTINE_TRIGGERS ? (
        <DropdownMenu onOpenChange={setAddMenuOpen} open={addMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-8 w-fit items-center gap-1.5 rounded-control px-2 text-[12.5px]
                text-ink-2 transition-colors hover:bg-hover hover:text-ink"
              type="button"
            >
              <PlusIcon aria-hidden className="size-3.5" />
              {visible.length === 0 ? "Add trigger" : "Add another"}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" aria-label="Trigger source" className="min-w-[240px]">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ClockIcon aria-hidden className="size-4 text-ink-2" />
                On a schedule
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuLabel>Cadence</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => appendSchedule("0 * * * *")}>
                  Every hour
                </DropdownMenuItem>
                <TimeSubmenu
                  label="Every day"
                  onPick={(hour, minute) => appendSchedule(`${minute} ${hour} * * *`)}
                />
                <TimeSubmenu
                  label="Weekdays"
                  onPick={(hour, minute) =>
                    appendSchedule(cronForPreset("weekdays", { hour, minute }))
                  }
                />
                <DropdownMenuItem
                  onSelect={() => appendSchedule(cronForPreset("weekly"), "weekly")}
                >
                  Every week
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => appendSchedule(cronForPreset("monthly"), "monthly")}
                >
                  Every month
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => appendSchedule(cronForPreset("daily"), "advanced")}
                >
                  Advanced…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {providers.map((provider) => (
              <DropdownMenuItem key={provider.type_id} onSelect={() => selectProvider(provider)}>
                <SignalProviderGlyph
                  className="size-4 text-ink-2"
                  providerType={provider.type_id}
                />
                {providerMenuLabel(provider)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function TimeSubmenu({
  label,
  onPick,
}: {
  label: string;
  onPick: (hour: number, minute: number) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuLabel>Time (UTC)</DropdownMenuLabel>
        {timeGrid.map((slot) => (
          <DropdownMenuItem
            key={`${slot.hour}:${slot.minute}`}
            onSelect={() => onPick(slot.hour, slot.minute)}
          >
            {clockLabel(slot.hour, slot.minute)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function TriggerFieldsPopover({
  state,
  onStateChange,
  onClose,
  providers,
  instances,
}: {
  state: PopoverState;
  onStateChange: (state: PopoverState) => void;
  onClose: (commit: boolean) => void;
  providers: readonly SignalProvider[];
  instances: readonly SignalInstance[];
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  // The listener binds once but must always commit the latest buffered state.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeRef.current(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    surfaceRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const provider =
    state.spec.kind === "event" ? providerForSpec(state.spec, providers, instances) : undefined;
  const eventInstances =
    state.spec.kind === "event"
      ? instances.filter(
          (instance) =>
            instance.status === "enabled" &&
            (provider ? instance.provider_type === provider.type_id : true),
        )
      : [];

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-40" onMouseDown={() => onClose(true)} />
      <div
        aria-label="Trigger fields"
        className="absolute left-0 right-0 top-full z-50 mt-1 rounded-card border-[0.5px]
          border-line-strong bg-surface p-3 shadow-overlay outline-none"
        ref={surfaceRef}
        role="dialog"
        tabIndex={-1}
      >
        {state.spec.kind === "schedule" ? (
          <ScheduleEditor
            {...(state.initialMode ? { initialMode: state.initialMode } : {})}
            onChange={(schedule, valid) =>
              onStateChange({
                ...state,
                spec: valid ? { ...state.spec, kind: "schedule", schedule } : state.spec,
                valid,
              })
            }
            schedule={state.spec.schedule}
          />
        ) : provider ? (
          <EventTriggerEditor
            instances={eventInstances}
            onChange={(value, valid) =>
              onStateChange({
                ...state,
                valid,
                spec: {
                  kind: "event",
                  ...(state.spec.id ? { id: state.spec.id } : {}),
                  instanceId: value.instanceId,
                  signalType: value.signalType,
                  filters: value.filters,
                },
              })
            }
            provider={provider}
            value={{
              instanceId: state.spec.instanceId,
              signalType: state.spec.signalType,
              filters: state.spec.filters ?? [],
            }}
          />
        ) : (
          <p className="text-[12.5px] text-ink-3">This trigger's provider is unavailable.</p>
        )}
      </div>
    </>
  );
}
