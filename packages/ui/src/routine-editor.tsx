import { useEffect, useRef, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import type {
  Routine,
  RoutineTriggerSpec,
  SignalDelivery,
  SignalInstance,
  SignalProvider,
} from "@tryopenbot/client-runtime";
import { Spinner } from "./components/ui/spinner.js";
import { Switch } from "./components/ui/switch.js";
import { DialogSurface } from "./overlay-components.js";
import { relativeRunTime } from "./relative-time.js";
import { TriggerCard, type EditableTrigger } from "./trigger-card.js";

/**
 * The drill-in routine level: create and edit share this screen. Every field
 * autosaves on blur; a draft persists once name, instruction, and at least
 * one trigger exist (the routine routes require 1..8 triggers).
 */

export interface RunHistoryEntry {
  id: string;
  at: string;
  status: "running" | "succeeded" | "failed";
  detail?: string;
  sessionId?: string;
}

function deliveryEntry(delivery: SignalDelivery): RunHistoryEntry {
  const status =
    delivery.status === "pending" || delivery.status === "processing"
      ? "running"
      : delivery.status === "completed"
        ? "succeeded"
        : "failed";
  return {
    id: `delivery-${delivery.id}`,
    at: delivery.created_at,
    status,
    ...(delivery.summary || delivery.error_message
      ? { detail: delivery.error_message ?? delivery.summary ?? "" }
      : {}),
    ...(delivery.session_id ? { sessionId: delivery.session_id } : {}),
  };
}

function matchedTriggerIds(delivery: SignalDelivery): string[] {
  const value = (delivery as Record<string, unknown>)["matched_trigger_ids"];
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Deliveries are created with no matched triggers and filled in after matching, so
 * an unmatched delivery only proves it belongs to another routine once it has
 * settled; until then it is the run the history renders as "Running".
 */
function belongsToRoutine(delivery: SignalDelivery, triggerIds: ReadonlySet<string>): boolean {
  const matched = matchedTriggerIds(delivery);
  if (matched.length > 0) return matched.some((id) => triggerIds.has(id));
  return delivery.status === "pending" || delivery.status === "processing";
}

/**
 * Newest-first run history: signal deliveries matched to the Routine's triggers
 * plus the schedule snapshot row (Tilde keeps no cron run log).
 */
export function routineRunHistory(
  routine: Routine,
  deliveriesByInstanceId: Record<string, SignalDelivery[]>,
): RunHistoryEntry[] {
  const triggerIds = new Set(
    routine.triggers.flatMap((trigger) => (trigger.kind === "event" ? [trigger.id] : [])),
  );
  const entries: RunHistoryEntry[] = [];
  for (const trigger of routine.triggers) {
    if (trigger.kind !== "event") continue;
    for (const delivery of deliveriesByInstanceId[trigger.instance_id] ?? []) {
      if (!belongsToRoutine(delivery, triggerIds)) continue;
      entries.push(deliveryEntry(delivery));
    }
  }
  if (routine.last_run_at) {
    entries.push({
      id: `schedule-${routine.id}`,
      at: routine.last_run_at,
      status: routine.last_error ? "failed" : "succeeded",
      ...(routine.last_error ? { detail: routine.last_error } : {}),
      ...(routine.last_session_id ? { sessionId: routine.last_session_id } : {}),
    });
  }
  const seen = new Set<string>();
  return entries
    .filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)))
    .sort((a, b) => new Date(b.at).valueOf() - new Date(a.at).valueOf());
}

/** Map a routine's stored triggers onto locally editable trigger specs. */
export function editableTriggersFrom(routine: Routine): EditableTrigger[] {
  return routine.triggers.map((trigger) =>
    trigger.kind === "schedule"
      ? { key: trigger.id, spec: { kind: "schedule", id: trigger.id, schedule: trigger.schedule } }
      : {
          key: trigger.id,
          spec: {
            kind: "event",
            id: trigger.id,
            instanceId: trigger.instance_id,
            signalType: trigger.signal_type,
            filters: trigger.filters ?? [],
          },
        },
  );
}

export interface RoutineDraftCommit {
  name: string;
  instruction: string;
  enabled: boolean;
  triggers: RoutineTriggerSpec[];
}

/**
 * The unsaved draft commits only once it has a name, an instruction, and at
 * least one trigger, so a trigger deleted before the draft saved is never
 * created with it.
 */
export function routineDraftCommit(fields: {
  name: string;
  instruction: string;
  enabled: boolean;
  triggers: readonly EditableTrigger[];
}): RoutineDraftCommit | null {
  const name = fields.name.trim();
  const instruction = fields.instruction.trim();
  if (!name || !instruction || fields.triggers.length === 0) return null;
  return {
    name,
    instruction,
    enabled: fields.enabled,
    triggers: fields.triggers.map((trigger) => trigger.spec),
  };
}

export interface RoutineEditorProps {
  /** null renders an unsaved draft. */
  routine: Routine | null;
  providers: readonly SignalProvider[];
  instances: readonly SignalInstance[];
  deliveriesByInstanceId: Record<string, SignalDelivery[]>;
  saveFailed: boolean;
  deleteFailed: boolean;
  running: boolean;
  togglePending: boolean;
  onUpdate: (input: {
    name?: string;
    instruction?: string;
    enabled?: boolean;
    triggers?: RoutineTriggerSpec[];
  }) => void;
  onCreateDraft: (input: RoutineDraftCommit) => void;
  onDelete: () => void;
  onTestRun: () => void;
  onSelectSession: (sessionId: string) => void;
  onConnectProvider: (providerTypeId: string) => void;
  connectedInstance?: { instance: SignalInstance; nonce: number } | undefined;
}

export function RoutineEditor({
  routine,
  providers,
  instances,
  deliveriesByInstanceId,
  saveFailed,
  deleteFailed,
  running,
  togglePending,
  onUpdate,
  onCreateDraft,
  onDelete,
  onTestRun,
  onSelectSession,
  onConnectProvider,
  connectedInstance,
}: RoutineEditorProps) {
  const [name, setName] = useState(routine?.name ?? "");
  const [instruction, setInstruction] = useState(routine?.instruction ?? "");
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftTriggers, setDraftTriggers] = useState<EditableTrigger[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const seededIdRef = useRef(routine?.id ?? "");
  const historyRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = routine?.id ?? "";
    if (seededIdRef.current === id) return;
    seededIdRef.current = id;
    setName(routine?.name ?? "");
    setInstruction(routine?.instruction ?? "");
  }, [routine]);

  useEffect(() => {
    if (!routine) nameRef.current?.focus();
  }, [routine]);

  const isDraft = routine === null;
  const triggers = isDraft ? draftTriggers : editableTriggersFrom(routine);
  const enabled = isDraft ? draftEnabled : routine.enabled;

  function commitDraftIfReady(next: {
    name?: string;
    instruction?: string;
    enabled?: boolean;
    triggers?: EditableTrigger[];
  }): void {
    const candidate = routineDraftCommit({
      name: next.name ?? name,
      instruction: next.instruction ?? instruction,
      enabled: next.enabled ?? draftEnabled,
      triggers: next.triggers ?? draftTriggers,
    });
    if (candidate) onCreateDraft(candidate);
  }

  function commitName(): void {
    const trimmed = name.trim();
    if (isDraft) {
      commitDraftIfReady({ name: trimmed });
      return;
    }
    if (!trimmed || trimmed === routine.name) {
      setName(routine.name);
      return;
    }
    onUpdate({ name: trimmed });
  }

  function commitInstruction(): void {
    const trimmed = instruction.trim();
    if (isDraft) {
      commitDraftIfReady({ instruction: trimmed });
      return;
    }
    if (!trimmed || trimmed === routine.instruction) {
      setInstruction(routine.instruction);
      return;
    }
    onUpdate({ instruction: trimmed });
  }

  function changeTriggers(next: EditableTrigger[]): void {
    if (isDraft) {
      setDraftTriggers(next);
      commitDraftIfReady({ triggers: next });
      return;
    }
    // The routine routes require 1..8 triggers, so an emptied list is only held
    // in the card until the next trigger is added.
    if (next.length === 0) return;
    onUpdate({ triggers: next.map((trigger) => trigger.spec) });
  }

  function toggleEnabled(next: boolean): void {
    if (isDraft) {
      setDraftEnabled(next);
      return;
    }
    onUpdate({ enabled: next });
  }

  const history = routine ? routineRunHistory(routine, deliveriesByInstanceId) : [];

  const sectionHeading = (label: string) => (
    <h4 className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{label}</h4>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div
        className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b
          border-line bg-[var(--rail-surface)] px-4 py-2.5"
      >
        <label className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
          <Switch checked={enabled} disabled={togglePending} onCheckedChange={toggleEnabled} />
          Active
        </label>
        <div className="flex items-center gap-1.5">
          <button
            className="h-7 rounded-control px-2.5 text-[12px] font-medium text-ink-2
              transition-colors hover:bg-hover hover:text-red"
            onClick={() => setConfirmingDelete(true)}
            type="button"
          >
            Delete
          </button>
          <button
            className="h-7 rounded-control bg-ink px-2.5 text-[12px] font-medium text-surface
              transition-opacity disabled:opacity-50"
            disabled={isDraft || running}
            onClick={() => {
              onTestRun();
              historyRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            type="button"
          >
            {running ? "Running…" : "Test run"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        {saveFailed ? (
          <p className="rounded-control bg-red-tint px-2.5 py-1.5 text-[12px] text-red">
            Couldn't save this routine.
          </p>
        ) : null}

        <section className="flex flex-col gap-1.5">
          {sectionHeading("Name")}
          <input
            className="h-8 rounded-control border border-line-strong bg-transparent px-2.5
              text-[13px] text-ink outline-none placeholder:text-ink-3 focus-visible:border-accent"
            onBlur={commitName}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this routine"
            ref={nameRef}
            value={name}
          />
        </section>

        <section className="flex flex-col gap-1.5">
          {sectionHeading("Instruction")}
          <textarea
            className="min-h-[88px] rounded-control border border-line-strong bg-transparent
              px-2.5 py-2 text-[13px] leading-[1.45] text-ink outline-none
              placeholder:text-ink-3 focus-visible:border-accent"
            onBlur={commitInstruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="What should this routine do each time it runs?"
            value={instruction}
          />
        </section>

        <section className="flex flex-col gap-1.5">
          {sectionHeading("When to run")}
          <TriggerCard
            connectedInstance={connectedInstance}
            instances={instances}
            key={routine?.id ?? "draft"}
            onChange={changeTriggers}
            onConnectProvider={onConnectProvider}
            providers={providers}
            triggers={triggers}
          />
        </section>

        <section className="flex flex-col gap-1.5" ref={historyRef}>
          {sectionHeading("Run history")}
          {history.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">No runs yet</p>
          ) : (
            <div aria-label="Run history" className="flex flex-col gap-0.5" role="list">
              {history.map((entry) => {
                const icon =
                  entry.status === "running" ? (
                    <Spinner aria-label="Running" className="size-3.5 text-ink-2" />
                  ) : entry.status === "succeeded" ? (
                    <CheckIcon aria-label="Succeeded" className="size-3.5 text-green" role="img" />
                  ) : (
                    <XIcon aria-label="Failed" className="size-3.5 text-red" role="img" />
                  );
                const row = (
                  <>
                    <span className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink-2">
                      {relativeRunTime(entry.at)}
                    </span>
                    {icon}
                  </>
                );
                return entry.sessionId ? (
                  <button
                    className="flex h-8 items-center gap-2 rounded-control px-2 transition-colors
                      hover:bg-hover"
                    key={entry.id}
                    onClick={() => onSelectSession(entry.sessionId!)}
                    role="listitem"
                    title={entry.detail}
                    type="button"
                  >
                    {row}
                  </button>
                ) : (
                  <div
                    className="flex h-8 items-center gap-2 px-2"
                    key={entry.id}
                    role="listitem"
                    title={entry.detail}
                  >
                    {row}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <DialogSurface
        actions={
          <>
            <button onClick={() => setConfirmingDelete(false)} type="button">
              Cancel
            </button>
            <button
              className="primary destructive"
              onClick={() => {
                if (isDraft) {
                  setConfirmingDelete(false);
                  return;
                }
                onDelete();
              }}
              type="button"
            >
              Delete
            </button>
          </>
        }
        description="This permanently deletes the routine and stops all of its triggers. This can't be undone."
        onClose={() => setConfirmingDelete(false)}
        open={confirmingDelete}
        title={`Delete "${(routine?.name ?? name.trim()) || "this routine"}"`}
      >
        {deleteFailed ? (
          <p className="text-[12px] text-red">
            Deleting failed. Check your connection and try again.
          </p>
        ) : null}
      </DialogSurface>
    </div>
  );
}
