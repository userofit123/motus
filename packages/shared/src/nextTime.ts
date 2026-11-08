// What a finished workout means for next time, kept as two separate things (PLAN.md §8.7):
// - numbers: the weight to move up to where the top of the rep range was reached in every set (accepted on the
//   Finish screen, it becomes a reminder that sets next time's weight and reps);
// - structure: how this session differed from the routine (exercises added, removed, swapped, moved, sets added or
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

/** A progression rule that changes next time's weight (from GET /workouts/:id/next-rules, shown on the Finish
 * screen beside the suggestions): "add" a step or "deload", to `weightKg` × `reps`. */
export interface NextRule {
  workoutExerciseId: string;
  exerciseId: string;
  name: string;
  action: "add" | "deload";
  weightKg: number;
  reps: number | null;
}

/** One way a session differed from its routine, as the Finish screen and a finished workout's "Update the routine
 * from this" list it. `key` names it for saving (only the keys asked for are applied, see applyStructure); `group`
 * splits what was changed on purpose from what was left undone; `text` says what happened, `action` what saving does. */
export interface StructureChange {
  key: string;
  kind: "added" | "removed" | "swapped" | "order" | "more" | "skipped" | "fewer";
  group: "changed" | "notDone";
  text: string;
  action: string;
}
export interface RoutineShape { exercises: { id?: string | null; exerciseId: string; exercise?: { name: string } | null; sets: unknown[] }[] }
type SessionShape = { exercises: WorkoutExercise[] };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
// an exercise counts as done when it isn't skipped and has a ticked set; one with nothing ticked was not done
const wasDone = (e: WorkoutExercise) => e.status !== "skipped" && e.sets.some((s) => s.done);
// a workout exercise belongs to a routine exercise when it points at one the routine still has
const routineOf = (routine: RoutineShape, w: SessionShape) => {
  const byId = new Map(routine.exercises.filter((r) => r.id).map((r) => [r.id!, r]));
  return { slot: (e: WorkoutExercise) => (e.routineExerciseId ? byId.get(e.routineExerciseId) : undefined) };
};

/** Every way this session differed from the routine, numbers aside (they carry over through "Start from what you did
 * last time"). Changed in this session: exercises added, removed, swapped, moved, sets added. Not done: exercises
 * skipped or with nothing ticked, fewer sets ticked than the routine has. Nothing here changes the routine by itself:
 * each is saved only when asked (applyStructure, used by the engine for both places that save). */
export function structureChanges(routine: RoutineShape, w: SessionShape): StructureChange[] {
  const changed: StructureChange[] = [], notDone: StructureChange[] = [];
  const { slot } = routineOf(routine, w);
  const inWorkout = new Set(w.exercises.map((e) => slot(e)?.id).filter(Boolean));
  for (const e of w.exercises) {
    const r = slot(e);
    const name = e.exercise?.name ?? "";
    if (!r) {
      if (wasDone(e)) changed.push({ key: `added:${e.id}`, kind: "added", group: "changed", text: `Added: ${name}`, action: "Add to the routine" });
      continue;
    }
    const rName = r.exercise?.name ?? "An exercise";
    if (!wasDone(e)) { notDone.push({ key: `skipped:${r.id}`, kind: "skipped", group: "notDone", text: `Skipped: ${rName}`, action: "Remove from the routine" }); continue; }
    if (r.exerciseId !== e.exerciseId) changed.push({ key: `swapped:${r.id}`, kind: "swapped", group: "changed", text: `Swapped: ${rName} for ${name}`, action: `Use ${name} in the routine` });
    const done = e.sets.filter((s) => s.done).length, planned = r.sets.length;
    if (done > planned) changed.push({ key: `more:${r.id}`, kind: "more", group: "changed", text: `${name}: ${done} sets instead of ${planned}`, action: `Add ${plural(done - planned, "set")} to the routine` });
    if (done < planned) notDone.push({ key: `fewer:${r.id}`, kind: "fewer", group: "notDone", text: `${name}: ${done} of ${planned} sets done`, action: `Keep ${plural(done, "set")} in the routine` });
  }
  for (const r of routine.exercises) if (r.id && !inWorkout.has(r.id)) changed.push({ key: `removed:${r.id}`, kind: "removed", group: "changed", text: `Removed: ${r.exercise?.name ?? "an exercise"}`, action: "Remove from the routine" });
  // order: the routine's own exercises done today, today's sequence against the routine's
  const today = w.exercises.filter(wasDone).map((e) => slot(e)?.id).filter((x): x is string => !!x);
  const planned = routine.exercises.map((r) => r.id).filter((x): x is string => !!x && today.includes(x));
  if (today.some((x, i) => x !== planned[i])) changed.push({ key: "order", kind: "order", group: "changed", text: "Exercises in a different order", action: "Use this session's order" });
  return [...changed, ...notDone];
}

type SetBody = { kind: string; reps: number | null; weightKg: number | null; durationS: number | null; distanceM: number | null };
const setBody = (s: WorkoutExercise["sets"][number]): SetBody => ({ kind: s.kind, reps: s.reps, weightKg: s.weightKg, durationS: s.durationS, distanceM: s.distanceM });

/** The routine's exercises after saving the changes whose keys are in `accept` (the rest stay as the routine has them).
 * Structure only: exercises the routine already had keep their own settings, weights and reps (a set added copies the
 * exercise's last one); only an exercise added or swapped in takes today's ticked sets, as the routine has none for
 * it. Returns null when nothing asked for applies. */
export function applyStructure<R extends RoutineShape["exercises"][number]>(routine: { exercises: R[] }, w: SessionShape, accept: Iterable<string>): (R | Record<string, unknown>)[] | null {
  const ok = new Set(accept);
  const keys = new Set(structureChanges(routine, w).map((c) => c.key).filter((k) => ok.has(k)));
  if (!keys.size) return null;
  const { slot } = routineOf(routine, w);
  const today = new Map(w.exercises.map((e) => [slot(e)?.id, e] as const).filter(([k]) => k));
  const fresh = (e: WorkoutExercise) => ({ exerciseId: e.exerciseId, superset: e.superset, restS: e.restS, restAfterS: e.restAfterS, repRestS: e.repRestS, sets: e.sets.filter((s) => s.done).map(setBody) });
  const routineItem = (r: R): R | Record<string, unknown> | null => {
    const id = r.id!;
    if (keys.has(`removed:${id}`) || keys.has(`skipped:${id}`)) return null;
    const e = today.get(id);
    if (!e) return r;
    const done = e.sets.filter((s) => s.done);
    if (keys.has(`swapped:${id}`)) return { ...r, exerciseId: e.exerciseId, sets: done.map(setBody) };
    const sets = r.sets as Record<string, unknown>[];
    if (keys.has(`fewer:${id}`)) return { ...r, sets: sets.slice(0, done.length) };
    if (keys.has(`more:${id}`)) return { ...r, sets: [...sets, ...done.slice(sets.length).map((s) => ({ ...(sets.at(-1) ?? {}), kind: s.kind }))] };
    return r;
  };
  // the order to build in: today's when asked for (exercises not in the workout keep their place after the one before
  // them in the routine), else the routine's (an added exercise goes after the one before it today)
  type Item = { r?: R; e?: WorkoutExercise };
  let seq: Item[];
  const added = (e: WorkoutExercise) => !slot(e) && keys.has(`added:${e.id}`);
  if (keys.has("order")) {
    seq = w.exercises.filter((e) => slot(e) || added(e)).map((e) => (slot(e) ? { r: slot(e) as R } : { e }));
    routine.exercises.forEach((r, i) => {
      if (seq.some((x) => x.r === r)) return;
      const prev = routine.exercises[i - 1];
      const at = prev ? seq.findIndex((x) => x.r === prev) + 1 : 0;
      seq.splice(at, 0, { r });
    });
  } else {
    seq = routine.exercises.map((r) => ({ r }));
    w.exercises.forEach((e, i) => {
      if (!added(e)) return;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const p = w.exercises[j]!, k = seq.findIndex((x) => (x.r && x.r === slot(p)) || x.e === p);
        if (k >= 0) { at = k + 1; break; }
      }
      seq.splice(at, 0, { e });
    });
  }
  return seq.map((x) => (x.r ? routineItem(x.r) : fresh(x.e!))).filter((x): x is R | Record<string, unknown> => !!x);
}
