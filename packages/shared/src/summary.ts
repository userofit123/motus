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

/** Skipped exercises count neither as planned nor as done (not even sets done before the skip, or done could pass planned); a partly done one ("skip the remaining sets") counts as done. */
export function workoutSoFar(w: { exercises: WorkoutExercise[] }): WorkoutSoFar {
  const per = w.exercises.map(exerciseSoFar), kept = per.filter((p) => p.status !== "skipped");
  const sum = (f: (p: ExerciseSoFar) => number, list = per) => list.reduce((a, p) => a + f(p), 0);
  return {
    exercisesDone: kept.filter((p) => p.status === "done" || p.status === "partial").length, exercisesTotal: kept.length,
    setsDone: sum((p) => p.setsDone, kept), setsPlanned: sum((p) => p.setsPlanned, kept),
    volumeKg: sum((p) => p.volumeKg),
    reps: w.exercises.reduce((a, e) => a + e.sets.filter(working).reduce((b, s) => b + (s.reps ?? 0), 0), 0),
    records: sum((p) => p.records), targets: sum((p) => p.targets), targetsHit: sum((p) => p.targetsHit),
    perExercise: per,
  };
}

export type Trend = "up" | "same" | "down";

/** How a finished workout went, in parts that can each be said in plain words: against its plan (sets, rep and weight
 * targets) and against last time (each exercise's best set, and volume). */
export interface WorkoutScore {
  plan: {
    setsDone: number; setsPlanned: number; skipped: number;
    repTargets: number; repTargetsHit: number;
    weightTargets: number; weightTargetsHit: number;
    /** all: every planned set done and every target reached; most: at least 80% of the sets; part: less */
    verdict: "all" | "most" | "part";
  };
  /** null when no exercise was done before (nothing to compare with) */
  last: {
    /** exercises done today that were also done last time */
    compared: number; improved: number; dropped: number;
    volumeKg: number; lastVolumeKg: number;
    /** volume change in whole percent, over the compared exercises only (null when last time had no volume) */
    volumePct: number | null;
    verdict: "better" | "same" | "worse";
  } | null;
  /** per exercise, by workout exercise id: up / same / down on last time (absent: skipped, not done or new) */
  vsLast: Record<string, Trend>;
}

const EPS = 0.01;
const trend = (now: number, before: number): Trend => now > before + EPS ? "up" : now < before - EPS ? "down" : "same";

/** "Last time" is each set's `prev`: the same set in the exercise's last session (in this routine when there is one).
 * An exercise is up when its best set beats last time's best (or ties it with more volume), down the other way round.
 * The workout is better when more exercises went up than down; a tie is settled by volume (2% either way). */
export function workoutScore(w: { exercises: WorkoutExercise[] }): WorkoutScore {
  const so = workoutSoFar(w);
  let weightTargets = 0, weightTargetsHit = 0, compared = 0, improved = 0, dropped = 0, vol = 0, lastVol = 0;
  const vsLast: Record<string, Trend> = {};
  for (const [i, e] of w.exercises.entries()) {
    if (e.status === "skipped") continue;
    const t = e.exercise?.tracking ?? "weight_reps", work = e.sets.filter(working);
    if (usesWeight(t)) for (const s of work) if (s.targetWeightKg != null && s.targetWeightKg > 0) {
      weightTargets++;
      if (t === "assisted" ? (s.weightKg ?? Infinity) <= s.targetWeightKg + EPS : (s.weightKg ?? 0) >= s.targetWeightKg - EPS) weightTargetsHit++;
    }
    const before: WorkoutSet[] = e.sets.filter((s) => s.kind !== "warmup" && s.prev).map((s) => ({ ...s, ...s.prev!, done: true }));
    const best = bestSet(e.sets, t), lastBest = bestSet(before, t);
    if (!best || !lastBest) continue;
    const v = so.perExercise[i]!.volumeKg, lv = before.reduce((a, s) => a + setVolume(s, t), 0);
    const b = trend(score(best, t), score(lastBest, t)), d = b === "same" ? trend(v, lv) : b;
    vsLast[e.id] = d;
    compared++; vol += v; lastVol += lv;
    if (d === "up") improved++; else if (d === "down") dropped++;
  }
  const volumePct = lastVol > 0 ? Math.round(((vol - lastVol) / lastVol) * 100) : null;
  const skipped = w.exercises.filter((e) => e.status === "skipped").length;
  const allDone = so.setsDone >= so.setsPlanned && !skipped && so.targetsHit === so.targets && weightTargetsHit === weightTargets;
  return {
    plan: {
      setsDone: so.setsDone, setsPlanned: so.setsPlanned, skipped,
      repTargets: so.targets, repTargetsHit: so.targetsHit, weightTargets, weightTargetsHit,
      verdict: allDone ? "all" : so.setsDone >= so.setsPlanned * 0.8 ? "most" : "part",
    },
    last: !compared ? null : {
      compared, improved, dropped, volumeKg: vol, lastVolumeKg: lastVol, volumePct,
      verdict: improved > dropped ? "better" : dropped > improved ? "worse" : (volumePct ?? 0) >= 2 ? "better" : (volumePct ?? 0) <= -2 ? "worse" : "same",
    },
    vsLast,
  };
}
