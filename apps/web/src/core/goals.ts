// Goals shown at the top of Home (settings.home.goals, in order, each with or without its streak), and the words for a
// goal's period, shared by the goal's sheet, its card and the Home blocks.
import { daysIntoWeek, workdaysOf, type Goal, type Settings } from "@motus/shared";
import { computed } from "vue";
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
const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === [...b].sort()[i]);
/** how often a goal counts, in words: "Every day", "Workdays", "Mon, Wed, Fri", "Every week"… */
export function periodLabel(g: Pick<Goal, "period" | "days">, s?: Pick<Settings, "workdays" | "firstDay">) {
  if (g.period === "week") return "Every week";
  if (g.period === "month") return "Every month";
  if (g.period !== "day") return "One-off";
  if (g.days === "workdays") return s ? `Workdays (${daysShort(workdaysOf(s), s.firstDay)})` : "Workdays";
  if (!Array.isArray(g.days) || !g.days.length || g.days.length === 7) return "Every day";
  if (s && sameDays([...g.days].sort(), workdaysOf(s))) return "Workdays";
  return daysShort(g.days, s?.firstDay ?? 0);
}
/** "Mon, Wed, Fri", in the order of the week as it starts in Settings (with a Monday start Sunday comes last) */
export const daysShort = (days: number[], firstDay: number) =>
  [...days].sort((a, b) => daysIntoWeek(a, firstDay) - daysIntoWeek(b, firstDay)).map((d) => WEEKDAYS[d]!.slice(0, 3)).join(", ");

/** The daily step goal: the active steps goal counted every day (or on chosen days), if there is one. */
export function useStepGoal() {
  const goals = useGoals();
  return computed(() => (goals.data.value ?? []).find((g) => g.status === "active" && g.metric === "steps_avg" && g.period === "day") ?? null);
}
