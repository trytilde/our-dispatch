import { CirclePauseIcon, ClockIcon } from "lucide-react";
import { routineDetail, type Routine, type SignalProvider } from "@tryopenbot/client-runtime";

/**
 * The details pane's Routines overview: a flush two-line list, enabled
 * routines first, with a settled-only empty state.
 */

export interface RoutinesSectionProps {
  routines: readonly Routine[];
  providers: readonly SignalProvider[];
  /** True once the first load resolved; the empty state never flashes mid-load. */
  settled: boolean;
  onCreate: () => void;
  onOpen: (routineId: string) => void;
}

export function RoutinesSection({
  routines,
  providers,
  settled,
  onCreate,
  onOpen,
}: RoutinesSectionProps) {
  const sorted = [...routines].sort((a, b) => Number(b.enabled) - Number(a.enabled));
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2.5">
      {sorted.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {sorted.map((routine) => (
            <button
              className="flex w-full items-center gap-2.5 rounded-control px-1.5 py-2 text-left
                transition-colors hover:bg-hover"
              key={routine.id}
              onClick={() => onOpen(routine.id)}
              type="button"
            >
              {routine.enabled ? (
                <ClockIcon aria-hidden className="size-4 shrink-0 text-ink-2" />
              ) : (
                <CirclePauseIcon aria-hidden className="size-4 shrink-0 text-ink-3" />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[12.5px] font-medium text-ink">{routine.name}</span>
                <span className="truncate text-[12px] text-ink-2">
                  {routineDetail(routine, [...providers])}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : settled ? (
        <div className="flex flex-col items-start gap-3 px-1.5 py-3">
          <p className="text-[12.5px] leading-[1.5] text-ink-2">
            Routines are recurring tasks this agent runs on a schedule or when something happens in
            a connected tool.
          </p>
          <button
            className="h-8 rounded-control border border-line-strong px-3 text-[12.5px]
              font-medium text-ink transition-colors hover:bg-hover"
            onClick={onCreate}
            type="button"
          >
            Create your first routine
          </button>
        </div>
      ) : null}
    </section>
  );
}
