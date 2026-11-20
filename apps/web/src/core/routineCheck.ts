// The Routine check's input from what the pages already load: a routine (with each exercise's library entry) as one
// workout of the check (packages/shared routineCheck.ts).
import type { CheckSession, Routine, RoutineExercise, RoutineSet } from "@motus/shared";

export const sessionOf = (routine: Routine | null | undefined): CheckSession => (routine?.exercises ?? []).map((e: RoutineExercise) => ({
  name: e.exercise?.name ?? "", primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [],
  mechanic: e.exercise?.mechanic ?? null, force: e.exercise?.force ?? null, category: e.exercise?.category ?? "strength",
  superset: e.superset ?? null, sets: (e.sets ?? []).map((s: RoutineSet) => ({ kind: s.kind, reps: s.reps ?? null })),
}));
