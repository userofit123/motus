// The Routine check's input from what the pages already load: a routine (with each exercise's library entry) as one
// workout of the check (packages/shared routineCheck.ts), and how often a routine is done in a week.
import type { CheckSession, Schedule } from "@motus/shared";
import { localYmd } from "./format";

export const sessionOf = (routine: any): CheckSession => (routine?.exercises ?? []).map((e: any) => ({
  name: e.exercise?.name ?? "", primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [],
  mechanic: e.exercise?.mechanic ?? null, force: e.exercise?.force ?? null, category: e.exercise?.category ?? "strength",
  superset: e.superset ?? null, sets: (e.sets ?? []).map((s: any) => ({ kind: s.kind, reps: s.reps ?? null })),
}));

/** Times a week, and where that comes from: its weekly planned days, else how often it was done in the last 4 weeks,
 *  else once */
export function timesAWeek(routineId: string, schedules: readonly Schedule[], workouts: readonly { startedAt: string }[]): { n: number; from: "plan" | "done" | "none" } {
  const today = localYmd(new Date());
  const planned = schedules.filter((s) => s.routineId === routineId && s.active !== false && s.rule === "weekly" && (!s.endDate || s.endDate.slice(0, 10) >= today))
    .reduce((t, s) => t + s.days.length, 0);
  if (planned) return { n: Math.min(7, planned), from: "plan" };
  const since = Date.now() - 28 * 86400_000;
  const done = workouts.filter((w) => new Date(w.startedAt).getTime() >= since).length;
  if (done) return { n: Math.max(1, Math.min(7, Math.round(done / 4))), from: "done" };
  return { n: 1, from: "none" };
}
