// Routine check (M-273, the Routine check feature): a routine or a program's week scored 0-100 against training research,
// each check saying what it found and what to change. Pure, so the rules are tested once and the pages only show them.
// Sets are counted as Stats → Muscles and the Strength score count them (muscleSets: a working set 1 for each main muscle,
// 0.5 for each helper; warm-ups left out), so the three never disagree. Every rule sits next to the research it comes
// from; the lesson behind "Where the aims come from" gives the full references. Each routine is checked on its own (a week
// of that routine alone); a program's week checks its workouts together. Left out on purpose:
// - total sets or minutes per session: no clear limit fits everyone;
// - a goal (strength or size): Motus doesn't ask for one, so reps are only checked against the range that does both.
import { muscleSets } from "./muscles";
import type { SetKind } from "./types";

export const CHECK_SOURCES = "Schoenfeld et al. 2016, 2017 and 2021, ACSM 2009 and Simão et al. 2012";

/** The muscles a week is checked for, each with a lift to suggest. Back is lats and middle back, counted by the busier
 *  of the two, so a row (middle back 1, lats 0.5) counts once. Neck, forearms, traps and the hip muscles are left out,
 *  as the big lifts work them anyway. */
export const CHECK_MUSCLES: { id: string; name: string; muscles: string[]; example: string }[] = [
  { id: "chest", name: "Chest", muscles: ["chest"], example: "Bench press" },
  { id: "back", name: "Back", muscles: ["lats", "middle back"], example: "Barbell row" },
  { id: "shoulders", name: "Shoulders", muscles: ["shoulders"], example: "Overhead press" },
  { id: "biceps", name: "Biceps", muscles: ["biceps"], example: "Dumbbell curl" },
  { id: "triceps", name: "Triceps", muscles: ["triceps"], example: "Triceps pushdown" },
  { id: "quadriceps", name: "Quads", muscles: ["quadriceps"], example: "Squat" },
  { id: "hamstrings", name: "Hamstrings", muscles: ["hamstrings"], example: "Romanian deadlift" },
  { id: "glutes", name: "Glutes", muscles: ["glutes"], example: "Hip thrust" },
  { id: "calves", name: "Calves", muscles: ["calves"], example: "Standing calf raise" },
  { id: "abdominals", name: "Abs", muscles: ["abdominals"], example: "Cable crunch" },
];

/** Schoenfeld, Ogborn & Krieger 2017 (and Baz-Valle et al. 2022): 10-20 hard sets a week per muscle build the most */
export const CHECK_SETS: [number, number] = [10, 20];
/** Schoenfeld, Ogborn & Krieger 2016: training a muscle on 2 or more days a week built more than once. A muscle is
 *  checked from DAY_SETS sets a week. A day counts for it when it is the main muscle of a lift that day, or gets at
 *  least 1 set as a helper (2 helper sets), so a bench press trains the triceps but a helper's odd half set doesn't. */
export const TWICE = 2, DAY_SETS = 2;
/** ACSM 2009: balance opposing muscles. Pulling sets at 0.75-1.5 times the pushing ones, hamstrings at 0.5-2 times quads */
export const PULL_PUSH: [number, number] = [0.75, 1.5];
export const HAMS_QUADS: [number, number] = [0.5, 2];
/** Schoenfeld et al. 2021: muscle grows from about 5 to 30 reps a set when sets end near failure */
export const CHECK_REPS: [number, number] = [5, 30];
export const CHECK_WEIGHTS = { volume: 40, frequency: 20, pushPull: 10, legs: 10, order: 10, reps: 10 } as const;

const UPPER = new Set(["chest", "shoulders", "triceps", "biceps", "lats", "middle back", "traps", "forearms"]);
const NOT_LIFTING = new Set(["cardio", "stretching"]);

/** An exercise as the check reads it (a routine's exercise with its library entry) */
export interface CheckExercise {
  name: string; primary: string[]; secondary: string[];
  mechanic: string | null; force: string | null; category: string;
  superset?: string | null;
  sets: { kind: SetKind; reps: number | null }[];
}
/** One workout: a routine's exercises in order */
export type CheckSession = CheckExercise[];

export type CheckKey = keyof typeof CHECK_WEIGHTS;
export interface Check {
  key: CheckKey;
  title: string;
  weight: number;
  /** how much of the target is met, 0-1 (the points it earns) */
  share: number;
  /** "good" only when the target is met in full, which is what the card counts as met */
  status: "good" | "fair" | "low";
  /** the short value on the row's right, naming what it counts ("7 of 10 muscles"); two counts are joined by " · "
   *  ("15 push · 4 pull"); the card stacks each count over its noun */
  value: string;
  /** what it found and, when not met, what to change */
  detail: string;
}
export interface RoutineCheck {
  score: number;
  label: "Good" | "Fair" | "Low";
  checks: Check[];
  /** sets a week per checked muscle (CHECK_MUSCLES ids), for the figure and tests */
  sets: Record<string, number>;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const statusOf = (s: number): Check["status"] => (s >= 1 ? "good" : s >= 0.5 ? "fair" : "low");
const r1 = (x: number) => Math.round(x * 2) / 2;
const n = (x: number) => String(r1(x));
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${r1(x) === 1 ? one : many}`;
/** " and 2 more muscles" after the first one named, so a row's detail stays one short sentence */
const more = (k: number, what = "muscle") => (k > 0 ? ` and ${k} more ${k === 1 ? what : `${what}s`}` : "");
/** "biceps", "biceps and abs", "biceps, abs and calves" */
const names = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/** a muscle's name inside a sentence */
const low1 = (m: { name: string }) => m.name.toLowerCase();
const lifting = (s: CheckSession) => s.filter((e) => !NOT_LIFTING.has(e.category));
const working = (e: CheckExercise) => e.sets.filter((s) => s.kind !== "warmup");

/** Sets per muscle over workouts (every muscle, for a figure), counted as the check counts them */
export const weekMuscleSets = (days: CheckSession[]) =>
  muscleSets(days.flatMap(lifting).map((e) => ({ primary: e.primary, secondary: e.secondary, sets: working(e).length })));

/** One workout's sets per checked muscle, and the checked muscles that are a lift's main muscle in it */
interface Day { sets: Record<string, number>; main: Set<string> }
function dayOf(s: CheckSession): Day {
  const per = weekMuscleSets([s]);
  const mains = new Set(lifting(s).filter((e) => working(e).length).flatMap((e) => e.primary));
  return {
    sets: Object.fromEntries(CHECK_MUSCLES.map((m) => [m.id, Math.max(0, ...m.muscles.map((x) => per[x] ?? 0))])),
    main: new Set(CHECK_MUSCLES.filter((m) => m.muscles.some((x) => mains.has(x))).map((m) => m.id)),
  };
}

/** Sets a week per muscle: under 10 counts its share of 10, 10-20 in full, over 20 a little less (harder to recover
 *  from for little extra). `all`: every checked muscle counts (a week); otherwise only the ones it trains (a routine
 *  may be one day of a split). */
function volume(week: Record<string, number>, all: boolean, span: string): Check | null {
  const [lo, hi] = CHECK_SETS;
  const ms = CHECK_MUSCLES.filter((m) => all || week[m.id]! > 0);
  if (!ms.length) return null;
  const shareOf = (s: number) => (s > hi ? 0.8 : clamp01(s / lo));
  const share = ms.reduce((t, m) => t + shareOf(week[m.id]!), 0) / ms.length;
  const met = ms.filter((m) => week[m.id]! >= lo && week[m.id]! <= hi).length;
  const low = ms.filter((m) => week[m.id]! < lo).sort((a, b) => week[a.id]! - week[b.id]!);
  const high = ms.filter((m) => week[m.id]! > hi);
  // cause then advice for the biggest gap, then the other short muscles by name, so the row says which they are
  const first = low[0];
  const detail = first ? `${week[first.id]! ? `Only ${plural(week[first.id]!, "set")}` : "No sets"} ${span} for ${low1(first)}: add ${Math.ceil(lo - week[first.id]!)}, e.g. ${first.example}.${low.length > 1 ? ` ${cap(names(low.slice(1).map(low1)))} need more too.` : ""}`
    : high.length ? `Over ${hi} sets ${span} for ${names(high.map(low1))}: drop a few, as they add little.`
    : `Every muscle ${all ? "" : "it trains "}gets ${lo}-${hi} sets ${span}.`;
  return { key: "volume", title: `${lo}-${hi} sets ${span} per muscle`, weight: CHECK_WEIGHTS.volume, share, status: statusOf(share), value: `${met} of ${plural(ms.length, "muscle")}`, detail };
}

/** The share of trained muscles on 2 or more days a week */
function frequency(days: Day[], week: Record<string, number>): Check | null {
  const ms = CHECK_MUSCLES.filter((m) => week[m.id]! >= DAY_SETS);
  if (!ms.length) return null;
  const on = (m: string) => days.filter((d) => d.main.has(m) || d.sets[m]! >= 1).length;
  const once = ms.filter((m) => on(m.id) < TWICE);
  const share = (ms.length - once.length) / ms.length;
  const detail = !once.length ? `Each muscle is trained on ${TWICE} or more days a week.`
    : days.length === 1 ? "Done once a week, so each muscle is trained on 1 day: do it twice a week."
    : once.length === 1 ? `${once[0]!.name} is trained on 1 day a week: spread its sets over 2 days.`
    : `${once[0]!.name}${more(once.length - 1)} are trained on 1 day a week: spread their sets over 2 days.`;
  return { key: "frequency", title: "Muscles trained twice a week", weight: CHECK_WEIGHTS.frequency, share, status: statusOf(share), value: `${ms.length - once.length} of ${plural(ms.length, "muscle")}`, detail };
}

/** A ratio's share of its range: in it in full, outside it by how far */
const ratioShare = (x: number, [lo, hi]: [number, number]) => (x < lo ? clamp01(x / lo) : x > hi ? clamp01(hi / x) : 1);

function pushPull(sessions: CheckSession[], both: boolean, span: string): Check | null {
  let push = 0, pull = 0;
  for (const e of sessions.flatMap(lifting)) {
    if (!e.primary.length || !e.primary.every((m) => UPPER.has(m))) continue;
    if (e.force === "push") push += working(e).length;
    if (e.force === "pull") pull += working(e).length;
  }
  if (both ? !push || !pull : !push && !pull) return null;
  const ratio = push ? pull / push : Infinity;
  const share = ratioShare(ratio, PULL_PUSH);
  const detail = share >= 1 ? "Pulling sets about match pushing sets."
    : ratio < PULL_PUSH[0] ? `Pulling has too few sets next to pushing: add ${Math.ceil(push * PULL_PUSH[0] - pull)} pulling sets ${span}, e.g. Barbell row.`
    : `Pushing has too few sets next to pulling: add ${Math.ceil(pull / PULL_PUSH[1] - push)} pushing sets ${span}, e.g. Bench press.`;
  return { key: "pushPull", title: "Pushing and pulling sets", weight: CHECK_WEIGHTS.pushPull, share, status: statusOf(share), value: `${n(push)} push · ${n(pull)} pull`, detail };
}

function legs(week: Record<string, number>, both: boolean, span: string): Check | null {
  const q = week.quadriceps!, h = week.hamstrings!;
  if (both ? !q || !h : !q && !h) return null;
  const ratio = q ? h / q : Infinity;
  const share = ratioShare(ratio, HAMS_QUADS);
  const detail = share >= 1 ? "Hamstrings get at least half the sets quads get."
    : ratio < HAMS_QUADS[0] ? `Hamstrings have too few sets next to quads: add ${Math.ceil(q * HAMS_QUADS[0] - h)} hamstring sets ${span}, e.g. Romanian deadlift.`
    : `Quads have too few sets next to hamstrings: add ${Math.ceil(h / HAMS_QUADS[1] - q)} quad sets ${span}, e.g. Squat.`;
  return { key: "legs", title: "Quad and hamstring sets", weight: CHECK_WEIGHTS.legs, share, status: statusOf(share), value: `${n(q)} quad · ${n(h)} hamstring`, detail };
}

/** ACSM 2009 and Simão et al. 2012: lifts done first get the most reps and weight, so lifts that work several muscles
 *  come before single-muscle ones that tire the same muscles (in one superset they alternate, so order doesn't count) */
function order(sessions: CheckSession[]): Check | null {
  let compounds = 0;
  const late: { lift: string; after: string }[] = [];
  // a day done twice a week is read once, so its lifts aren't counted twice
  for (const s of [...new Set(sessions)].map(lifting)) {
    s.forEach((e, i) => {
      if (e.mechanic !== "compound") return;
      compounds++;
      const uses = new Set([...e.primary, ...e.secondary]);
      const before = s.slice(0, i).find((b) => b.mechanic === "isolation" && !(e.superset && b.superset === e.superset) && b.primary.some((m) => uses.has(m)));
      if (before) late.push({ lift: e.name, after: before.name });
    });
  }
  if (!compounds || !sessions.some((s) => s.some((e) => e.mechanic === "isolation"))) return null;
  const share = 1 - late.length / compounds;
  const first = late[0];
  const detail = !first ? "Big lifts, the ones that work several muscles, come before single-muscle lifts."
    : `${first.lift} works several muscles, but ${first.after} tires them first: do ${first.lift} first.${late.length > 1 ? ` ${late.length - 1} more big ${late.length === 2 ? "lift comes" : "lifts come"} late too.` : ""}`;
  return { key: "order", title: "Big lifts first", weight: CHECK_WEIGHTS.order, share, status: statusOf(share), value: `${compounds - late.length} of ${compounds} big ${compounds === 1 ? "lift" : "lifts"}`, detail };
}

function reps(sessions: CheckSession[]): Check | null {
  const [lo, hi] = CHECK_REPS;
  let total = 0, inRange = 0;
  let few: string | null = null, many: string | null = null, fewN = 0, manyN = 0;
  for (const e of [...new Set(sessions)].flatMap(lifting)) for (const s of working(e)) {
    if (s.reps == null) continue;
    total++;
    if (s.reps < lo) { fewN++; few ??= `${e.name} targets ${plural(s.reps, "rep")}`; }
    else if (s.reps > hi) { manyN++; many ??= `${e.name} targets ${s.reps} reps`; }
    else inRange++;
  }
  if (!total) return null;
  const share = inRange / total;
  // the side with more sets outside the range, so the row gives one tip
  const detail = many && manyN >= fewN ? `${many}, more than builds muscle: add weight so ${hi} or fewer are hard.`
    : few ? `${few}, good for strength: use ${lo}-${hi} reps to build more muscle.`
    : `Every working set targets ${lo}-${hi} reps.`;
  return { key: "reps", title: `${lo}-${hi} reps per set`, weight: CHECK_WEIGHTS.reps, share, status: statusOf(share), value: `${inRange} of ${plural(total, "set")}`, detail };
}

function total(checks: (Check | null)[], sets: Record<string, number>): RoutineCheck | null {
  const cs = checks.filter((c): c is Check => !!c);
  if (!cs.length) return null;
  const w = cs.reduce((t, c) => t + c.weight, 0);
  const score = Math.round((cs.reduce((t, c) => t + c.share * c.weight, 0) / w) * 100);
  return { score, label: score >= 80 ? "Good" : score >= 50 ? "Fair" : "Low", checks: cs, sets };
}

/** A week of workouts, each a session in order */
function weekOf(days: CheckSession[], whole: boolean): RoutineCheck | null {
  const per = days.map(dayOf);
  const sets = Object.fromEntries(CHECK_MUSCLES.map((m) => [m.id, per.reduce((t, d) => t + d.sets[m.id]!, 0)]));
  const span = "a week";
  return total([volume(sets, whole, span), frequency(per, sets), pushPull(days, !whole, span), legs(sets, !whole, span), order(days), reps(days)], sets);
}

/** One routine, done `perWeek` times a week. It may be one day of a split, so only the muscles it trains are checked,
 *  and balance only where it has both sides. null when it has no lifting with sets. */
export function routineCheck(session: CheckSession, perWeek: number): RoutineCheck | null {
  if (!lifting(session).some((e) => working(e).length)) return null;
  return weekOf(Array.from({ length: Math.max(1, Math.round(perWeek)) }, () => session), false);
}

/** A program's week: its workouts in order. Every major muscle is checked, since a week should cover them all. */
export function programCheck(days: CheckSession[]): RoutineCheck | null {
  if (!days.some((s) => lifting(s).some((e) => working(e).length))) return null;
  return weekOf(days, true);
}
