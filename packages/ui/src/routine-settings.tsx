import { useMemo, useState } from "react";
import { MoreHorizontalIcon, SearchIcon } from "lucide-react";
import { routineDetail, type Routine, type SignalProvider } from "@tryopenbot/client-runtime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";
import { relativeRunTime } from "./relative-time.js";
import { DialogSurface } from "./overlay-components.js";

export interface RoutineSettingsRow {
  routine: Routine;
  botName: string;
}

export interface RoutineSettingsProps {
  rows: readonly RoutineSettingsRow[];
  providers: readonly SignalProvider[];
  settled: boolean;
  error?: string;
  onCreate: () => void;
  onEdit: (routine: Routine) => void;
  onToggle: (routine: Routine, enabled: boolean) => void;
  onDelete: (routine: Routine) => void;
}

type StatusFilter = "all" | "enabled" | "paused";

export function RoutineSettings({
  rows,
  providers,
  settled,
  error,
  onCreate,
  onEdit,
  onToggle,
  onDelete,
}: RoutineSettingsProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [bot, setBot] = useState("all");
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const bots = useMemo(
    () => [...new Set(rows.map((row) => row.botName))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(({ routine, botName }) => {
      if (status === "enabled" && !routine.enabled) return false;
      if (status === "paused" && routine.enabled) return false;
      if (bot !== "all" && botName !== bot) return false;
      return (
        !needle ||
        `${routine.name} ${routine.instruction} ${botName}`.toLowerCase().includes(needle)
      );
    });
  }, [bot, query, rows, status]);

  return (
    <section aria-label="Routines" className="mt-10 flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 max-[720px]:items-start">
        <div>
          <h2 className="m-0 text-[15px] font-semibold text-ink">Routines</h2>
          <p className="mt-1 mb-0 text-[12.5px] text-ink-3">
            Tasks your bots run on a schedule or when a connected service changes.
          </p>
        </div>
        <button
          className="h-9 shrink-0 rounded-control bg-ink px-3.5 text-[12.5px] font-medium text-surface"
          onClick={onCreate}
          type="button"
        >
          Create routine
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-control border border-line bg-surface px-3">
          <SearchIcon aria-hidden className="size-4 text-ink-3" />
          <span className="sr-only">Search routines</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none max-[720px]:text-base"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search routines"
            type="search"
            value={query}
          />
        </label>
        <select
          aria-label="Routine status"
          className="h-9 rounded-control border border-line bg-surface px-2.5 text-[12.5px] text-ink"
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          value={status}
        >
          <option value="all">All statuses</option>
          <option value="enabled">Enabled</option>
          <option value="paused">Paused</option>
        </select>
        <select
          aria-label="Routine bot"
          className="h-9 rounded-control border border-line bg-surface px-2.5 text-[12.5px] text-ink"
          onChange={(event) => setBot(event.target.value)}
          value={bot}
        >
          <option value="all">All bots</option>
          {bots.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="m-0 text-[12px] text-red">{error}</p> : null}
      <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
        <div className="grid grid-cols-[minmax(180px,1.5fr)_minmax(110px,.7fr)_minmax(180px,1fr)_90px_110px_40px] gap-3 border-b border-line px-4 py-2 text-[10px] font-semibold uppercase tracking-[.06em] text-ink-3 max-[760px]:hidden">
          <span>Routine</span>
          <span>Bot</span>
          <span>Starts when</span>
          <span>Status</span>
          <span>Last run</span>
          <span />
        </div>
        {filtered.map(({ routine, botName }) => (
          <div
            className="grid min-h-14 grid-cols-[minmax(180px,1.5fr)_minmax(110px,.7fr)_minmax(180px,1fr)_90px_110px_40px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 max-[760px]:grid-cols-[1fr_auto] max-[760px]:gap-x-2 max-[760px]:gap-y-1"
            key={routine.id}
          >
            <button className="min-w-0 text-left" onClick={() => onEdit(routine)} type="button">
              <strong className="block truncate text-[13px] font-medium text-ink">
                {routine.name}
              </strong>
              <small className="block truncate text-[11.5px] text-ink-3">
                {routine.instruction}
              </small>
            </button>
            <span className="truncate text-[12.5px] text-ink-2 max-[760px]:col-start-1 max-[760px]:row-start-2">
              {botName}
            </span>
            <span className="truncate text-[12px] text-ink-2 max-[760px]:col-start-1">
              {routineDetail(routine, [...providers])}
            </span>
            <span
              className={`w-fit rounded-full px-2 py-0.5 text-[10.5px] font-medium ${routine.enabled ? "bg-green/10 text-green" : "bg-hover text-ink-3"}`}
            >
              {routine.enabled ? "Enabled" : "Paused"}
            </span>
            <span className="text-[11.5px] text-ink-3 max-[760px]:hidden">
              {routine.last_run_at ? relativeRunTime(routine.last_run_at) : "Not run"}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Actions for ${routine.name}`}
                  className="grid size-8 place-items-center rounded-control text-ink-3 hover:bg-hover"
                  type="button"
                >
                  <MoreHorizontalIcon aria-hidden className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(routine)}>Edit</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onToggle(routine, !routine.enabled)}>
                  {routine.enabled ? "Pause" : "Enable"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red data-[highlighted]:text-red"
                  onSelect={() => setDeleting(routine)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {filtered.length === 0 && settled ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-ink-3">
            {rows.length === 0 ? "No routines yet." : "No routines match these filters."}
          </div>
        ) : null}
      </div>
      <DialogSurface
        actions={
          <>
            <button onClick={() => setDeleting(null)} type="button">
              Cancel
            </button>
            <button
              className="primary destructive"
              onClick={() => {
                if (deleting) onDelete(deleting);
                setDeleting(null);
              }}
              type="button"
            >
              Delete
            </button>
          </>
        }
        description="This removes the routine and stops all future runs. This can't be undone."
        onClose={() => setDeleting(null)}
        open={deleting !== null}
        title={`Delete "${deleting?.name ?? ""}"?`}
      />
    </section>
  );
}
