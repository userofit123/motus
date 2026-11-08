// What a finished workout means for next time, kept as two separate things (PLAN.md §8.7):
// - numbers: the weight to move up to where the top of the rep range was reached in every set (accepted on the
//   Finish screen, it becomes a reminder that sets next time's weight and reps);
// - structure: how today differed from the routine's layout (exercises added, removed, swapped, moved, sets added or
//   left out), which only changes the routine when asked on the Finish screen.
import type { WorkoutExercise, WorkoutSet } from "./types";
import { usesReps, usesWeight } from "./training";

export interface MoreWeight {
  workoutExerciseId: string;
  exerciseId: string;
  name: string;
  /** the heaviest working weight today and the reps at the top of the range */
  fromKg: number;
  topReps: number;
  /** next time: one weight step up, reps back at the bottom of the range */
  toKg: number;
  reps: number;
}

// drop sets are lighter on purpose and warm-ups don't count: neither decides progression (as in nextProgression)
const deciding = (s: WorkoutSet) => s.kind !== "warmup" && s.kind !== "drop";

/** One weight step up from `fromKg`, on the step's grid (multiples of the step), so an odd weight lands on a real one. */
export function stepUp(fromKg: number, stepKg: number): number {
  let to = Math.round((fromKg + stepKg) / stepKg) * stepKg;
  if (to <= fromKg) to += stepKg;
  return Math.round(to * 100) / 100;
}

/** Exercises ready for more weight: every working set done, with weight, each reaching the top of its rep range
 * (the range's top when it has one, else the rep target). Next time: one step more (snapped to the step's grid), reps
 * back to the range's bottom. `stepKg` is one step for all, or per exercise (null leaves that exercise out).
 * Assisted exercises are left out (their weight is help taken off, so "more" is the wrong way). */
export function readyForMore(w: { exercises: WorkoutExercise[] }, stepKg: number | ((e: WorkoutExercise) => number | null)): MoreWeight[] {
  const out: MoreWeight[] = [];
  for (const e of w.exercises) {
    const t = e.exercise?.tracking ?? "weight_reps";
    if (e.status === "skipped" || t === "assisted" || !usesWeight(t) || !usesReps(t)) continue;
    const step = typeof stepKg === "function" ? stepKg(e) : stepKg;
    if (step == null || !(step > 0)) continue;
    const work = e.sets.filter(deciding);
    if (!work.length || !work.every((s) => s.done && s.targetReps != null && (s.weightKg ?? 0) > 0)) continue;
    const top = (s: WorkoutSet) => s.targetRepsMax ?? s.targetReps!;
    if (!work.every((s) => (s.reps ?? 0) >= top(s))) continue;
    const fromKg = Math.max(...work.map((s) => s.weightKg!));
    out.push({
      workoutExerciseId: e.id, exerciseId: e.exerciseId, name: e.exercise?.name ?? "",
      fromKg, topReps: Math.max(...work.map(top)), toKg: stepUp(fromKg, step), reps: Math.min(...work.map((s) => s.targetReps!)),
    });
  }
  return out;
}

export interface StructureChange {
  kind: "added" | "removed" | "swapped" | "sets" | "order";
  text: string;
}
export interface RoutineShape { exercises: { id?: string | null; exerciseId: string; exercise?: { name: string } | null; sets: unknown[] }[] }

/** How today's layout differs from the routine's, in the words the Finish screen lists. Mirrors what saving the changes
 * does (updateRoutineFromWorkout): skipped exercises stay as they are, an exercise keeps the sets that were ticked,
 * exercises taken out of the workout leave the routine. Numbers are not structure and never listed here. */
export function structureChanges(routine: RoutineShape, w: { exercises: WorkoutExercise[] }): StructureChange[] {
  const out: StructureChange[] = [];
  const byId = new Map(routine.exercises.filter((r) => r.id).map((r) => [r.id!, r]));
  // an exercise with nothing ticked counts as skipped: it stays in the routine as it was (or, added today, isn't added).
  // updateRoutineFromWorkout uses the same rule
  const kept = w.exercises.filter((e) => e.status !== "skipped" && e.sets.some((s) => s.done));
  const inWorkout = new Set(w.exercises.map((e) => e.routineExerciseId).filter(Boolean));
  for (const e of kept) {
    const r = e.routineExerciseId ? byId.get(e.routineExerciseId) : undefined;
    const name = e.exercise?.name ?? "";
    if (!r) { out.push({ kind: "added", text: `Add ${name}` }); continue; }
    if (r.exerciseId !== e.exerciseId) out.push({ kind: "swapped", text: `${r.exercise?.name ?? "An exercise"} becomes ${name}` });
    const done = e.sets.filter((s) => s.done).length;
    if (done !== r.sets.length) out.push({ kind: "sets", text: `${name}: ${done} set${done === 1 ? "" : "s"} instead of ${r.sets.length}` });
  }
  for (const r of routine.exercises) if (r.id && !inWorkout.has(r.id)) out.push({ kind: "removed", text: `Remove ${r.exercise?.name ?? "an exercise"}` });
  // order: the routine's own exercises still in it, today's sequence against the routine's
  const today = w.exercises.map((e) => e.routineExerciseId).filter((x): x is string => !!x && byId.has(x));
  const planned = routine.exercises.map((r) => r.id).filter((x): x is string => !!x && today.includes(x));
  if (today.some((x, i) => x !== planned[i])) out.push({ kind: "order", text: "Exercises in today's order" });
  return out;
}
