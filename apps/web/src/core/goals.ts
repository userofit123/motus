// Goals shown at the top of Home (settings.home.goals, in order, each with or without its streak), and the words for a
// goal's period, shared by the goal's sheet, its card and the Home blocks.
import { daysIntoWeek, fromM, type Goal, type Settings } from "@motus/shared";
import { computed } from "vue";
import { makeFmt, ago, localYmd } from "./format";
import { saveSettings, useGoals } from "../api/queries";

export const onHome = (s: Settings, id: string) => s.home.goals.some((x) => x.id === id);
export const streakOnHome = (s: Settings, id: string) => !!s.home.goals.find((x) => x.id === id)?.streak;

/** shown at the end of the list; a weekly or monthly goal brings its streak along until it's switched off */
export function toggleHomeGoal(s: Settings, g: Pick<Goal, "id" | "period">) {
  const goals = onHome(s, g.id) ? s.home.goals.filter((x) => x.id !== g.id) : [...s.home.goals, { id: g.id, streak: g.period !== "once" }];
  return saveSettings({ home: { goals } }, { quiet: true });
}
export function setHomeStreak(s: Settings, id: string, streak: boolean) {
  return saveSettings({ home: { goals: s.home.goals.map((x) => (x.id === id ? { ...x, streak } : x)) } }, { quiet: true });
}

/** "day" / "week" / "month": what one step of a streak is called */
export const periodWord = (g: Pick<Goal, "period">, n = 1) => {
  const w = g.period === "month" ? "month" : g.period === "day" ? "day" : "week";
  return n === 1 ? w : w + "s";
};
/** a recurring goal's last periods, oldest first, each true when it reached the target; eight empty ones before it has any,
 * so the row of dots under its streak is never bare (Home's pinned goals and the goal cards) */
export const periodDots = (g: Pick<Goal, "target" | "progress">) =>
  g.progress?.history?.length ? g.progress.history.map((x) => x.value >= g.target) : Array<boolean>(8).fill(false);
/** a goal that counts again every day, week or month: it has a streak and ends on its periods' dots (Home and the goal cards) */
export const recurring = (g: Pick<Goal, "period">) => g.period !== "once";

type Fmt = ReturnType<typeof makeFmt>;
// the unit after a goal's number, as the stat tiles write it ("142.5 kg", "12,500 steps", "1 session")
const COUNT_UNITS: Record<string, [string, string]> = { sessions: ["session", "sessions"], times: ["time", "times"], workouts: ["workout", "workouts"], weeks: ["week", "weeks"], reps: ["rep", "reps"], sets: ["set", "sets"], steps: ["step", "steps"] };
/** a goal's number on its own, shown big with its unit small (Home's pinned goals and the goal cards); sleep in hours and
 * minutes as everywhere ("7h 30m"), its unit in the number */
export const goalValue = (g: Pick<Goal, "progress">, v: number, f: Fmt) => { const u = g.progress?.unit; return u === "h" ? f.dur(Math.round(v * 60) * 60, true) : u === "kg" ? f.w(v) : u === "km" ? f.num(fromM(v * 1000, f.du), 1) : u === "cm" ? f.len(v) : f.num(v, u === "min" || !!COUNT_UNITS[u ?? ""] ? 0 : 1); };
export const goalUnit = (g: Pick<Goal, "progress">, v: number, f: Fmt) => { const u = g.progress?.unit ?? ""; const c = COUNT_UNITS[u]; return c ? c[v === 1 ? 0 : 1] : u === "kg" ? f.wu : u === "km" ? f.du : u === "cm" ? f.lu : u === "h" ? "" : u; };
/** the line under that number names the target the same way for every goal: "of 150 kg" for goals that count up to it,
 * "Target 80 kg" for body goals (which can head up or down) and goals that must stay under it */
export const goalTarget = (g: Pick<Goal, "progress" | "scope" | "comparator" | "target">, f: Fmt) =>
  `${g.scope === "body" || g.comparator === "<=" ? "Target" : "of"} ${goalValue(g, g.target, f)} ${goalUnit(g, g.target, f)}`.trim();
/** the icon a goal shows in its tile's header, by what it is about */
export const goalIcon = (g: Pick<Goal, "scope" | "scopeId">) => ({ activity: g.scopeId === "workout" ? "dumbbell" : "walk", routine: "routines", exercise: "dumbbell", muscle: "activity", body: "scale" } as Record<string, string>)[g.scope] ?? "target";
/** the window a goal is counted over right now */
export const periodNow = (g: Pick<Goal, "period">) => (g.period === "day" ? "Today" : g.period === "week" ? "This week" : g.period === "month" ? "This month" : "So far");

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** the line under a goal's title: for a goal you named, its automatic title ("Walk 30 min a day"); a goal without a name has none,
 * its title already says how often it counts. A one-off goal with a deadline adds "By <date>". Empty when there is nothing to say. */
export const goalSub = (g: Pick<Goal, "period" | "name" | "summary" | "deadline">, s: Settings) => {
  const named = g.name && g.summary ? g.summary : "";
  const by = g.period === "once" && g.deadline ? `By ${makeFmt(s).date(g.deadline, { day: "numeric", month: "short", year: "numeric" })}` : "";
  return [named, by].filter(Boolean).join(" · ");
};
/** "Mon, Wed, Fri", in the order of the week as it starts in Settings (with a Monday start Sunday comes last) */
export const daysShort = (days: number[], firstDay: number) =>
  [...days].sort((a, b) => daysIntoWeek(a, firstDay) - daysIntoWeek(b, firstDay)).map((d) => WEEKDAYS[d]!.slice(0, 3)).join(", ");

/** The daily step goal: the active steps goal counted every day (or on chosen days), if there is one. */
export function useStepGoal() {
  const goals = useGoals();
  // a weekly or monthly average-daily-steps goal still targets a day's steps, so any active one counts, a daily one first
  return computed(() => {
    const gs = (goals.data.value ?? []).filter((g) => g.status === "active" && g.metric === "steps_avg");
    return gs.find((g) => g.period === "day") ?? gs[0] ?? null;
  });
}

// The second half of a goal tile (Home's pinned goals, the Goals page's cards). Both halves are built the same way, row by
// row: header, big value, a tiny line, then the bottom element. The big value stays short (a number and one word) so it
// fits the narrower half at 360px without being cut. A goal shown with its streak fills it with the streak; one without
// fills it with when: the day it was achieved, the days left to its deadline, or the day it started.
export type GoalSide = { icon: string; label: string; big: string; small?: string; sub: string };
const noon = (d: string) => d.slice(0, 10) + "T12:00:00"; // a calendar day read on this device's calendar, not as UTC midnight
// "Today", "Yesterday", "3 days ago", by this device's calendar
const agoCap = (iso: string) => { const a = ago(iso); return a.charAt(0).toUpperCase() + a.slice(1); };
export const goalSide = (g: Goal & { showStreak?: boolean }, f: Fmt): GoalSide => {
  const shortDate = (d: string) => f.date(noon(d), { day: "numeric", month: "short" });
  if (g.showStreak) {
    const n = g.progress?.streak ?? 0;
    return { icon: "flame", label: "Streak", big: String(n), small: periodWord(g, n), sub: "In a row" };
  }
  // the ring's tick shows it is done; this half names the day
  if (g.status === "achieved" && g.achievedAt) return { icon: "check", label: "Done on", big: f.date(g.achievedAt, { day: "numeric", month: "short" }), sub: agoCap(g.achievedAt) };
  if (g.deadline && g.status !== "achieved" && !g.progress?.done) {
    // calendar days left with today counted, as the goal's own pace says
    const d = Math.round((Date.parse(g.deadline.slice(0, 10)) - Date.parse(localYmd(new Date()))) / 86400000) + 1;
    return d > 0 ? { icon: "calendar", label: "Days left", big: String(d), sub: `Ends ${shortDate(g.deadline)}` }
      : { icon: "calendar", label: "Deadline", big: shortDate(g.deadline), sub: "Deadline passed" };
  }
  return { icon: "calendar", label: "Started", big: shortDate(g.startDate), sub: agoCap(noon(g.startDate)) };
};
/** the bottom of that half: a recurring goal's periods as dots (periodDots), a one-off goal's trend line; with nothing to
 * draw (fewer than two points, or all zero) a flat line, so the half is never bare */
export const goalTrend = (g: Pick<Goal, "progress">) => (g.progress?.history ?? []).map((x) => x.value);
export const hasTrend = (g: Pick<Goal, "progress">) => { const t = goalTrend(g); return t.length > 1 && t.some((v) => v); };
