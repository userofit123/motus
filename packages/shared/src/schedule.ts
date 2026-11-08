// How a plan's repeat reads and which days a monthly plan falls on, shared by the engine (the calendar) and the apps
// (the schedule popup's summary line and a routine's list of plans), so both always say the same thing.
import type { Schedule } from "./types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/** The day of the month a monthly plan falls on in the month of `date`: the start date's day, or the month's last day
 * when that month is shorter (a plan on the 31st comes on 30 April and 28 or 29 February). */
export function monthlyDayIn(startDate: string, date: string): number {
  const want = +startDate.slice(8, 10), y = +date.slice(0, 4), m = +date.slice(5, 7);
  return Math.min(want, daysIn(y, m));
}

/** Whether a monthly plan starting on startDate falls on date (not before the start). */
export function onMonthlyDay(startDate: string, date: string): boolean {
  return date >= startDate && +date.slice(8, 10) === monthlyDayIn(startDate, date);
}

const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);

type Rule = Pick<Schedule, "rule" | "days" | "intervalDays" | "startDate"> & { endDate?: string | null; timeOfDay?: string | null };

/** One plain line for a plan, e.g. "Every Monday and Thursday, starting today, at 18:00".
 * `day` words a date ("today", "tomorrow", "Tue 10 Nov"); `start: false` leaves out when it starts (a routine's list). */
export function scheduleSummary(s: Rule, day: (ymd: string) => string, start = true): string {
  const days = [...(s.days ?? [])].sort((a, b) => a - b);
  const everyDay = (s.rule === "interval" && s.intervalDays === 1) || (s.rule === "weekly" && days.length === 7);
  let line: string;
  if (s.rule === "once") line = start ? `Once, ${day(s.startDate)}` : day(s.startDate);
  else {
    if (everyDay) line = "Every day";
    else if (s.rule === "weekly") line = days.length ? `Every ${andList(days.map((d) => DAY_NAMES[d] ?? ""))}` : "Every week";
    else if (s.rule === "monthly") { const n = +s.startDate.slice(8, 10); line = `Every month on the ${ordinal(n)}${n > 28 && start ? " (or the last day of a shorter month)" : ""}`; }
    else line = `Every ${s.intervalDays ?? 2} days`;
    if (start) line += `, starting ${day(s.startDate)}`;
    if (s.endDate) line += `, until ${day(s.endDate)}`;
  }
  return line + (s.timeOfDay ? `, at ${s.timeOfDay}` : "");
}
