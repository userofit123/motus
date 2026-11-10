// What a finished workout means for its routine (PLAN.md §8.7), kept as two separate things:
// - numbers: the routine always shows where you are now. After a finish each routine exercise done takes today's
//   working numbers, then Progression decides whether its weight goes up (or down after missed workouts): planNext,
//   used by the Finish screen to list it and by the engine to save it, so the two can't disagree;
// - structure: how this session differed from the routine (exercises added, removed, swapped, moved, sets added or
//   left out), which only changes the routine when asked on the Finish screen (structureChanges, applyStructure).
import type { Progression, ProgressionMode, WorkoutExercise } from "./types";
import { usesReps, usesWeight } from "./training";

/** One weight step up from `fromKg`, on the step's grid (multiples of the step), so an odd weight lands on a real one. */
export function stepUp(fromKg: number, stepKg: number): number {
  let to = Math.round((fromKg + stepKg) / stepKg) * stepKg;
  if (to <= fromKg) to += stepKg;
  return Math.round(to * 100) / 100;
}
/** One weight step down from `fromKg`, on the step's grid, never below 0. */
export function stepDown(fromKg: number, stepKg: number): number {
  let to = Math.round((fromKg - stepKg) / stepKg) * stepKg;
  if (to >= fromKg) to -= stepKg;
  return Math.max(0, Math.round(to * 100) / 100);
}

/** A routine exercise's own Progression, made safe: each field null follows Settings. A rule from before (kind,
 * incrementKg, deloadAfter) becomes its own "Automatic" with that step and that many misses before lowering. */
export function cleanProgression(v: unknown): Progression | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : null);
  const old = "kind" in o && !("mode" in o);
  const mode = old ? "auto" : o.mode === "suggest" || o.mode === "auto" || o.mode === "off" ? o.mode : null;
  const stepKg = num(old ? o.incrementKg : o.stepKg, 0.01, 100);
  const lowerAfter = num(old ? o.deloadAfter : o.lowerAfter, 0, 10);
  const p = { mode, stepKg, lowerAfter: lowerAfter == null ? null : Math.round(lowerAfter) } as Progression;
  return p.mode == null && p.stepKg == null && p.lowerAfter == null ? null : p;
}

/** Settings' Progression: the mode, the weight step (kg) and missed workouts in a row before lowering (0: never). */
export interface ProgressionDefaults { mode: ProgressionMode; stepKg: number; lowerAfter: number }
/** What a routine exercise's own Progression comes to with Settings filling in what it leaves open. The step: its
 * own, else the exercise's own increment, else Settings'. */
export function progressionOf(p: unknown, d: ProgressionDefaults, exerciseStepKg?: number | null): ProgressionDefaults {
  const own = cleanProgression(p);
  return { mode: own?.mode ?? d.mode, stepKg: own?.stepKg ?? (exerciseStepKg || d.stepKg), lowerAfter: own?.lowerAfter ?? d.lowerAfter };
}

/** A weight change next time, as the Finish screen lists it: up a step (every working set ticked and at the top of its
 * rep range) or down a step (missed reps `lowerAfter` workouts in a row). "suggest" asks with a switch, "auto" just does. */
export interface NextChange {
  routineExerciseId: string;
  exerciseId: string;
  name: string;
  mode: "suggest" | "auto";
  direction: "up" | "down";
  /** the heaviest working weight before and after (for assisted exercises: the help taken off) */
  fromKg: number;
  toKg: number;
  /** that set's reps before and after the change: what you did on it today and where it starts after */
  fromReps: number | null;
  reps: number | null;
  /** why, in plain words: "Every set reached 10 reps", "Missed reps 3 workouts in a row" */
  reason: string;
}

export type RoutineSetLike = { kind: string; reps: number | null; repsMax?: number | null; startReps?: number | null; weightKg: number | null; durationS?: number | null; distanceM?: number | null; side?: string | null };

type Sided = { kind: string; side?: string | null };
/** Pairs each of `sets` with the same set in `other` (last time's, or today's for the routine): warm-ups with warm-ups,
 * the others in turn, and a left or right set with the other's sets of that side, so left follows left and right follows
 * right. A side the other has none of takes its general sets in turn (a routine just split into sides still finds last
 * time's numbers), and a general set facing only sided ones takes them all in turn, as before there were sides.
 * `repeatLast`: a working set past the other's last one takes that one again. */
export function pairSets<T extends Sided>(sets: Sided[], other: T[], repeatLast = false): (T | null)[] {
  const group = (s: Sided) => (s.kind === "warmup" ? "w" : "k");
  const pools = new Map<string, T[]>();
  const add = (k: string, s: T) => pools.set(k, [...(pools.get(k) ?? []), s]);
  for (const s of other) { add(group(s), s); add(group(s) + (s.side ?? "-"), s); }
  const used = new Map<string, number>();
  return sets.map((s) => {
    const g = group(s), own = g + (s.side ?? "-");
    const pool = [own, g + "-", g].map((k) => pools.get(k)).find((a) => a?.length);
    if (!pool) return null;
    const i = used.get(own) ?? 0;
    used.set(own, i + 1);
    return pool[i] ?? (repeatLast && g === "k" ? pool.at(-1)! : null);
  });
}
export type RoutineItemLike = { id?: string | null; exerciseId: string; fixed?: boolean; progression?: unknown; missed?: number; sets: unknown[] };

/** A routine set's starting reps inside its rep range (`reps` is the range's bottom, `repsMax` its top): clamped into the
 * range, and null when that is the bottom (or there is no range), so a set without one has nothing to keep in step. */
export function clampStartReps(s: { reps?: number | null; repsMax?: number | null; startReps?: number | null }): number | null {
  if (s.startReps == null || s.repsMax == null || s.reps == null) return null;
  const v = Math.min(Math.max(s.startReps, s.reps), Math.max(s.repsMax, s.reps));
  return v === s.reps ? null : v;
}
/** The reps a routine set starts at: the starting reps inside its range, else its reps. */
export const startRepsOf = (s: { reps: number | null; repsMax?: number | null; startReps?: number | null }) => clampStartReps(s) ?? s.reps;

// drop sets are lighter on purpose and warm-ups don't count: neither decides progression
const deciding = (k: string) => k !== "warmup" && k !== "drop";

/** The routine's exercises after a finished session: each one done (not skipped, something ticked, the same exercise
 * as its slot) takes today's numbers set by set, each routine set from the workout set in its place among the non-warm-ups,
 * when that one was ticked and is the same kind (drop with drop, working with working; warm-ups never change, unticked or
 * mismatched places and routine sets past today's last keep theirs), then its Progression: a step up only when every
 * working set was ticked and reached the top of its rep range (starting reps back to the bottom), a step down after
 * `lowerAfter` workouts in a row with a ticked one below the bottom (unticked sets neither block a miss nor count up). A rep range stays as set, and the reps you did become next
 * time's starting reps inside it (startReps); a single rep target takes today's reps when they reached it, and keeps its
 * target when missed (so a miss stays a miss next time and counts; not while Progression is Off, and a "lower" not
 * applied starts the count again). "Keep these numbers fixed" exercises and skipped ones keep everything. `accepted`: routine
 * exercise ids whose "suggest" change was switched on with Apply; the rest are not applied (their numbers still follow
 * today). Pure, for both the Finish screen and the engine. `missed` is each exercise's run of workouts with missed reps, carried to the next finish. */
export function planNext<R extends RoutineItemLike>(exercises: R[], w: { exercises: WorkoutExercise[] }, d: ProgressionDefaults, accepted: Iterable<string> = []): { exercises: R[]; changes: NextChange[]; numbersChanged: boolean } {
  const on = new Set(accepted);
  const changes: NextChange[] = [];
  let numbersChanged = false;
  const out = exercises.map((re): R => {
    const e = re.id ? w.exercises.find((x) => x.routineExerciseId === re.id && x.exerciseId === re.exerciseId && x.status !== "skipped" && x.sets.some((s) => s.done)) : undefined;
    if (!e || re.fixed) return re;
    const sets = re.sets as RoutineSetLike[];
    // each routine set with the workout set in the same place among the non-warm-ups, by position so an unticked set
    // keeps its place (null: warm-up, past today's last, unticked, or a drop facing a working set or the other way round);
    // left and right sets each with today's of their own side (pairSets)
    const work = e.sets.filter((s) => s.kind !== "warmup");
    const isDrop = (k: string) => k === "drop";
    const pairs = pairSets(sets, work).map((t, i) => {
      const rs = sets[i]!;
      if (rs.kind === "warmup") return null;
      return t && t.done && isDrop(t.kind) === isDrop(rs.kind) ? t : null;
    });
    const num = (t: number | null | undefined, r: number | null | undefined) => (t ?? r ?? null);
    let next: RoutineSetLike[] = sets.map((rs, i) => {
      const t = pairs[i];
      if (!t) return rs;
      const base = { ...rs, weightKg: num(t.weightKg, rs.weightKg), durationS: num(t.durationS, rs.durationS), distanceM: num(t.distanceM, rs.distanceM) };
      // a range: the range stays, the reps done are where next time starts (clamped into it)
      if (rs.repsMax != null) {
        const sr = t.reps == null ? clampStartReps(rs) : clampStartReps({ ...rs, startReps: t.reps });
        return sr === (rs.startReps ?? null) ? base : { ...base, startReps: sr };
      }
      // one target: reached or beaten, it becomes today's reps; missed, the target stays (never lowered for a miss)
      return { ...base, reps: t.reps == null || (rs.reps != null && t.reps < rs.reps) ? rs.reps : t.reps };
    });
    // Off counts nothing, so switching Progression back on never lowers the weight for misses from while it was off
    const p = progressionOf(re.progression, d, e.exercise?.incrementKg);
    let missed = p.mode === "off" ? 0 : re.missed ?? 0;
    const tr = e.exercise?.tracking ?? "weight_reps";
    // the working sets ticked today decide a miss; going up needs every working set ticked
    const working = sets.map((rs, i) => ({ rs, t: pairs[i], i })).filter((x) => deciding(x.rs.kind));
    const dec = working.filter((x) => x.t);
    const assisted = tr === "assisted";
    const can = usesWeight(tr) && usesReps(tr) && dec.length > 0 && dec.every((x) => x.rs.reps != null && x.t!.reps != null && x.t!.weightKg != null && (assisted || x.t!.weightKg > 0));
    if (can) {
      const top = (s: RoutineSetLike) => s.repsMax ?? s.reps!;
      const allTop = dec.length === working.length && dec.every((x) => x.t!.reps! >= top(x.rs));
      const below = dec.find((x) => x.t!.reps! < x.rs.reps!);
      const missedNow = !!below;
      missed = missedNow && p.mode !== "off" ? missed + 1 : 0;
      let direction: "up" | "down" | null = null;
      if (p.mode !== "off" && p.stepKg > 0) {
        if (allTop) direction = "up";
        else if (missedNow && p.lowerAfter > 0 && missed >= p.lowerAfter) direction = "down";
      }
      if (direction) {
        // assisted: going up means less help
        const move = (kg: number) => ((direction === "up") !== assisted ? stepUp(kg, p.stepKg) : stepDown(kg, p.stepKg));
        let shift = 0;
        const moved = next.map((s, i) => {
          if (s.kind === "warmup") return s;
          // a working set without a weight moves nothing, so a drop after it must not follow the set before
          if (s.kind !== "drop") shift = 0;
          if (s.weightKg == null) return s;
          // a drop set moves with the set it drops from, by the same amount (so the gap between them stays), and its
          // reps start again like that set's: the weight moved, so the reps done at the old weight no longer apply
          if (s.kind === "drop") return shift ? { ...s, weightKg: Math.max(0, Math.round((s.weightKg + shift) * 100) / 100), reps: sets[i]!.reps, ...(s.startReps != null ? { startReps: null } : {}) } : s;
          const to = move(s.weightKg);
          shift = to - s.weightKg;
          // up: starting reps back to the bottom of the range (or the target); down: the target stays
          return { ...s, weightKg: to, reps: sets[i]!.reps, ...(s.startReps != null ? { startReps: null } : {}) };
        });
        const heaviest = (xs: RoutineSetLike[]) => Math.max(...xs.filter((s) => deciding(s.kind) && s.weightKg != null).map((s) => s.weightKg!));
        const mode = p.mode === "auto" ? "auto" : "suggest";
        // the set the change is shown on: the first one missed for a lower, else the first working set
        const at = direction === "down" ? below! : dec[0]!, i0 = at.i;
        const topReps = Math.max(...dec.map((x) => top(x.rs)));
        const range = dec.find((x) => x.rs.repsMax != null && top(x.rs) === topReps)?.rs;
        changes.push({
          routineExerciseId: re.id!, exerciseId: re.exerciseId, name: e.exercise?.name ?? "", mode, direction,
          fromKg: heaviest(next), toKg: heaviest(moved), fromReps: at.t!.reps, reps: startRepsOf(moved[i0]!),
          reason: direction === "up" ? `Every set reached ${topReps} reps${range ? `, the top of ${range.reps}-${range.repsMax}` : ""}`
            : p.lowerAfter === 1 ? "Missed reps last workout" : `Missed reps ${p.lowerAfter} workouts in a row`,
        });
        // applied, or a "lower" not applied on Finish: either way the run of misses starts again from 0, so a lower left
        // off isn't asked again at the very next miss
        if (mode === "auto" || on.has(re.id!)) next = moved;
        missed = 0;
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(sets)) numbersChanged = true;
    return { ...re, sets: next, missed };
  });
  return { exercises: out, changes, numbersChanged };
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

/** Every way this session differed from the routine, numbers aside (planNext carries them over). Changes you made: exercises added, removed, swapped, moved, sets added. Not done: exercises
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
      if (wasDone(e)) changed.push({ key: `added:${e.id}`, kind: "added", group: "changed", text: `Add ${name} to the routine`, action: `You added it in this workout · it joins with today's ${plural(e.sets.filter((s) => s.done).length, "set")}` });
      continue;
    }
    const rName = r.exercise?.name ?? "An exercise";
    // set counts change the routine's exercise: name it, and what was done in its place when swapped, so the row is
    // right whether the swap is saved or not
    const label = r.exerciseId !== e.exerciseId ? `${rName} (today: ${name})` : rName;
    if (!wasDone(e)) { notDone.push({ key: `skipped:${r.id}`, kind: "skipped", group: "notDone", text: `Remove ${rName} from the routine`, action: e.status === "skipped" ? "You skipped it in this workout" : "No sets were ticked in this workout" }); continue; }
    if (r.exerciseId !== e.exerciseId) changed.push({ key: `swapped:${r.id}`, kind: "swapped", group: "changed", text: `Replace ${rName} with ${name}`, action: `You swapped it in this workout · ${name} takes its place and settings` });
    const done = e.sets.filter((s) => s.done).length, planned = r.sets.length;
    if (done > planned) changed.push({ key: `more:${r.id}`, kind: "more", group: "changed", text: `Add ${plural(done - planned, "set")} to ${label}`, action: `You did ${done} sets, the routine has ${planned} · it would have ${done}` });
    if (done < planned) notDone.push({ key: `fewer:${r.id}`, kind: "fewer", group: "notDone", text: `Remove ${plural(planned - done, "set")} from ${label}`, action: `You did ${done} of ${planned} sets · the routine would have ${done}` });
  }
  for (const r of routine.exercises) if (r.id && !inWorkout.has(r.id)) changed.push({ key: `removed:${r.id}`, kind: "removed", group: "changed", text: `Remove ${r.exercise?.name ?? "an exercise"} from the routine`, action: "You removed it from this workout" });
  // order: the routine's own exercises done today, today's sequence against the routine's
  const today = w.exercises.filter(wasDone).map((e) => slot(e)?.id).filter((x): x is string => !!x);
  const planned = routine.exercises.map((r) => r.id).filter((x): x is string => !!x && today.includes(x));
  if (today.some((x, i) => x !== planned[i])) changed.push({ key: "order", kind: "order", group: "changed", text: "Use this workout's exercise order", action: "You did the exercises in a different order" });
  return [...changed, ...notDone];
}

type SetBody = { kind: string; reps: number | null; weightKg: number | null; durationS: number | null; distanceM: number | null; side: string | null };
const setBody = (s: WorkoutExercise["sets"][number]): SetBody => ({ kind: s.kind, reps: s.reps, weightKg: s.weightKg, durationS: s.durationS, distanceM: s.distanceM, side: s.side ?? null });

/** The routine's exercises after saving the changes whose keys are in `accept` (the rest stay as the routine has them).
 * Structure only: exercises the routine already had keep their own settings, weights and reps (a set added copies the
 * exercise's last one); only an exercise added or swapped in takes today's ticked numbers, as the routine has none
 * for it (one swapped in keeps the routine's sets, warm-ups as they are, unless its fewer/more row is on too). An
 * added exercise carries `fromWorkoutExerciseId` so the saver can point the workout exercise at the routine exercise
 * it became. Returns null when nothing asked for applies. */
export function applyStructure<R extends RoutineShape["exercises"][number]>(routine: { exercises: R[] }, w: SessionShape, accept: Iterable<string>): (R | Record<string, unknown>)[] | null {
  const ok = new Set(accept);
  const keys = new Set(structureChanges(routine, w).map((c) => c.key).filter((k) => ok.has(k)));
  if (!keys.size) return null;
  const { slot } = routineOf(routine, w);
  const today = new Map(w.exercises.map((e) => [slot(e)?.id, e] as const).filter(([k]) => k));
  const fresh = (e: WorkoutExercise) => ({ fromWorkoutExerciseId: e.id, exerciseId: e.exerciseId, superset: e.superset, restS: e.restS, restAfterS: e.restAfterS, repRestS: e.repRestS, sets: e.sets.filter((s) => s.done).map(setBody) });
  const routineItem = (r: R): R | Record<string, unknown> | null => {
    const id = r.id!;
    if (keys.has(`removed:${id}`) || keys.has(`skipped:${id}`)) return null;
    const e = today.get(id);
    if (!e) return r;
    const done = e.sets.filter((s) => s.done);
    const sets = r.sets as Record<string, unknown>[];
    if (keys.has(`swapped:${id}`)) {
      // the slot keeps its id, so its Progression, rests, note and pinned notes now go with the exercise swapped in
      if (keys.has(`fewer:${id}`) || keys.has(`more:${id}`)) return { ...r, exerciseId: e.exerciseId, sets: done.map(setBody) };
      // the routine's sets matched by kind: its warm-ups stay as they are, each working set takes today's working
      // numbers in turn (past today's last one, that one again); with no working set ticked the routine's own stay
      // (left and right sets each from today's of their side); each keeps the routine's own side
      const work = done.filter((s) => s.kind !== "warmup");
      const ts = pairSets(sets as Sided[], work, true);
      return { ...r, exerciseId: e.exerciseId, sets: sets.map((rs, i) => {
        if (rs.kind === "warmup") return rs;
        const t = ts[i];
        return t ? { ...setBody(t), kind: (rs.kind as string) ?? "normal", side: (rs.side as string | null | undefined) ?? null } : rs;
      }) };
    }
    if (keys.has(`fewer:${id}`)) return { ...r, sets: sets.slice(0, done.length) };
    if (keys.has(`more:${id}`)) return { ...r, sets: [...sets, ...done.slice(sets.length).map((s) => ({ ...(sets.at(-1) ?? {}), kind: s.kind, side: s.side ?? null }))] };
    return r;
  };
  // the order to build in: today's when asked for (exercises not done today, whether skipped, with nothing ticked or not
  // in the workout, keep their place after the one before them in the routine, as structureChanges compares only the
  // done ones), else the routine's (an added exercise goes after the one before it today)
  type Item = { r?: R; e?: WorkoutExercise };
  let seq: Item[];
  const added = (e: WorkoutExercise) => !slot(e) && keys.has(`added:${e.id}`);
  if (keys.has("order")) {
    const doneSlot = (e: WorkoutExercise) => (wasDone(e) ? slot(e) : undefined);
    seq = w.exercises.filter((e) => doneSlot(e) || added(e)).map((e) => (doneSlot(e) ? { r: doneSlot(e) as R } : { e }));
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
