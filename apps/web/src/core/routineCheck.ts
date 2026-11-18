// The Routine check's input from what the pages already load: a routine (with each exercise's library entry) as one
// workout of the check (packages/shared routineCheck.ts), and how often a routine is done in a week.
import type { CheckSession, Routine, RoutineExercise, RoutineSet, Schedule } from "@motus/shared";
import { localYmd } from "./format";

export const sessionOf = (routine: Routine | null | undefined): CheckSession => (routine?.exercises ?? []).map((e: RoutineExercise) => ({
  name: e.exercise?.name ?? "", primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [],
  mechanic: e.exercise?.mechanic ?? null, force: e.exercise?.force ?? null, category: e.exercise?.category ?? "strength",
  superset: e.superset ?? null, sets: (e.sets ?? []).map((s: RoutineSet) => ({ kind: s.kind, reps: s.reps ?? null })),
}));

/** Times a week, and where that comes from: its plans that have started and not ended (weekly days, or every N days),
 *  else how often it was done in the last 4 weeks, else once */
export function timesAWeek(routineId: string, schedules: readonly Schedule[], workouts: readonly { startedAt: string }[]): { n: number; from: "plan" | "done" | "none" } {
  const today = localYmd(new Date());
  const planned = schedules.filter((s) => s.routineId === routineId && s.active !== false && s.startDate.slice(0, 10) <= today && (!s.endDate || s.endDate.slice(0, 10) >= today))
    .reduce((t, s) => t + (s.rule === "weekly" ? s.days.length : s.rule === "interval" && s.intervalDays ? 7 / s.intervalDays : 0), 0);
  if (planned) return { n: Math.max(1, Math.min(7, Math.round(planned))), from: "plan" };
  const since = Date.now() - 28 * 86400_000;
  const done = workouts.filter((w) => new Date(w.startedAt).getTime() >= since).length;
  if (done) return { n: Math.max(1, Math.min(7, Math.round(done / 4))), from: "done" };
  return { n: 1, from: "none" };
}
