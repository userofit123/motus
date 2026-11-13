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
  // a set done for time lifts nothing, even with reps left over from before it was switched
  if ((tracking && !liftsWeight(tracking)) || w <= 0 || !reps) return 0;
  return w * reps;
}
export function setVolume(s: { kind: SetKind; weightKg: number | null; reps: number | null; done?: boolean }, tracking?: Tracking | null): number {
  if (s.done === false || !countsForVolume(s.kind)) return 0;
  return liftedKg(s.weightKg, s.reps, tracking);
}

// What an exercise tracks is two choices: what each set is counted by, and whether weight goes with it (a load, weight
// added to the body, or help taken off). Every Tracking value is one combination of the two, so the columns, records
// and conversions all read from this one table.
export type CountedBy = "reps" | "time" | "distance" | "distance_time" | "reps_time";
export type WeightKind = "none" | "weight" | "added" | "assisted";
const GRID: Record<CountedBy, Partial<Record<WeightKind, Tracking>>> = {
  reps: { none: "reps_only", weight: "weight_reps", added: "bodyweight_reps", assisted: "assisted" },
  time: { none: "duration", weight: "weight_duration" },
  distance: { none: "distance", weight: "distance_weight" },
  distance_time: { none: "distance_duration", weight: "distance_weight_duration" },
  reps_time: { none: "reps_duration", weight: "weight_reps_duration" },
};
const PARTS = Object.fromEntries(Object.entries(GRID).flatMap(([c, ws]) => Object.entries(ws).map(([w, t]) => [t, [c, w]]))) as Record<Tracking, [CountedBy, WeightKind]>;
/** Every Tracking value, for checking what a request sends. */
export const TRACKINGS = Object.keys(PARTS) as Tracking[];
export const COUNTED_BY: { value: CountedBy; label: string }[] = [
  { value: "reps", label: "Reps" }, { value: "time", label: "Time" }, { value: "distance", label: "Distance" },
  { value: "distance_time", label: "Distance + time" }, { value: "reps_time", label: "Reps + time" },
];
const WEIGHT_LABEL: Record<WeightKind, string> = { none: "None", weight: "Weight", added: "Added to bodyweight", assisted: "Assisted" };
/** The weight choices that go with a way of counting ("Added to bodyweight" and "Assisted" only with reps). */
export const weightKindsFor = (c: CountedBy) => (Object.keys(GRID[c]) as WeightKind[]).map((value) => ({ value, label: WEIGHT_LABEL[value] }));
/** The two choices an exercise's tracking is made of. */
export const trackingParts = (t: Tracking): { counted: CountedBy; weight: WeightKind } => {
  const [counted, weight] = PARTS[t] ?? PARTS.weight_reps;
  return { counted, weight };
};
/** The tracking for a pair of choices. A weight kind that doesn't go with the way of counting falls back to the nearest
 * that does: weight added to the body is a load like any other (a weighted plank), help taken off is no weight held. */
export function trackingFrom(counted: CountedBy, weight: WeightKind): Tracking {
  const g = GRID[counted];
  return g[weight] ?? (weight === "added" ? g.weight : undefined) ?? g.none!;
}
/** What it tracks in words, "Time + weight", for menus and Details. */
export function trackingLabel(t: Tracking): string {
  const { counted, weight } = trackingParts(t);
  const c = COUNTED_BY.find((x) => x.value === counted)!.label;
  return weight === "none" ? c : weight === "added" ? `${c} + added weight` : weight === "assisted" ? `${c} + assistance` : `${c} + weight`;
}

// a value it doesn't know uses nothing, as before
const part = (t: Tracking | string | null | undefined): [CountedBy | null, WeightKind] => PARTS[t as Tracking] ?? [null, "none"];
export const usesWeight = (t: Tracking) => part(t)[1] !== "none";
export const usesReps = (t: Tracking) => part(t)[0] === "reps" || part(t)[0] === "reps_time";
export const usesDuration = (t: Tracking) => part(t)[0] === "time" || part(t)[0] === "distance_time" || part(t)[0] === "reps_time";
export const usesDistance = (t: Tracking) => part(t)[0] === "distance" || part(t)[0] === "distance_time";
/** Whether Progression can move it: weight and reps, not against the clock (as many reps as fit is no range to climb). */
export const progresses = (t: Tracking) => usesWeight(t) && usesReps(t) && !usesDuration(t);

// Each person can choose what any exercise tracks, built-in ones too (exercise_prefs.tracking, null keeps the exercise's
// own way). It stays one way per exercise, so its records, charts and "next time" all read the same kind of number.
/** The tracking in effect, in SQL, for a query with the exercise as `e` and its prefs joined as `p`. */
export const TRACKING_SQL = "coalesce(p.tracking, e.tracking)";
/** What a set starts with once its exercise tracks something else: what a new exercise's sets start with (8 reps,
 * 30 seconds, 400 m; a distance done against the clock takes the time it takes, so it plans none), weight kept while
 * it stays the same kind of weight (a load stays a load, help stays help). Returns the fields, null when the set already fits. */
export const NEW_SET_REPS = 8, NEW_SET_S = 30, NEW_SET_M = 400;
type SetNumbers = { reps: number | null; durationS: number | null; distanceM: number | null; weightKg: number | null };
export function keepsWeight(before: Tracking, after: Tracking) {
  return usesWeight(before) && usesWeight(after) && (before === "assisted") === (after === "assisted");
}
export function refitSet(s: { reps?: number | null; durationS?: number | null; distanceM?: number | string | null; weightKg?: number | null }, before: Tracking, after: Tracking): SetNumbers | null {
  const next: SetNumbers = {
    reps: usesReps(after) ? s.reps || NEW_SET_REPS : null,
    durationS: usesDuration(after) ? s.durationS || (usesDistance(after) ? null : NEW_SET_S) : null,
    distanceM: usesDistance(after) ? Number(s.distanceM) || NEW_SET_M : null,
    weightKg: keepsWeight(before, after) ? s.weightKg ?? null : null,
  };
  const same = next.reps === (s.reps ?? null) && next.durationS === (s.durationS ?? null)
    && next.distanceM === (s.distanceM == null ? null : Number(s.distanceM)) && next.weightKg === (s.weightKg ?? null);
  return same ? null : next;
}
/** A new set's numbers for an exercise that tracks `t` (the routine editor's first sets). */
export const newSetFor = (t: Tracking) => refitSet({}, "reps_only", t) ?? { reps: NEW_SET_REPS, durationS: null, distanceM: null, weightKg: null };

// weight × reps is lifted only by an exercise counted in reps whose weight is a load (assisted weight is help); reps
// against the clock (kettlebell swings in 60 s) lift it too
const LIFTS: Tracking[] = ["weight_reps", "bodyweight_reps", "reps_only", "reps_duration", "weight_reps_duration"];
/** Whether its sets lift weight × reps (volume, one-rep max): counted in reps, with a load rather than help. */
export const liftsWeight = (t: Tracking | string | null | undefined) => LIFTS.includes(t as Tracking);
/** liftedKg in SQL, for a query with the set as `s` and its exercise as `e`: reads the person's own reps-or-time choice. */
export const LIFTED_SQL = `CASE WHEN s.weight_kg > 0 AND (SELECT ${TRACKING_SQL} FROM (SELECT 1) one LEFT JOIN exercise_prefs p ON p.exercise_id = e.id AND p.user_id = s.user_id) IN (${LIFTS.map((t) => `'${t}'`).join(",")})
  THEN s.weight_kg * coalesce(s.reps, 0) ELSE 0 END`;

// ----- rest -----

export interface RestDefaults {
  betweenSetsS: number;
  afterExerciseS: number;
  byKindS?: RestByKind; // the person's defaults after warm-up, drop and to-failure sets
  // a stretch's defaults: between holds just the time to get back into position, then on to the next stretch
  stretchBetweenS?: number;
  stretchAfterS?: number;
}
/** Whether an exercise is a stretch (its catalog category), which rests by the stretch defaults. Keyed on the category,
 * not on what it tracks: a plank or a dead hang held for time is effort and rests like any other exercise. */
export const isStretch = (ex: { category?: string | null } | null | undefined) => ex?.category === "stretching";
type SidedSet = { kind?: string | null; side?: string | null };
/** For each set, whether it opens a round with the set straight after it: a left set and a right one next to each other
 * (either order) of the same kind are one round, sharing a number with no rest between them; L R L R is two rounds.
 * Drops never pair (they follow their own set). */
export function sideRounds(sets: SidedSet[]): boolean[] {
  const out = sets.map(() => false);
  for (let i = 0; i + 1 < sets.length; i++) {
    const a = sets[i]!, b = sets[i + 1]!;
    if (a.kind !== "drop" && a.kind === b.kind && ((a.side === "L" && b.side === "R") || (a.side === "R" && b.side === "L"))) { out[i] = true; i++; }
  }
  return out;
}
/** Whether set `j` opens a left and right round with the next one (sideRounds). */
export const opensSideRound = (sets: SidedSet[], j: number) => sideRounds(sets)[j] ?? false;
/** Which left and right rounds read as one split set, so every list of sets joins their two badges with a bar: for each
 * set, whether it opens one. A round (sideRounds: neighbouring left and right of the same kind, no drops) whose first side
 * has no rest after it (`restAfter`, the screen's own rest rule: the workout's rest, the stored plan, the routine's plan).
 * Warm-ups stay out: both their badges say just "W". */
export function sideJoins(sets: SidedSet[], restAfter: (j: number) => number): boolean[] {
  return sideRounds(sets).map((r, j) => r && sets[j]!.kind !== "warmup" && restAfter(j) === 0);
}

/** The rest after a set: the set's own rest, else for a warm-up, drop or to-failure set the routine's rest for that kind,
 * else the person's default for that kind as Settings shows it (unset: "Same as between sets", the between-sets default),
 * never the exercise's working-set rest (a warm-up in a 2:00 exercise rested 2:00 while Settings said 1:30); a normal set
 * takes the exercise in the routine, else the person's exercise default, else the global default. A stretch (`stretch`)
 * falls back to the stretch defaults instead of the lifting ones (by kind too), once nothing more specific is set.
 * None before a drop set, nor inside a left and right round (`sideRound`: this set opens one, see sideRounds). */
export function restAfterSet(
  o: { setRestS?: number | null; kind?: SetKind; nextKind?: SetKind; sideRound?: boolean; stretch?: boolean; byKindS?: RestByKind | null; exRestS?: number | null; prefRestS?: number | null; isLastSet: boolean; exRestAfterS?: number | null; prefRestAfterS?: number | null },
  d: RestDefaults,
): number {
  if (o.setRestS != null) return o.setRestS;
  // a drop set follows straight on: lower the weight and keep going
  if (o.nextKind === "drop") return 0;
  // a left and right round: switch sides straight away, the rest comes after the second side
  if (o.sideRound) return 0;
  const between = o.stretch ? d.stretchBetweenS ?? d.betweenSetsS : d.betweenSetsS;
  if (o.isLastSet) return o.exRestAfterS ?? o.prefRestAfterS ?? (o.stretch ? d.stretchAfterS ?? d.afterExerciseS : d.afterExerciseS);
  if (o.kind && o.kind !== "normal") return o.byKindS?.[o.kind] ?? (o.stretch ? between : d.byKindS?.[o.kind] ?? between);
  return o.exRestS ?? o.prefRestS ?? between;
}

/** What a workout exercise's planned rests are worked out from: the exercise's rests as they are now, and from the
 * routine as it was at Start its rests by kind and each set's own rest (by position). */
export interface SetRestInputs {
  restS?: number | null; restAfterS?: number | null; prefRestS?: number | null; prefRestAfterS?: number | null;
  restByKind?: RestByKind | null; routineSetRests?: (number | null)[] | null;
  /** the exercise, for whether it is a stretch (isStretch) */
  exercise?: { category?: string | null } | null;
}
/** The rest planned after set `i` of a workout exercise, as Start plans it and as the server plans it again when a set
 * changes kind or side: one rule for both, so the workout screen shows the new rest before the server's copy is back.
 * Workout sets carry no link to their routine set, so they match the routine's by position, which holds only while no
 * set was added or removed (a drop added after set 1 would take routine set 2's rest); once the count differs, sets
 * rest by kind and the exercise's rests. */
export function planSetRest(sets: SidedSet[], i: number, x: SetRestInputs, d: RestDefaults, isLastSet = i === sets.length - 1): number {
  const own = x.routineSetRests?.length === sets.length ? x.routineSetRests[i] : undefined;
  return restAfterSet({ setRestS: own, kind: (sets[i]?.kind ?? undefined) as SetKind | undefined, nextKind: (sets[i + 1]?.kind ?? undefined) as SetKind | undefined,
    sideRound: opensSideRound(sets, i), stretch: isStretch(x.exercise), byKindS: x.restByKind, exRestS: x.restS, prefRestS: x.prefRestS, isLastSet, exRestAfterS: x.restAfterS, prefRestAfterS: x.prefRestAfterS }, d);
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
