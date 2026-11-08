// Training maths: estimated one-rep max, volume, how long a routine takes, which rest applies, plates, warm-ups.
import type { SetKind, Tracking, RestByKind } from "./types";
import { duration, fromKg, toKg } from "./units";

/** Estimated one-rep max (Epley by default; Brzycki is better for low reps). Only for 1-15 reps. */
export function e1rm(weightKg: number | null | undefined, reps: number | null | undefined, formula: "epley" | "brzycki" = "epley"): number | null {
  if (!weightKg || !reps || reps < 1 || weightKg <= 0) return null;
  if (reps === 1) return weightKg;
  if (reps > 15) return null;
  return formula === "brzycki" ? weightKg * (36 / (37 - reps)) : weightKg * (1 + reps / 30);
}

/** Weight for a rep count at a given 1RM (the inverse of Epley), for the %1RM table */
export const weightForReps = (oneRm: number, reps: number) => (reps <= 1 ? oneRm : oneRm / (1 + reps / 30));

export const countsForVolume = (kind: SetKind) => kind !== "warmup";
/** Weight lifted in one set (weight × reps). Assisted exercises log the help taken off, which isn't weight lifted, so
 * they add nothing; neither does a set with no (or negative) weight. LIFTED_SQL is the same rule for queries. */
export function liftedKg(weightKg: number | string | null | undefined, reps: number | null | undefined, tracking?: Tracking | string | null): number {
  const w = Number(weightKg) || 0;
  if (tracking === "assisted" || w <= 0 || !reps) return 0;
  return w * reps;
}
/** liftedKg in SQL, for a query with the set as `s` and its exercise as `e`. */
export const LIFTED_SQL = "CASE WHEN e.tracking <> 'assisted' AND s.weight_kg > 0 THEN s.weight_kg * coalesce(s.reps, 0) ELSE 0 END";
export function setVolume(s: { kind: SetKind; weightKg: number | null; reps: number | null; done?: boolean }, tracking?: Tracking | null): number {
  if (s.done === false || !countsForVolume(s.kind)) return 0;
  return liftedKg(s.weightKg, s.reps, tracking);
}

export const usesWeight = (t: Tracking) => t === "weight_reps" || t === "bodyweight_reps" || t === "assisted" || t === "weight_duration" || t === "distance_weight";
export const usesReps = (t: Tracking) => t === "weight_reps" || t === "bodyweight_reps" || t === "assisted" || t === "reps_only";
export const usesDuration = (t: Tracking) => t === "duration" || t === "weight_duration" || t === "distance_duration";
export const usesDistance = (t: Tracking) => t === "distance_duration" || t === "distance_weight";

// ----- rest -----

export interface RestDefaults {
  betweenSetsS: number;
  afterExerciseS: number;
  byKindS?: RestByKind; // the person's defaults after warm-up, drop and to-failure sets
}
/** The rest after a set: the set's own rest, else the routine's rest for that kind of set (warm-up, drop…), else the
 * person's default for that kind, else the exercise in the routine, else the person's exercise default, else the global default. */
export function restAfterSet(
  o: { setRestS?: number | null; kind?: SetKind; nextKind?: SetKind; byKindS?: RestByKind | null; exRestS?: number | null; prefRestS?: number | null; isLastSet: boolean; exRestAfterS?: number | null; prefRestAfterS?: number | null },
  d: RestDefaults,
): number {
  if (o.setRestS != null) return o.setRestS;
  // a drop set follows straight on: lower the weight and keep going
  if (o.nextKind === "drop") return 0;
  if (o.isLastSet) return o.exRestAfterS ?? o.prefRestAfterS ?? d.afterExerciseS;
  const k = o.kind && o.kind !== "normal" ? o.byKindS?.[o.kind] ?? d.byKindS?.[o.kind] : null;
  return k ?? o.exRestS ?? o.prefRestS ?? d.betweenSetsS;
}

/** A drop set's starting weight: about 20% lighter than the set before it, on a weight a gym has (2.5 kg or 5 lb steps). */
export function dropWeightKg(kg: number | null | undefined, unit: "kg" | "lb"): number | null {
  if (!kg) return kg ?? null;
  return unit === "lb" ? toKg(Math.max(5, Math.round((fromKg(kg, "lb") * 0.8) / 5) * 5), "lb") : Math.max(2.5, Math.round((kg * 0.8) / 2.5) * 2.5);
}

// ----- how long a routine takes -----

export interface EstimateSet { kind: SetKind; reps: number | null; durationS: number | null; restS: number }
/** Seconds to get going on the next exercise: walk over, set the bench, load the bar. */
export const CHANGEOVER_S = 60;
/** Seconds for one set: from the person's history if known, else ~4 s a rep plus 15 s to get into position and rack it,
 *  or the set's own time plus 10 s. (3 s a rep and no changeover made an hour's workout look like 40 minutes.) */
export function setSeconds(s: { reps: number | null; durationS: number | null }, historyMedianS?: number | null): number {
  if (s.durationS) return s.durationS + 10;
  if (historyMedianS) return historyMedianS;
  return Math.max(20, (s.reps ?? 8) * 4 + 15);
}
/** How long a plan takes by the numbers: every set's time, every planned rest except after the very last set,
 *  and a changeover for each exercise. */
export function estimate(exercises: { sets: EstimateSet[]; medianSetS?: number | null }[]): { totalS: number; workS: number; restS: number; changeS: number } {
  let workS = 0, restS = 0;
  exercises.forEach((ex, i) => {
    ex.sets.forEach((s, j) => {
      workS += setSeconds(s, ex.medianSetS);
      const last = j === ex.sets.length - 1 && i === exercises.length - 1;
      if (!last) restS += s.restS;
    });
  });
  const changeS = exercises.filter((e) => e.sets.length).length * CHANGEOVER_S;
  return { totalS: workS + restS + changeS, workS, restS, changeS };
}
/** How long a routine really takes you: the average of its recent workouts (newest first, in seconds, pauses already
 *  taken out). Looks only at the last 3 usable ones (5 min - 4 h; shorter was given up, longer left running) so it
 *  follows a routine that has changed, and leaves out any of those under half or over twice their median. The newest
 *  usable one is always kept: if it differs a lot, the routine probably changed and that is the news.
 *  `of` is how many went into the average; `newest` is whether the newest workout is one of them. */
export function usualDuration(recentS: number[]): { s: number; of: number; newest: boolean } | null {
  const ok = recentS.map((s, i) => ({ s, i })).filter((x) => x.s >= 300 && x.s <= 4 * 3600).slice(0, 3);
  if (!ok.length) return null;
  const sorted = ok.map((x) => x.s).sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const kept = ok.filter((x, k) => k === 0 || (x.s >= med / 2 && x.s <= med * 2));
  return { s: Math.round(kept.reduce((a, x) => a + x.s, 0) / kept.length), of: kept.length, newest: kept[0]!.i === 0 };
}
/** The time to show for a routine, saying which kind it is: "usually 58m" from your workouts, "58m last time" when it
 *  is just your newest one, "about 55m" from the plan alone. */
export function routineTime(estimateS: number, usual: { s: number; of: number; newest?: boolean } | null | undefined): string {
  if (!usual) return `about ${duration(estimateS, true)}`;
  return usual.of === 1 && usual.newest ? `${duration(usual.s, true)} last time` : `usually ${duration(usual.s, true)}`;
}

// ----- plates and warm-ups -----

export const DEFAULT_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];
export const DEFAULT_PLATES_LB = [45, 35, 25, 10, 5, 2.5];
/** Plates per side for a target weight (in the same unit as bar and plates). Returns what fits and what is left over. */
export function plates(target: number, bar: number, available: number[]): { perSide: number[]; leftover: number } {
  let side = (target - bar) / 2;
  const perSide: number[] = [];
  if (side <= 0) return { perSide, leftover: Math.max(0, target - bar) };
  for (const p of [...available].sort((a, b) => b - a)) {
    while (side >= p - 1e-9) { perSide.push(p); side -= p; }
  }
  return { perSide, leftover: Math.round(side * 2 * 1000) / 1000 };
}
/** Warm-up ramp to a working weight: empty bar ×10, 40% ×5, 60% ×3, 80% ×2 (rounded to the step; skipped when lighter than the bar). */
export function warmups(workKg: number, barKg = 20, stepKg = 2.5): { weightKg: number; reps: number }[] {
  if (workKg <= barKg * 1.5) return [{ weightKg: barKg, reps: 10 }];
  const round = (v: number) => Math.max(barKg, Math.round(v / stepKg) * stepKg);
  const out = [{ weightKg: barKg, reps: 10 }, { weightKg: round(workKg * 0.4), reps: 5 }, { weightKg: round(workKg * 0.6), reps: 3 }, { weightKg: round(workKg * 0.8), reps: 2 }];
  return out.filter((s, i) => i === 0 || (s.weightKg > out[i - 1]!.weightKg && s.weightKg < workKg));
}

// ----- quick text entry: "3x8 80", "80x8, 8, 7", "5x5@100" -----

export function parseQuick(text: string): { weight: number | null; reps: number }[] | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  let m = /^(\d+)\s*[x×]\s*(\d+)\s*(?:@|\s)\s*(\d+(?:[.,]\d+)?)$/.exec(t); // 3x8 80 / 3x8@80
  if (m) return Array.from({ length: +m[1]! }, () => ({ weight: parseFloat(m![3]!.replace(",", ".")), reps: +m![2]! }));
  m = /^(\d+(?:[.,]\d+)?)\s*[x×]\s*([\d ,]+)$/.exec(t); // 80x8,8,7
  if (m) {
    const reps = m[2]!.split(/[ ,]+/).filter(Boolean).map(Number);
    if (reps.length && reps.every((r) => r > 0)) return reps.map((r) => ({ weight: parseFloat(m![1]!.replace(",", ".")), reps: r }));
  }
  m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(t); // 3x10 (no weight)
  if (m) return Array.from({ length: +m[1]! }, () => ({ weight: null, reps: +m![2]! }));
  return null;
}

/** Monday-or-Sunday start of the week containing a date (local), as YYYY-MM-DD */
export function weekStartOf(d: Date, firstDay: 0 | 1): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (x.getDay() - firstDay + 7) % 7;
  x.setDate(x.getDate() - diff);
  return ymd(x);
}
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ----- strength standards: a rough guide from one-rep max ÷ body weight (common gym rules of thumb) -----
export const LEVELS = ["Beginner", "Novice", "Intermediate", "Advanced", "Elite"];
const STD: { match: RegExp; male: number[]; female: number[] }[] = [
  { match: /\bsquat\b/i, male: [0.75, 1.25, 1.5, 2.25, 2.75], female: [0.5, 0.75, 1.25, 1.5, 2] },
  { match: /bench press/i, male: [0.5, 0.75, 1.25, 1.75, 2], female: [0.25, 0.5, 0.75, 1, 1.5] },
  { match: /deadlift/i, male: [1, 1.5, 2, 2.5, 3], female: [0.5, 1, 1.25, 1.75, 2.5] },
  { match: /military press|overhead press|shoulder press/i, male: [0.35, 0.55, 0.8, 1.1, 1.4], female: [0.2, 0.35, 0.5, 0.75, 1] },
  { match: /barbell row|bent over/i, male: [0.5, 0.75, 1, 1.5, 1.75], female: [0.25, 0.4, 0.65, 0.9, 1.2] },
];
/** Where a lift stands: the level reached, the ratio, and the next level's weight. Null when there's no standard. */
export function strengthLevel(exerciseName: string, oneRmKg: number, bodyweightKg: number, sex: "male" | "female" | "" = "") {
  const s = STD.find((x) => x.match.test(exerciseName));
  if (!s || !bodyweightKg || !oneRmKg) return null;
  const t = sex === "female" ? s.female : s.male;
  const ratio = oneRmKg / bodyweightKg;
  let lvl = -1;
  t.forEach((v, i) => { if (ratio >= v) lvl = i; });
  return { ratio, level: lvl >= 0 ? LEVELS[lvl]! : "Getting started", next: lvl < t.length - 1 ? { level: LEVELS[lvl + 1]!, kg: t[lvl + 1]! * bodyweightKg } : null, thresholds: t.map((v) => v * bodyweightKg) };
}
