import { describe, expect, it } from "vite-plus/test";
import { isValidTildeSchedule } from "@tryopenbot/client-runtime";
import {
  buildSchedule,
  customScheduleCommit,
  parseSchedule,
  scheduleSpecSentence,
  toggleDay,
  toggleMonth,
} from "./schedule-editor.js";

describe("parseSchedule", () => {
  it("recognizes the preset modes", () => {
    expect(parseSchedule("30 * * * *")).toMatchObject({ mode: "hourly", minute: 30 });
    expect(parseSchedule("0 7 * * *")).toMatchObject({ mode: "daily", minute: 0, hour: 7 });
    expect(parseSchedule("15 9 * * MON-FRI")).toMatchObject({
      mode: "weekdays",
      minute: 15,
      hour: 9,
    });
    expect(parseSchedule("0 9 * * WED")).toMatchObject({ mode: "weekly", dayOfWeek: 3 });
    expect(parseSchedule("0 9 15 * *")).toMatchObject({ mode: "monthly", dayOfMonth: 15 });
  });

  it("reads days written as upstream numbers, where 1 is Sunday", () => {
    expect(parseSchedule("0 9 * * 1")).toMatchObject({ mode: "weekly", dayOfWeek: 0 });
    expect(parseSchedule("0 9 * * 2")).toMatchObject({ mode: "weekly", dayOfWeek: 1 });
    expect(parseSchedule("0 9 * * 7")).toMatchObject({ mode: "weekly", dayOfWeek: 6 });
    expect(parseSchedule("15 9 * * 2-6")).toMatchObject({ mode: "weekdays" });
    expect(parseSchedule("0 9 * * 0").mode).toBe("custom");
  });

  it("round-trips every weekday selection back to the same day", () => {
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      const expression = buildSchedule({ ...parseSchedule("0 9 * * MON"), dayOfWeek });
      expect(isValidTildeSchedule(expression)).toBe(true);
      expect(parseSchedule(expression)).toMatchObject({ mode: "weekly", dayOfWeek });
    }
  });

  it("maps list fields to advanced and keeps them round-trippable", () => {
    const parsed = parseSchedule("0 7 * 1,6 MON,WED");
    expect(parsed.mode).toBe("advanced");
    expect(parsed.months).toEqual([1, 6]);
    expect(parsed.days).toEqual({ kind: "days-of-week", days: [1, 3] });
    expect(buildSchedule(parsed)).toBe("0 7 * 1,6 MON,WED");
    expect(parseSchedule("0 7 * 1,6 2,4").days).toEqual({ kind: "days-of-week", days: [1, 3] });
  });

  it("lands unrepresentable expressions in custom", () => {
    expect(parseSchedule("*/5 * * * *").mode).toBe("custom");
    expect(parseSchedule("0 7 1 * 1").mode).toBe("custom");
    expect(parseSchedule("0 7 * * *  extra").mode).toBe("custom");
  });
});

describe("buildSchedule", () => {
  it("renders each preset mode", () => {
    expect(buildSchedule(parseSchedule("0 * * * *"))).toBe("0 * * * *");
    expect(buildSchedule(parseSchedule("45 18 * * MON-FRI"))).toBe("45 18 * * MON-FRI");
    expect(buildSchedule(parseSchedule("0 9 1 * *"))).toBe("0 9 1 * *");
    expect(buildSchedule(parseSchedule("0 9 * * SUN"))).toBe("0 9 * * SUN");
  });

  it("only writes schedules upstream accepts", () => {
    for (const expression of [
      "0 * * * *",
      "45 18 * * MON-FRI",
      "0 9 * * SUN",
      "0 9 1 * *",
      "0 7 * 1,6 MON,WED",
    ])
      expect(isValidTildeSchedule(buildSchedule(parseSchedule(expression)))).toBe(true);
  });
});

describe("scheduleSpecSentence", () => {
  it("reads as a lead/rest sentence in UTC", () => {
    expect(scheduleSpecSentence("0 7 * * *")).toEqual({
      lead: "Every",
      rest: "day at 7:00 AM UTC",
    });
    expect(scheduleSpecSentence("0 13 * * MON")).toEqual({
      lead: "Every",
      rest: "Monday at 1:00 PM UTC",
    });
    expect(scheduleSpecSentence("0 13 * * SUN")).toEqual({
      lead: "Every",
      rest: "Sunday at 1:00 PM UTC",
    });
    expect(scheduleSpecSentence("*/7 * * * *")).toEqual({ lead: "Cron", rest: "*/7 * * * *" });
  });
});

describe("customScheduleCommit", () => {
  it("withdraws a committed expression once it is edited into an invalid state", () => {
    expect(customScheduleCommit(" 0 9 * * 1 ")).toEqual({ schedule: "0 9 * * 1", valid: true });
    expect(customScheduleCommit("0 9 * * 1x")).toEqual({ schedule: "0 9 * * 1x", valid: false });
    expect(customScheduleCommit("")).toEqual({ schedule: "", valid: false });
  });
});

describe("toggleDay", () => {
  it("keeps the last selection so an advanced schedule never means every day", () => {
    expect(toggleDay([2, 4], 4)).toEqual([2]);
    expect(toggleDay([4], 4)).toEqual([4]);
    expect(toggleDay([4], 2)).toEqual([4, 2]);
    expect(
      buildSchedule({
        ...parseSchedule("0 7 * * THU"),
        mode: "advanced",
        days: { kind: "days-of-week", days: toggleDay([4], 4) },
      }),
    ).toBe("0 7 * * THU");
  });
});

describe("toggleMonth", () => {
  it("allows clearing every month back to any month", () => {
    expect(toggleMonth([6], 6)).toEqual([]);
  });
});
