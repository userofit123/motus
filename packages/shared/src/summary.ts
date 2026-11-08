// A workout's numbers so far: what's done against what's planned, volume, best sets, records and targets. Pure, so the
// running workout's Summary tab and the Finish screen read the same numbers.
import type { Tracking, WorkoutExercise, WorkoutSet } from "./types";
import { e1rm, liftedKg, setVolume, usesDistance, usesDuration, usesReps, usesWeight } from "./training";

export interface ExerciseSoFar {
  id: string;
  name: string;
  status: WorkoutExercise["status"];
  setsDone: number;
  setsPlanned: number;
  volumeKg: number;
  /** the best working set done, by what the exercise tracks (null: none done yet) */
  best: WorkoutSet | null;
  records: number;
  /** done working sets that had a rep target, and how many of them reached it */
  targets: number;
  targetsHit: number;
}

export interface WorkoutSoFar {
  exercisesDone: number;
  exercisesTotal: number;
  setsDone: number;
  setsPlanned: number;
  volumeKg: number;
  reps: number;
  records: number;
  targets: number;
  targetsHit: number;
  perExercise: ExerciseSoFar[];
}

const working = (s: WorkoutSet) => s.done && s.kind !== "warmup";

/** How one set ranks against the others of the same exercise: estimated 1RM (or weight × reps, or weight) for weights,
 * then reps, time, distance. Assisted exercises log the help taken off, so less is better there. */
function score(s: WorkoutSet, t: Tracking): number {
  if (t === "assisted") return -(s.weightKg ?? 0) * 1000 + (s.reps ?? 0);
  if (usesWeight(t) && s.weightKg) return usesReps(t) ? (e1rm(s.weightKg, s.reps) ?? liftedKg(s.weightKg, s.reps, t)) : s.weightKg * 1e6 + (s.durationS ?? 0) + (Number(s.distanceM) || 0);
  if (usesReps(t)) return s.reps ?? 0;
  if (usesDistance(t)) return Number(s.distanceM) || 0;
  if (usesDuration(t)) return s.durationS ?? 0;
  return 0;
}

export function bestSet(sets: WorkoutSet[], tracking: Tracking): WorkoutSet | null {
  let best: WorkoutSet | null = null, top = -Infinity;
  for (const s of sets) if (working(s)) { const v = score(s, tracking); if (v > top) { top = v; best = s; } }
  return best;
}

export function exerciseSoFar(e: WorkoutExercise): ExerciseSoFar {
  const t = e.exercise?.tracking ?? "weight_reps";
  const work = e.sets.filter(working), aimed = work.filter((s) => s.targetReps != null);
  return {
    id: e.id, name: e.exercise?.name ?? "", status: e.status,
    setsDone: e.sets.filter((s) => s.done).length, setsPlanned: e.sets.length,
    volumeKg: e.sets.reduce((a, s) => a + setVolume(s, t), 0),
    best: bestSet(e.sets, t),
    records: e.sets.filter((s) => s.done && s.pr?.length).length,
    targets: aimed.length, targetsHit: aimed.filter((s) => (s.reps ?? 0) >= s.targetReps!).length,
  };
}

/** Skipped exercises count neither as planned nor as done; a partly done one ("skip the remaining sets") counts as done. */
export function workoutSoFar(w: { exercises: WorkoutExercise[] }): WorkoutSoFar {
  const per = w.exercises.map(exerciseSoFar), kept = per.filter((p) => p.status !== "skipped");
  const sum = (f: (p: ExerciseSoFar) => number, list = per) => list.reduce((a, p) => a + f(p), 0);
  return {
    exercisesDone: kept.filter((p) => p.status === "done" || p.status === "partial").length, exercisesTotal: kept.length,
    setsDone: sum((p) => p.setsDone), setsPlanned: sum((p) => p.setsPlanned, kept),
    volumeKg: sum((p) => p.volumeKg),
    reps: w.exercises.reduce((a, e) => a + e.sets.filter(working).reduce((b, s) => b + (s.reps ?? 0), 0), 0),
    records: sum((p) => p.records), targets: sum((p) => p.targets), targetsHit: sum((p) => p.targetsHit),
    perExercise: per,
  };
}
