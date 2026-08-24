import { useState, type ReactNode } from "react";
import { CRON_DAY_NAMES, isValidTildeSchedule } from "@tryopenbot/client-runtime";
import { clockLabel } from "./relative-time.js";
import { SelectField, type SelectOption } from "./primitive-components.js";

/**
 * Schedule trigger fields: a Frequency select plus dependent time controls,
 * all UTC. Parsing keeps externally authored crons editable by injecting
 * off-grid values into the option lists; anything unrepresentable lands in
 * Custom. Pure cron helpers are exported for reuse and tests.
 *
 * Days of the week are held as JavaScript day numbers (Sunday=0) and written
 * as three-letter cron names, because upstream numbers them 1..7 from Sunday.
 */

export type ScheduleMode =
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "advanced"
  | "custom";

export type AdvancedDays =
  | { kind: "every-day" }
  | { kind: "days-of-week"; days: number[] }
  | { kind: "days-of-month"; days: number[] };

export interface ScheduleDraft {
  mode: ScheduleMode;
  minute: number;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  months: number[];
  days: AdvancedDays;
  /** Raw expression, authoritative for "custom". */
  expression: string;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const defaultDraft: ScheduleDraft = {
  mode: "daily",
  minute: 0,
  hour: 9,
  dayOfWeek: 1,
  dayOfMonth: 1,
  months: [],
  days: { kind: "every-day" },
  expression: "0 9 * * *",
};

function asNumber(field: string, max: number): number | undefined {
  if (!/^\d+$/.test(field)) return undefined;
  const value = Number(field);
  return value <= max ? value : undefined;
}

function asNumberList(field: string, max: number): number[] | undefined {
  if (field === "*") return [];
  const parts = field.split(",");
  const values: number[] = [];
  for (const part of parts) {
    const value = asNumber(part, max);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

/** A single day-of-week token, by name or upstream number, as a JS day. */
function asDay(token: string): number | undefined {
  const name = CRON_DAY_NAMES.indexOf(token.toUpperCase() as (typeof CRON_DAY_NAMES)[number]);
  if (name >= 0) return name;
  if (!/^\d+$/.test(token)) return undefined;
  const value = Number(token);
  return value >= 1 && value <= 7 ? value - 1 : undefined;
}

function asDayList(field: string): number[] | undefined {
  if (field === "*") return [];
  const values: number[] = [];
  for (const part of field.split(",")) {
    const value = asDay(part);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

/** Monday-to-Friday, written by name or by upstream numbers. */
function isWeekdayRange(field: string): boolean {
  const normalized = field.toLowerCase();
  return normalized === "mon-fri" || normalized === "2-6";
}

function dayNameList(days: readonly number[]): string {
  return days.length > 0
    ? [...days]
        .sort((a, b) => a - b)
        .map((day) => CRON_DAY_NAMES[day] ?? "")
        .join(",")
    : "*";
}

/** Parse a 5-field cron into structured schedule fields; "custom" otherwise. */
export function parseSchedule(expression: string): ScheduleDraft {
  const custom: ScheduleDraft = { ...defaultDraft, mode: "custom", expression };
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return custom;
  const [minuteField = "", hourField = "", domField = "", monthField = "", dowField = ""] = fields;
  const minute = asNumber(minuteField, 59);
  if (minute === undefined) return custom;
  const base = { ...defaultDraft, minute, expression };
  if (hourField === "*" && domField === "*" && monthField === "*" && dowField === "*") {
    return { ...base, mode: "hourly" };
  }
  const hour = asNumber(hourField, 23);
  if (hour === undefined) return custom;
  const timed = { ...base, hour };
  if (domField === "*" && monthField === "*") {
    if (dowField === "*") return { ...timed, mode: "daily" };
    if (isWeekdayRange(dowField)) return { ...timed, mode: "weekdays" };
    const dayOfWeek = asDay(dowField);
    if (dayOfWeek !== undefined) return { ...timed, mode: "weekly", dayOfWeek };
  }
  if (monthField === "*" && dowField === "*") {
    const dayOfMonth = asNumber(domField, 31);
    if (dayOfMonth !== undefined && dayOfMonth >= 1) {
      return { ...timed, mode: "monthly", dayOfMonth };
    }
  }
  const months = asNumberList(monthField, 12);
  const daysOfMonth = asNumberList(domField, 31);
  const daysOfWeek = asDayList(dowField);
  if (
    months &&
    daysOfMonth &&
    daysOfWeek &&
    (daysOfMonth.length === 0 || daysOfWeek.length === 0)
  ) {
    const days: AdvancedDays =
      daysOfWeek.length > 0
        ? { kind: "days-of-week", days: daysOfWeek }
        : daysOfMonth.length > 0
          ? { kind: "days-of-month", days: daysOfMonth }
          : { kind: "every-day" };
    return { ...timed, mode: "advanced", months, days };
  }
  return custom;
}

/** Render structured schedule fields back into a Tilde-valid cron. */
export function buildSchedule(draft: ScheduleDraft): string {
  const list = (values: number[]) =>
    values.length > 0 ? [...values].sort((a, b) => a - b).join(",") : "*";
  switch (draft.mode) {
    case "hourly":
      return `${draft.minute} * * * *`;
    case "daily":
      return `${draft.minute} ${draft.hour} * * *`;
    case "weekdays":
      return `${draft.minute} ${draft.hour} * * MON-FRI`;
    case "weekly":
      return `${draft.minute} ${draft.hour} * * ${CRON_DAY_NAMES[draft.dayOfWeek] ?? "MON"}`;
    case "monthly":
      return `${draft.minute} ${draft.hour} ${draft.dayOfMonth} * *`;
    case "advanced": {
      const dom = draft.days.kind === "days-of-month" ? list(draft.days.days) : "*";
      const dow = draft.days.kind === "days-of-week" ? dayNameList(draft.days.days) : "*";
      return `${draft.minute} ${draft.hour} ${dom} ${list(draft.months)} ${dow}`;
    }
    case "custom":
      return draft.expression;
  }
}

/**
 * Buffered commit for the Custom field. Text that cannot be saved withdraws the
 * value instead of leaving the last valid intermediate committed, so dismissing
 * the popover never persists a schedule the field no longer shows.
 */
export function customScheduleCommit(text: string): { schedule: string; valid: boolean } {
  const trimmed = text.trim();
  return { schedule: trimmed, valid: isValidTildeSchedule(trimmed) };
}

/** Lead/rest sentence for a locally edited cron, without a server description. */
export function scheduleSpecSentence(expression: string): { lead: string; rest: string } {
  const draft = parseSchedule(expression);
  const time = clockLabel(draft.hour, draft.minute);
  switch (draft.mode) {
    case "hourly":
      return { lead: "Every", rest: `hour at :${String(draft.minute).padStart(2, "0")} UTC` };
    case "daily":
      return { lead: "Every", rest: `day at ${time} UTC` };
    case "weekdays":
      return { lead: "Weekdays", rest: `at ${time} UTC` };
    case "weekly":
      return { lead: "Every", rest: `${DAY_NAMES[draft.dayOfWeek]} at ${time} UTC` };
    case "monthly":
      return { lead: "Monthly", rest: `on the ${ordinal(draft.dayOfMonth)} at ${time} UTC` };
    case "advanced":
      return { lead: "Custom", rest: `schedule at ${time} UTC` };
    case "custom":
      return { lead: "Cron", rest: expression };
  }
}

function ordinal(day: number): string {
  const rest = day % 100;
  if (rest >= 11 && rest <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** Months are optional; a day selection is not, so the last one cannot be cleared. */
export function toggleMonth(values: readonly number[], value: number): number[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

export function toggleDay(values: readonly number[], value: number): number[] {
  if (!values.includes(value)) return [...values, value];
  return values.length === 1 ? [...values] : values.filter((candidate) => candidate !== value);
}

export function timeOptionsWith(minute: number, hour: number): SelectOption[] {
  const options: SelectOption[] = [];
  for (let slot = 0; slot < 24 * 4; slot += 1) {
    options.push(timeOption(Math.floor(slot / 4), (slot % 4) * 15));
  }
  const value = `${hour}:${minute}`;
  if (!options.some((option) => option.value === value)) {
    options.push(timeOption(hour, minute));
    options.sort((a, b) => timeRank(a.value) - timeRank(b.value));
  }
  return options;
}

function timeOption(hour: number, minute: number): SelectOption {
  return { value: `${hour}:${minute}`, label: clockLabel(hour, minute) };
}

function timeRank(value: string): number {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function minuteOptionsWith(minute: number): SelectOption[] {
  const values = new Set(Array.from({ length: 12 }, (_, index) => index * 5));
  values.add(minute);
  return [...values]
    .sort((a, b) => a - b)
    .map((value) => ({ value: String(value), label: `:${String(value).padStart(2, "0")}` }));
}

const frequencyOptions: SelectOption[] = [
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "advanced", label: "Advanced" },
  { value: "custom", label: "Custom" },
];

const dayOfWeekOptions: SelectOption[] = [1, 2, 3, 4, 5, 6, 0].map((day) => ({
  value: String(day),
  label: DAY_NAMES[day] ?? "",
}));

const dayOfMonthOptions: SelectOption[] = Array.from({ length: 31 }, (_, index) => ({
  value: String(index + 1),
  label: ordinal(index + 1),
}));

export interface ScheduleEditorProps {
  schedule: string;
  /** `valid` is false while the typed custom expression cannot be saved. */
  onChange: (schedule: string, valid: boolean) => void;
  /** Force the initial Frequency mode (the add menu's Advanced… entry). */
  initialMode?: ScheduleMode;
}

export function ScheduleEditor({ schedule, onChange, initialMode }: ScheduleEditorProps) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => {
    const parsed = parseSchedule(schedule);
    return initialMode && initialMode !== "custom" ? { ...parsed, mode: initialMode } : parsed;
  });
  const [customText, setCustomText] = useState(schedule);
  const [customInvalid, setCustomInvalid] = useState(false);

  function commit(next: ScheduleDraft): void {
    setDraft(next);
    if (next.mode !== "custom") onChange(buildSchedule(next), true);
  }

  /**
   * Commit as soon as the typed expression is valid so an outside dismissal —
   * which unmounts this input before blur fires — cannot lose it. Editing a
   * committed expression back into an invalid state withdraws it again, so a
   * close cannot persist a value the field no longer shows. Invalid input only
   * flags itself once the field is left.
   */
  function commitCustom(text: string, flagInvalid: boolean): void {
    const { schedule, valid } = customScheduleCommit(text);
    if (!valid) {
      if (flagInvalid) setCustomInvalid(true);
      onChange(schedule, false);
      return;
    }
    setCustomInvalid(false);
    setDraft((current) => ({ ...current, expression: schedule }));
    onChange(schedule, true);
  }

  const time = (
    <SelectField
      ariaLabel="Time (UTC)"
      onChange={(event) => {
        const [hour = 0, minute = 0] = event.target.value.split(":").map(Number);
        commit({ ...draft, hour, minute });
      }}
      options={timeOptionsWith(draft.minute, draft.hour)}
      value={`${draft.hour}:${draft.minute}`}
    />
  );
  const connector = (word: string) => <span className="text-[12.5px] text-ink-3">{word}</span>;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          ariaLabel="Frequency"
          onChange={(event) => {
            const mode = event.target.value as ScheduleMode;
            if (mode === "custom") {
              setCustomText(buildSchedule(draft));
              setCustomInvalid(false);
              setDraft({ ...draft, mode });
              return;
            }
            commit({ ...draft, mode });
          }}
          options={frequencyOptions}
          value={draft.mode}
        />
        {draft.mode === "hourly" ? (
          <>
            {connector("at")}
            <SelectField
              ariaLabel="Minute (UTC)"
              onChange={(event) => commit({ ...draft, minute: Number(event.target.value) })}
              options={minuteOptionsWith(draft.minute)}
              value={String(draft.minute)}
            />
          </>
        ) : null}
        {draft.mode === "daily" || draft.mode === "weekdays" ? (
          <>
            {connector("at")}
            {time}
          </>
        ) : null}
        {draft.mode === "weekly" ? (
          <>
            {connector("on")}
            <SelectField
              ariaLabel="Day of week"
              onChange={(event) => commit({ ...draft, dayOfWeek: Number(event.target.value) })}
              options={dayOfWeekOptions}
              value={String(draft.dayOfWeek)}
            />
            {connector("at")}
            {time}
          </>
        ) : null}
        {draft.mode === "monthly" ? (
          <>
            {connector("on the")}
            <SelectField
              ariaLabel="Day of month"
              onChange={(event) => commit({ ...draft, dayOfMonth: Number(event.target.value) })}
              options={dayOfMonthOptions}
              value={String(draft.dayOfMonth)}
            />
            {connector("at")}
            {time}
          </>
        ) : null}
        {draft.mode === "custom" ? (
          <input
            aria-invalid={customInvalid || undefined}
            aria-label="Schedule"
            className="h-8 min-w-[180px] flex-1 rounded-control border border-line-strong bg-transparent px-2.5
              text-[12.5px] text-ink outline-none focus-visible:border-accent
              aria-invalid:border-red"
            onBlur={() => commitCustom(customText, true)}
            onChange={(event) => {
              setCustomText(event.target.value);
              commitCustom(event.target.value, false);
            }}
            spellCheck={false}
            value={customText}
          />
        ) : null}
      </div>
      {draft.mode === "advanced" ? (
        <AdvancedScheduleFields draft={draft} onCommit={commit} time={time} />
      ) : null}
    </div>
  );
}

function AdvancedScheduleFields({
  draft,
  onCommit,
  time,
}: {
  draft: ScheduleDraft;
  onCommit: (next: ScheduleDraft) => void;
  time: ReactNode;
}) {
  const daysKind = draft.days.kind;
  const selectedDays = daysKind === "every-day" ? [] : draft.days.days;

  const chip = (selected: boolean) =>
    `h-7 rounded-control px-2 text-[12px] transition-colors ${
      selected ? "bg-hover-2 text-ink" : "text-ink-2 hover:bg-hover"
    }`;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-ink-3">Months</span>
        <div className="flex flex-wrap gap-1">
          <button
            className={chip(draft.months.length === 0)}
            onClick={() => onCommit({ ...draft, months: [] })}
            type="button"
          >
            Any month
          </button>
          {MONTH_NAMES.map((name, index) => (
            <button
              className={chip(draft.months.includes(index + 1))}
              key={name}
              onClick={() => onCommit({ ...draft, months: toggleMonth(draft.months, index + 1) })}
              type="button"
            >
              {name.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-ink-3">Days</span>
        <div className="flex flex-wrap items-center gap-2">
          <SelectField
            ariaLabel="Days"
            onChange={(event) => {
              const kind = event.target.value as AdvancedDays["kind"];
              onCommit({
                ...draft,
                days:
                  kind === "every-day"
                    ? { kind }
                    : {
                        kind,
                        days: [kind === "days-of-week" ? draft.dayOfWeek : draft.dayOfMonth],
                      },
              });
            }}
            options={[
              { value: "every-day", label: "Every day" },
              { value: "days-of-week", label: "Days of the week" },
              { value: "days-of-month", label: "Days of the month" },
            ]}
            value={daysKind}
          />
        </div>
        {daysKind === "days-of-week" ? (
          <div className="flex flex-wrap gap-1">
            {DAY_NAMES.map((name, day) => (
              <button
                className={chip(selectedDays.includes(day))}
                key={name}
                onClick={() =>
                  onCommit({
                    ...draft,
                    days: { kind: daysKind, days: toggleDay(selectedDays, day) },
                  })
                }
                type="button"
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>
        ) : null}
        {daysKind === "days-of-month" ? (
          <div className="flex max-w-[320px] flex-wrap gap-1">
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <button
                className={chip(selectedDays.includes(day))}
                key={day}
                onClick={() =>
                  onCommit({
                    ...draft,
                    days: { kind: daysKind, days: toggleDay(selectedDays, day) },
                  })
                }
                type="button"
              >
                {day}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-ink-3">Time (UTC)</span>
        <div className="flex items-center gap-2">{time}</div>
      </div>
    </div>
  );
}
