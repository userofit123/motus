// The Routine check's input from what the pages already load: a routine (with each exercise's library entry) as one
// workout of the check (packages/shared routineCheck.ts), each set with the rest the routine plans after it (plannedRest,
// the rule the routine page and the workout use) when the person's workout settings are given. A superset's exercises
// get no rest: they take turns, so their rests are not the time between one lift's sets. With Settings' Progression
// mode (`mode`), each exercise Progression can move (weight and reps: `progresses`, so assisted and weighted bodyweight
// ones too) says whether it moves its numbers up, for the program
// check's progression row (M-298): "Keep these numbers fixed", its own mode, else the one in Settings.
import { cleanProgression, progresses, restDefaultsOf, type CheckSession, type ProgressionMode, type Routine, type RoutineExercise, type RoutineSet, type WorkoutPrefs } from "@motus/shared";
import { plannedRest } from "./plannedRest";

const progressOf = (e: RoutineExercise, mode: ProgressionMode) => {
  if (!e.exercise || !progresses(e.exercise.tracking)) return undefined;
  if (e.fixed) return "fixed" as const;
  const own = cleanProgression(e.progression)?.mode;
  return own ? (own === "off" ? "off" as const : "on" as const) : mode === "off" ? "settingsOff" as const : "on" as const;
};

export const sessionOf = (routine: Routine | null | undefined, w?: WorkoutPrefs, mode?: ProgressionMode): CheckSession => {
  const d = w ? restDefaultsOf(w) : null;
  return (routine?.exercises ?? []).map((e: RoutineExercise) => ({
    name: e.exercise?.name ?? "", primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [],
    mechanic: e.exercise?.mechanic ?? null, force: e.exercise?.force ?? null, category: e.exercise?.category ?? "strength",
    superset: e.superset ?? null, ...(mode ? { progress: progressOf(e, mode) } : {}),
    sets: (e.sets ?? []).map((s: RoutineSet, j: number) => ({ kind: s.kind, reps: s.reps ?? null, side: s.side ?? null, restS: d && !e.superset ? plannedRest(e, s, j, d) : null })),
  }));
};
