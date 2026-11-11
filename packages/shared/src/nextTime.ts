// What a finished workout means for its routine (PLAN.md §8.7), kept as two separate things:
// - numbers: the routine always shows where you are now. After a finish each routine exercise done takes today's
//   numbers (warm-ups too), then Progression decides whether its weight goes up (or down after missed workouts): planNext,
//   used by the Finish screen to list it and by the engine to save it, so the two can't disagree;
// - structure: how this session differed from the routine (exercises added, removed, swapped, moved, sets added, left
//   out or changed in kind or side), which only changes the routine when asked on the Finish screen (structureChanges, applyStructure).
import type { Progression, WorkoutExercise } from "./types";
import type { ProgressionDefaults } from "./settings";
import { e1rm, usesReps, usesWeight, weightForReps } from "./training";

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

/** A routine exercise's own Progression, made safe: each field null follows Settings; the rep range is both ends or
 * neither. A rule from before (kind, incrementKg, deloadAfter) becomes its own "Automatic" with that step and that many
 * misses before lowering. */
export function cleanProgression(v: unknown): Progression | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : null);
  const old = "kind" in o && !("mode" in o);
  const mode = old ? "auto" : o.mode === "suggest" || o.mode === "auto" || o.mode === "off" ? o.mode : null;
  const stepKg = num(old ? o.incrementKg : o.stepKg, 0.01, 100);
  const lowerAfter = num(old ? o.deloadAfter : o.lowerAfter, 0, 10);
  const lo = num(o.repsMin, 1, 100), hi = num(o.repsMax, 1, 100);
  const range = lo != null && hi != null && lo <= hi;
  const p: Progression = { mode, repsMin: range ? Math.round(lo) : null, repsMax: range ? Math.round(hi) : null, stepKg, lowerAfter: lowerAfter == null ? null : Math.round(lowerAfter) };
  return Object.values(p).every((x) => x == null) ? null : p;
}

/** What Progression comes to for one routine exercise. */
export interface ProgressionOf { mode: ProgressionDefaults["mode"]; repsMin: number; repsMax: number; stepKg: number; lowerAfter: number }
/** What a routine exercise's own Progression comes to with Settings filling in what it leaves open. The step: its own,
 * else the exercise's own increment, else Settings' for one side at a time (`oneSide`: the routine does it as left and
 * right sets, or the exercise is one-sided) or for both sides together. */
export function progressionOf(p: unknown, d: ProgressionDefaults, ex?: { incrementKg?: number | null; oneSide?: boolean }): ProgressionOf {
  const own = cleanProgression(p);
  return {
    mode: own?.mode ?? d.mode,
    repsMin: own?.repsMin ?? d.repsMin, repsMax: own?.repsMax ?? d.repsMax,
    stepKg: own?.stepKg ?? (ex?.incrementKg || (ex?.oneSide ? d.stepOneSideKg : d.stepKg)),
    lowerAfter: own?.lowerAfter ?? d.lowerAfter,
  };
}
/** One side at a time: the routine has left and right sets, or the exercise itself is one-sided. */
export const oneSideOf = (sets: { side?: string | null }[], ex?: { unilateral?: boolean } | null) => !!ex?.unilateral || sets.some((s) => s.side === "L" || s.side === "R");

/** Next time's weight after every set reached the top of the range: the weight that today's set (weight x reps) says you
 * can lift for the range's bottom reps (estimated one-rep max), on the step's grid, and at least one step heavier. */
export function heavierFor(weightKg: number, reps: number, bottomReps: number, stepKg: number): number {
  const up = stepUp(weightKg, stepKg), one = e1rm(weightKg, reps);
  if (one == null) return up;
  const to = Math.round(Math.round(weightForReps(one, bottomReps) / stepKg) * stepKg * 100) / 100;
  return Math.max(up, to);
}

/** A weight change next time, as the Finish screen lists it: heavier (every working set ticked and at the top of the
 * rep range) or a step lighter (below the range's bottom `lowerAfter` workouts in a row). "suggest" asks with a switch,
 * "auto" just does. */
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
  /** why, in plain words: "You did 12 reps on every set, the top of 6-12", "Below 6 reps 3 workouts in a row" */
  reason: string;
}

export type RoutineSetLike = { kind: string; reps: number | null; weightKg: number | null; durationS?: number | null; distanceM?: number | null; side?: string | null };

type Sided = { kind: string; side?: string | null };
/** Pairs each of `sets` with the same set in `other` (last time's, or today's for the routine), warm-ups only with
 * warm-ups, never giving one set twice: first each set with the next of the same side (general with general, left with
 * left), then a left or right set still without one takes a general set (a general set is both sides together, so it can
 * give one left and one right: a routine just split into sides still finds last time's numbers), then any set still
 * without one takes the next one nobody took, in order. `repeatLast`: a working set left over takes the other's last one
 * again (of its side if there is one). */
export function pairSets<T extends Sided>(sets: Sided[], other: T[], repeatLast = false): (T | null)[] {
  const group = (s: Sided) => (s.kind === "warmup" ? "w" : "k");
  const sideOf = (s: Sided) => (s.side === "L" || s.side === "R" ? s.side : null);
  // who took each of `other`: "G" for a general set, else the side
  const takers = other.map(() => new Set<string>());
  const free = (j: number, t: string) => {
    const by = takers[j]!;
    return by.size === 0 || (!sideOf(other[j]!) && t !== "G" && !by.has("G") && !by.has(t));
  };
  const out: (T | null)[] = sets.map(() => null);
  const pick = (i: number, fits: (o: T) => boolean) => {
    const s = sets[i]!, t = sideOf(s) ?? "G";
    const j = other.findIndex((o, j) => group(o) === group(s) && fits(o) && free(j, t));
    if (j >= 0) { takers[j]!.add(t); out[i] = other[j]!; }
  };
  sets.forEach((s, i) => pick(i, (o) => sideOf(o) === sideOf(s)));
  sets.forEach((s, i) => { if (!out[i] && sideOf(s)) pick(i, (o) => !sideOf(o)); });
  sets.forEach((s, i) => { if (!out[i]) pick(i, () => true); });
  if (repeatLast) sets.forEach((s, i) => {
    if (out[i] || group(s) !== "k") return;
    const k = other.filter((o) => group(o) === "k").reverse();
    out[i] = k.find((o) => sideOf(o) === sideOf(s)) ?? k.find((o) => !sideOf(o)) ?? k[0] ?? null;
  });
  return out;
}
/** Today's set in each routine set's place, the one planNext takes the numbers from (and the Next time sheet shows as
 * "You did"): the workout set in the same place, warm-ups among today's warm-ups and the rest among the rest, by
 * position so an unticked set keeps its place; left and right sets each with today's of their own side (pairSets).
 * Null: past today's last of its kind, unticked, or a drop facing a working set or the other way round. */
export function todaysSets<T extends Sided & { done: boolean }>(sets: Sided[], e: { sets: T[] }): (T | null)[] {
  const isDrop = (k: string) => k === "drop";
  return pairSets(sets, e.sets).map((t, i) => (t && t.done && isDrop(t.kind) === isDrop(sets[i]!.kind) ? t : null));
}
export type RoutineItemLike = { id?: string | null; exerciseId: string; fixed?: boolean; progression?: unknown; missed?: number; sets: unknown[] };

// drop sets are lighter on purpose and warm-ups don't count: neither decides progression
const deciding = (k: string) => k !== "warmup" && k !== "drop";

/** Why the weight goes up, in plain words: "You did 12 reps on every set, the top of 6-12. Next time: heavier,
 * starting again at 6 reps". */
function upReason(least: number, same: boolean, p: ProgressionOf): string {
  const did = same ? `You did ${least} reps on every set` : `You did ${least} or more reps on every set`;
  return `${did}, ${least === p.repsMax ? "the top" : "above the top"} of ${range(p)}. Next time: heavier, starting again at ${p.repsMin} reps`;
}
const range = (p: ProgressionOf) => (p.repsMin === p.repsMax ? `${p.repsMin}` : `${p.repsMin}-${p.repsMax}`);

/** The routine's exercises after a finished session (double progression, PLAN.md §8.7): each one done (not skipped,
 * something ticked, the same exercise as its slot) takes today's numbers set by set, each routine set from the workout
 * set in its place (todaysSets), when that one was ticked and is the same kind (drop with drop, working with working,
 * warm-up with warm-up: a warm-up takes what you did but decides nothing; unticked or mismatched places and routine
 * sets past today's last keep theirs). The
 * reps move inside the exercise's rep range (its Progression's, else Settings'): reps done in the range are next time's,
 * reps below its bottom keep the planned ones (a miss stays a miss next time). Then Progression: every working set
 * ticked and at the top of the range → heavier (the weight today's numbers say you can lift for the bottom reps, on the
 * step's grid, at least one step) and the reps back to the bottom; a ticked one below the bottom `lowerAfter` workouts
 * in a row → one step lighter (once or twice is part of training; Off counts nothing, and a "lower" not applied starts
 * the count again). Exercises without both weight and reps only take today's numbers (a rep target missed stays).
 * "Keep these numbers fixed" exercises and skipped ones keep everything. `accepted`: routine exercise ids whose
 * "suggest" change was switched on with Apply; the rest are not applied (their numbers still follow today). Pure, for
 * both the Finish screen and the engine. `missed` is each exercise's run of workouts with missed reps. */
export function planNext<R extends RoutineItemLike>(exercises: R[], w: { exercises: WorkoutExercise[] }, d: ProgressionDefaults, accepted: Iterable<string> = []): { exercises: R[]; changes: NextChange[]; numbersChanged: boolean } {
  const on = new Set(accepted);
  const changes: NextChange[] = [];
  let numbersChanged = false;
  const out = exercises.map((re): R => {
    const e = re.id ? w.exercises.find((x) => x.routineExerciseId === re.id && x.exerciseId === re.exerciseId && x.status !== "skipped" && x.sets.some((s) => s.done)) : undefined;
    if (!e || re.fixed) return re;
    const sets = re.sets as RoutineSetLike[];
    const pairs = todaysSets(sets, e);
    const tr = e.exercise?.tracking ?? "weight_reps";
    const p = progressionOf(re.progression, d, { incrementKg: e.exercise?.incrementKg, oneSide: oneSideOf(sets, e.exercise) });
    // the range applies where the weight can move by reps reached; elsewhere a rep target is just a target
    const ranged = usesWeight(tr) && usesReps(tr);
    const num = (t: number | null | undefined, r: number | null | undefined) => (t ?? r ?? null);
    let next: RoutineSetLike[] = sets.map((rs, i) => {
      const t = pairs[i];
      if (!t) return rs;
      const base = { ...rs, weightKg: num(t.weightKg, rs.weightKg), durationS: num(t.durationS, rs.durationS), distanceM: num(t.distanceM, rs.distanceM) };
      if (t.reps == null) return base;
      // a warm-up keeps what you did: it decides nothing and has no range to stay in
      if (rs.kind === "warmup") return { ...base, reps: t.reps };
      // in the range: what you did (above its top: the top); below it, or below a plain target: the planned reps stay
      if (ranged && rs.kind !== "drop") return { ...base, reps: t.reps < p.repsMin ? rs.reps : Math.min(t.reps, p.repsMax) };
      return { ...base, reps: rs.reps != null && t.reps < rs.reps ? rs.reps : t.reps };
    });
    // Off counts nothing, so switching Progression back on never lowers the weight for misses from while it was off
    let missed = p.mode === "off" ? 0 : re.missed ?? 0;
    // the working sets ticked today decide a miss; going up needs every working set ticked
    const working = sets.map((rs, i) => ({ rs, t: pairs[i], i })).filter((x) => deciding(x.rs.kind));
    const dec = working.filter((x) => x.t);
    const assisted = tr === "assisted";
    const can = ranged && dec.length > 0 && dec.every((x) => x.t!.reps != null && x.t!.weightKg != null && (assisted || x.t!.weightKg > 0));
    if (can) {
      const done = (x: (typeof dec)[number]) => x.t!.reps!;
      const allTop = dec.length === working.length && dec.every((x) => done(x) >= p.repsMax);
      const below = dec.find((x) => done(x) < p.repsMin);
      missed = below && p.mode !== "off" ? missed + 1 : 0;
      let direction: "up" | "down" | null = null;
      if (p.mode !== "off" && p.stepKg > 0) {
        if (allTop) direction = "up";
        else if (below && p.lowerAfter > 0 && missed >= p.lowerAfter) direction = "down";
      }
      if (direction) {
        // heavier: from what each set did (assisted: one step less help); lighter: one step (assisted: more help)
        const move = (kg: number, i: number) => {
          if (direction === "down") return assisted ? stepUp(kg, p.stepKg) : stepDown(kg, p.stepKg);
          if (assisted) return stepDown(kg, p.stepKg);
          const t = pairs[i];
          return t?.weightKg != null && t.reps != null ? heavierFor(t.weightKg, t.reps, p.repsMin, p.stepKg) : stepUp(kg, p.stepKg);
        };
        let shift = 0;
        const moved = next.map((s, i) => {
          if (s.kind === "warmup") return s;
          // a working set without a weight moves nothing, so a drop after it must not follow the set before
          if (s.kind !== "drop") shift = 0;
          if (s.weightKg == null) return s;
          // a drop set moves with the set it drops from, by the same amount (so the gap between them stays), its reps
          // as planned: the weight moved, so the reps done at the old weight no longer apply
          if (s.kind === "drop") return shift ? { ...s, weightKg: Math.max(0, Math.round((s.weightKg + shift) * 100) / 100), reps: sets[i]!.reps } : s;
          const to = move(s.weightKg, i);
          shift = to - s.weightKg;
          // heavier: the reps start again at the bottom of the range; lighter: the planned reps stay
          return { ...s, weightKg: to, reps: direction === "up" ? p.repsMin : sets[i]!.reps };
        });
        const heaviest = (xs: RoutineSetLike[]) => Math.max(...xs.filter((s) => deciding(s.kind) && s.weightKg != null).map((s) => s.weightKg!));
        const mode = p.mode === "auto" ? "auto" : "suggest";
        // the set the change is shown on: the first one missed for a lower, else the first working set
        const at = direction === "down" ? below! : dec[0]!, i0 = at.i;
        const least = Math.min(...dec.map(done));
        changes.push({
          routineExerciseId: re.id!, exerciseId: re.exerciseId, name: e.exercise?.name ?? "", mode, direction,
          fromKg: heaviest(next), toKg: heaviest(moved), fromReps: done(at), reps: moved[i0]!.reps,
          reason: direction === "up" ? upReason(least, dec.every((x) => done(x) === least), p)
            : `Below ${p.repsMin} reps, the bottom of ${range(p)}, ${p.lowerAfter === 1 ? "last workout" : `${p.lowerAfter} workouts in a row`}. Next time: lighter`,
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
  kind: "added" | "removed" | "swapped" | "order" | "more" | "sets" | "skipped" | "fewer";
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

// a set's place in the layout: its kind and side ("normal", "warmupL")
const shapeOf = (s: Sided) => `${s.kind || "normal"}${s.side === "L" || s.side === "R" ? s.side : ""}`;
const SHAPE: Record<string, string> = { warmup: "warm-up", normal: "set", drop: "drop set", failure: "to-failure set" };
/** Sets in plain words, by kind and side in the order they first come: "1 warm-up, 3 sets and 1 left set". */
function shapesText(xs: string[]): string {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  const parts = [...counts].map(([x, k]) => {
    const side = x.endsWith("L") ? "left " : x.endsWith("R") ? "right " : "", kind = side ? x.slice(0, -1) : x;
    return plural(k, side + (SHAPE[kind] ?? "set"));
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "no sets";
}
/** The sets of `big` left once `small` is found in it in order (each of `small` at its next match), or null when
 * `small` isn't in it in that order. */
function extraOf(small: string[], big: string[]): string[] | null {
  const rest: string[] = [];
  let i = 0;
  for (const x of big) { if (i < small.length && small[i] === x) i++; else rest.push(x); }
  return i < small.length ? null : rest;
}

/** Every way this session differed from the routine, numbers aside (planNext carries them over). Changes you made:
 * exercises added, removed, swapped, moved, sets added, sets changed (a set made a warm-up, a drop or to-failure set,
 * left and right sets in place of one): any difference in the kind and side of the ticked sets. Not done: exercises
 * skipped or with nothing ticked, sets left out. Nothing here changes the routine by itself: each is saved only when
 * asked (applyStructure, used by the engine for both places that save). */
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
    // the sets' layout (kind and side of each, in order): today's ticked sets against the routine's. Only sets added
    // (a warm-up put in front, left and right sets after) is "more", only sets left out is "fewer", anything else (a
    // set made a warm-up, a set split into sides) is "sets"; each saves today's layout (reshape), never by itself
    const t = e.sets.filter((s) => s.done).map(shapeOf), rr = (r.sets as Sided[]).map(shapeOf);
    if (t.join() === rr.join()) continue;
    const both = `You did ${shapesText(t)} · the routine has ${shapesText(rr)}`;
    const added = extraOf(rr, t), left = extraOf(t, rr);
    if (added) changed.push({ key: `more:${r.id}`, kind: "more", group: "changed", text: `Add ${shapesText(added)} to ${label}`, action: both });
    else if (left) notDone.push({ key: `fewer:${r.id}`, kind: "fewer", group: "notDone", text: `Remove ${shapesText(left)} from ${label}`, action: `You did ${t.length} of ${rr.length} sets · the routine would have ${t.length}` });
    else changed.push({ key: `sets:${r.id}`, kind: "sets", group: "changed", text: `Use this workout's sets for ${label}`, action: both });
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
 * exercise's last one of its kind; a set layout saved takes today's kinds and sides); only an exercise added or swapped in takes today's ticked numbers, as the routine has none
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
    const reshape = keys.has(`fewer:${id}`) || keys.has(`more:${id}`) || keys.has(`sets:${id}`);
    if (keys.has(`swapped:${id}`)) {
      // the slot keeps its id, so its Progression, rests, note and pinned notes now go with the exercise swapped in
      if (reshape) return { ...r, exerciseId: e.exerciseId, sets: done.map(setBody) };
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
    // today's ticked sets in their order, kind and side; each keeps the routine's own set it pairs with (its numbers and
    // rest), a working set the routine has none for copies its last one, a warm-up it has none for takes today's
    if (reshape) {
      const own = pairSets(done, sets as Sided[], true);
      return { ...r, sets: done.map((t, i) => (own[i] ? { ...own[i], kind: t.kind, side: t.side ?? null } : setBody(t))) };
    }
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
