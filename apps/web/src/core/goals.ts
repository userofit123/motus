// Goals shown at the top of Home (settings.home.goals, in order, each with or without its streak), and the words for a
// goal's period, shared by the goal's sheet, its card and the Home blocks.
import { daysIntoWeek, type Goal, type Settings } from "@motus/shared";
import { computed } from "vue";
import { makeFmt } from "./format";
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
