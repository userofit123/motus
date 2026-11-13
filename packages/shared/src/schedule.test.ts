import { describe, expect, it } from "vitest";
import { monthlyDayIn, onMonthlyDay, scheduleSummary } from "./schedule";

const day = (d: string) => (d === "2026-11-08" ? "today" : d === "2026-11-09" ? "tomorrow" : d);

describe("schedule", () => {
  it("falls on the start date's day each month, or the last day of a shorter month", () => {
    expect(monthlyDayIn("2026-01-31", "2026-02-10")).toBe(28);
    expect(monthlyDayIn("2026-01-31", "2028-02-10")).toBe(29);
    expect(monthlyDayIn("2026-01-30", "2026-04-01")).toBe(30);
    expect(onMonthlyDay("2026-01-31", "2026-04-30")).toBe(true);
    expect(onMonthlyDay("2026-01-31", "2026-04-29")).toBe(false);
    expect(onMonthlyDay("2026-03-31", "2026-02-28")).toBe(false); // before it starts
  });

  it("says in one line what will happen", () => {
    const base = { days: [], intervalDays: null, startDate: "2026-11-08" };
    expect(scheduleSummary({ ...base, rule: "once" }, day, 0)).toBe("Once, today");
    expect(scheduleSummary({ ...base, rule: "weekly", days: [4, 1] }, day, 0)).toBe("Every Monday and Thursday, starting today");
    expect(scheduleSummary({ ...base, rule: "weekly", days: [0, 1, 2, 3, 4, 5, 6] }, day, 0)).toBe("Every day, starting today");
    expect(scheduleSummary({ ...base, rule: "interval", intervalDays: 3, startDate: "2026-11-09", timeOfDay: "18:00" }, day, 0)).toBe("Every 3 days, starting tomorrow, at 18:00");
    expect(scheduleSummary({ ...base, rule: "monthly", endDate: "2027-05-08" }, day, 0)).toBe("Every month on the 8th, starting today, until 2027-05-08");
    expect(scheduleSummary({ ...base, rule: "monthly", startDate: "2026-12-31" }, day, 0)).toBe("Every month on the 31st (or the last day of a shorter month), starting 2026-12-31");
    expect(scheduleSummary({ ...base, rule: "monthly", startDate: "2026-12-22" }, day, 0, false)).toBe("Every month on the 22nd");
  });

  it("lists the days in the order the week starts on", () => {
    const base = { rule: "weekly" as const, days: [1, 0, 3], intervalDays: null, startDate: "2026-11-08" };
    expect(scheduleSummary(base, day, 0, false)).toBe("Every Sunday, Monday and Wednesday");
    expect(scheduleSummary(base, day, 1, false)).toBe("Every Monday, Wednesday and Sunday");
  });
});
