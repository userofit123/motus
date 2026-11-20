// The Routine check's input from what the pages already load: a routine (with each exercise's library entry) as one
// workout of the check (packages/shared routineCheck.ts), each set with the rest the routine plans after it (plannedRest,
// the rule the routine page and the workout use) when the person's workout settings are given. A superset's exercises
// get no rest: they take turns, so their rests are not the time between one lift's sets.
import { restDefaultsOf, type CheckSession, type Routine, type RoutineExercise, type RoutineSet, type WorkoutPrefs } from "@motus/shared";
import { plannedRest } from "./plannedRest";

export const sessionOf = (routine: Routine | null | undefined, w?: WorkoutPrefs): CheckSession => {
  const d = w ? restDefaultsOf(w) : null;
  return (routine?.exercises ?? []).map((e: RoutineExercise) => ({
    name: e.exercise?.name ?? "", primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [],
    mechanic: e.exercise?.mechanic ?? null, force: e.exercise?.force ?? null, category: e.exercise?.category ?? "strength",
    superset: e.superset ?? null,
    sets: (e.sets ?? []).map((s: RoutineSet, j: number) => ({ kind: s.kind, reps: s.reps ?? null, restS: d && !e.superset ? plannedRest(e, s, j, d) : null })),
  }));
};
