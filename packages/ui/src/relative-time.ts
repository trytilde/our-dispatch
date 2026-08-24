const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** 12-hour, locale-stable clock label ("7:00 AM"). */
export function clockLabel(hours: number, minutes: number): string {
  const meridiem = hours < 12 ? "AM" : "PM";
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

/**
 * Sentence-cased relative timestamp for run history rows: "Just now",
 * "5 min ago", "Today at 7:00 AM", "Mar 4 at 7:00 AM" (with the year
 * appended when it differs). Locale-stable by construction.
 */
export function relativeRunTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "";
  const elapsedMs = now.valueOf() - date.valueOf();
  if (elapsedMs < 60_000) return "Just now";
  if (elapsedMs < 3_600_000) return `${Math.floor(elapsedMs / 60_000)} min ago`;
  const time = clockLabel(date.getHours(), date.getMinutes());
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return `Today at ${time}`;
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  const year = date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`;
  return `${day}${year} at ${time}`;
}
