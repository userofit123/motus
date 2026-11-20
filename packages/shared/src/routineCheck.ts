// Routine check (M-273, the Routine check feature): a routine or a program's week scored 0-100 against training research,
// each check saying what it measured, the result and what to change, and carrying what its popup shows (the numbers per
// muscle or exercise, the target and a short reason, the research in detail and the sources). Pure, so the rules are tested once and the pages only show them.
// Sets are counted as Stats → Muscles and the Strength score count them (muscleSets: a working set 1 for each main muscle,
// 0.5 for each helper; warm-ups left out), so the three never disagree.
// The checks split by what they are about (M-287): sets per muscle in the week, twice a week and balance are about a week
// of training, so only a program checks them, over one week with every workout together; exercise order, reps, sets per
// muscle in one session and rest are about one workout, so a routine checks only those, whether or not it is in a program.
// The targets follow the program's goal (M-291): a routine takes the goal of the program it is in (the page picks which).
// Left out on purpose:
// - total minutes per session and warm-ups: no clear target fits everyone (warm-up studies disagree, Ribeiro et al. 2014);
// - cardio for fat loss: a program holds only routines, so Motus has no cardio in it to check.
import { muscleSets } from "./muscles";
import type { SetKind } from "./types";

/** What a program trains for. Only goals the research gives different targets for (ACSM 2009 sets apart strength,
 *  muscle size and local muscular endurance; fat loss and health have their own guidance):
 *  - size: muscle growth ("size" and "getting big" are this one goal) - Schoenfeld 2017, 2021; Pelland 2024;
 *  - strength: the most weight lifted - heavier loads, longer rests (ACSM 2009; Schoenfeld 2017);
 *  - fatLoss: keep muscle while losing weight - lifting heavy enough and often enough keeps it (Helms et al. 2015;
 *    Bickel et al. 2011), the weight loss itself comes from eating less;
 *  - endurance: more reps before tiring - light loads, many reps, short rests (ACSM 2009; Schoenfeld 2021);
 *  - health: general fitness - every major muscle on 2 or more days a week (WHO 2020; ACSM 2009 for beginners).
 *  Power (fast, explosive lifts) is left out: it needs bar speed, which Motus doesn't record. */
export type ProgramGoal = "size" | "strength" | "fatLoss" | "endurance" | "health";
export const DEFAULT_GOAL: ProgramGoal = "size";

export type CheckKey = "volume" | "frequency" | "pushPull" | "legs" | "order" | "reps" | "session" | "rest";

export interface GoalTargets {
  id: ProgramGoal;
  name: string;
  /** inside a sentence: "for muscle size" */
  lower: string;
  /** what the goal means, under the program form's choice */
  hint: string;
  /** reps per working set; `bigReps`: big lifts only, when they differ (strength) */
  reps: [number, number];
  bigReps?: [number, number];
  /** the fewest working sets a week per muscle */
  weekSets: number;
  /** rest between working sets of a big lift, seconds (Infinity: no upper limit) */
  rest: [number, number];
  /** each check's points; a routine's (order, reps, session, rest) and a program's (volume, frequency, pushPull, legs)
   *  each add up to 100 */
  weights: Record<CheckKey, number>;
}

const PROGRAM_W = { volume: 45, frequency: 25, pushPull: 15, legs: 15 };
export const GOALS: Record<ProgramGoal, GoalTargets> = {
  // Schoenfeld et al. 2017 and 2021: 5-30 reps near failure build about the same muscle; Schoenfeld, Ogborn & Krieger
  // 2017: 10+ sets a week clearly more than under 5; Singer et al. 2024: rests over 60 s a little better, no gain past 90 s
  size: { id: "size", name: "Muscle size", lower: "muscle size", hint: "Build bigger muscles: 10 or more sets a week for each muscle, 5-30 reps a set, each set close to failure.",
    reps: [5, 30], weekSets: 10, rest: [90, Infinity], weights: { ...PROGRAM_W, reps: 35, session: 30, order: 15, rest: 20 } },
  // ACSM 2009: 1-6 reps and 3-5 minutes' rest on the main lifts for strength; Schoenfeld et al. 2017: heavy loads build more
  // strength than light; Pelland et al. 2024: strength needs fewer weekly sets than size; Nunes et al. 2021: a lift gains
  // most strength when it is done early in the workout, so order counts more here
  strength: { id: "strength", name: "Strength", lower: "strength", hint: "Lift heavier weights: do the big lifts (ones that work several muscles, such as squat or bench press) first in the workout, 1-6 reps a set, with at least 3 minutes' rest between their sets.",
    reps: [5, 30], bigReps: [1, 6], weekSets: 5, rest: [180, Infinity], weights: { ...PROGRAM_W, reps: 35, order: 30, rest: 20, session: 15 } },
  // Helms et al. 2015: while dieting, keep lifting heavy so the body keeps its muscle; Bickel et al. 2011: about a third of
  // the sets kept the muscle gained, so 6 sets a week is a careful floor; reps and rest as for size
  fatLoss: { id: "fatLoss", name: "Fat loss", lower: "fat loss", hint: "Keep your muscle while you lose weight: keep lifting heavy, at least 6 sets a week for each muscle. The weight loss itself comes from eating less.",
    reps: [5, 30], weekSets: 6, rest: [90, Infinity], weights: { ...PROGRAM_W, reps: 35, session: 30, order: 15, rest: 20 } },
  // ACSM 2009: light loads for 15 or more reps and short rests (1-2 minutes, under 1 for moderate reps) for endurance;
  // research gives no weekly set count for it, so 6 keeps every muscle trained
  endurance: { id: "endurance", name: "Muscular endurance", lower: "muscular endurance", hint: "Keep going longer before your muscles tire: light weights for 15 or more reps a set, with 1:30 rest or less between sets.",
    reps: [15, 100], weekSets: 6, rest: [0, 90], weights: { ...PROGRAM_W, reps: 40, rest: 25, session: 20, order: 15 } },
  // WHO 2020: every major muscle group on 2 or more days a week; ACSM 2009: 8-12 reps for beginners (up to 15 for older
  // adults), 1-3 sets an exercise, so about 4 sets a week per muscle over 2 days
  health: { id: "health", name: "General fitness", lower: "general fitness", hint: "Stay fit and healthy: train every major muscle on at least 2 days a week, 8-15 reps a set.",
    reps: [8, 15], weekSets: 4, rest: [60, Infinity], weights: { ...PROGRAM_W, reps: 35, session: 30, order: 15, rest: 20 } },
};
/** a goal by its id; anything else (none, unknown, an inherited name like "toString") is muscle size */
export const goalOf = (g: string | null | undefined): GoalTargets => (g && Object.hasOwn(GOALS, g) ? GOALS[g as ProgramGoal] : GOALS[DEFAULT_GOAL]);

export const CHECK_SOURCES = "Schoenfeld and others 2016-2021, Pelland and others 2024, American College of Sports Medicine 2009 and more";

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

/** Schoenfeld, Ogborn & Krieger 2016: training a muscle on 2 or more days a week built more than once. Every checked
 *  muscle counts, as in the sets-a-week check, so both rows count the same muscles (a muscle with no sets is trained on
 *  0 days); the check runs once some muscle has DAY_SETS sets in the week. A day counts for a muscle when it is the main
 *  muscle of a lift that day, or gets at least 1 set as a helper (2 helper sets), so a bench press trains the triceps but
 *  a helper's odd half set doesn't. */
export const TWICE = 2, DAY_SETS = 2;
/** Pelland et al. 2024: per session, muscle growth levels off at about 11 sets for a muscle; past that the extra sets
 *  add little and are better done on another day */
export const SESSION_SETS = 11;
/** ACSM 2009: balance opposing muscles. No study sets a ratio, so these are wide ranges from practice: pulling sets
 *  0.75-1.5 times the pushing ones, hamstrings 0.5-2 times quads */
export const PULL_PUSH: [number, number] = [0.75, 1.5];
export const HAMS_QUADS: [number, number] = [0.5, 2];

const UPPER = new Set(["chest", "shoulders", "triceps", "biceps", "lats", "middle back", "traps", "forearms"]);
const NOT_LIFTING = new Set(["cardio", "stretching"]);

/** An exercise as the check reads it (a routine's exercise with its library entry) */
export interface CheckExercise {
  name: string; primary: string[]; secondary: string[];
  mechanic: string | null; force: string | null; category: string;
  superset?: string | null;
  /** restS: the rest planned after the set, seconds (left out when not known) */
  sets: { kind: SetKind; reps: number | null; restS?: number | null }[];
}
/** One workout: a routine's exercises in order */
export type CheckSession = CheckExercise[];

/** A research finding behind a check: who, what they found, the full reference */
export interface CheckSource { t: string; s: string; ref: string }
/** One line of a check's numbers: a muscle or an exercise, its number and whether it meets the target */
export interface CheckItem { label: string; value: number; text: string; ok: boolean | null; note?: string }
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
  /** the row's line: what it found, by name, and when not met what to change */
  detail: string;
  /** the popup: what the check looks at, its numbers (bars: per muscle, drawn as bars against `band`; else rows),
   *  the target and a short reason, what to change, the research and sources */
  what: string;
  itemsLabel: string;
  items: CheckItem[];
  bars: boolean;
  band?: [number, number];
  /** the target itself, and in 1-2 plain sentences why (no study names: those are in `research`) */
  target: string;
  reason: string;
  /** how many targets `target` holds (the reps check for strength: big lifts and single-muscle lifts), so the popup's
   *  headings say "target" or "targets" */
  targets: number;
  tips: string[];
  /** who found what, in detail (writer skill §6), above the sources: the long version of `reason` */
  research: string;
  sources: CheckSource[];
}
export interface RoutineCheck {
  score: number;
  label: "Good" | "Fair" | "Low";
  goal: ProgramGoal;
  checks: Check[];
  /** sets per checked muscle (CHECK_MUSCLES ids): a program's week, a routine's one workout */
  sets: Record<string, number>;
}

// ----- the research, each finding once -----
// Each finding says what kind of source it is (a review of many studies, one study, a guideline), who was studied, what
// was compared and what was measured, so a reader new to the research knows how far to trust it (writer skill §6).
// Exported for the lesson, which lists every one.
export const CHECK_RESEARCH = {
  volume: { t: "Schoenfeld, Ogborn & Krieger, 2017", s: "A review of 15 studies that compared how many sets a week people did for a muscle: people who did 10 or more sets a week gained clearly more muscle than people who did fewer than 5",
    ref: "Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis. Journal of Sports Sciences, 2017; 35(11): 1073-1082" },
  pelland: { t: "Pelland et al., 2024", s: "An analysis of 67 studies, shared before other scientists had reviewed it: more sets a week built more muscle and strength, but each extra set added less than the one before. Within one workout, sets for one muscle stopped adding much muscle after about 11. Strength needed fewer sets a week than muscle size",
    ref: "Pelland JC, Remmert JF, Robinson ZP, Hinson SR, Zourdos MC. The resistance training dose response: meta-regressions exploring the effects of weekly volume and frequency on muscle hypertrophy and strength gain. SportRxiv preprint, 2024" },
  freq: { t: "Schoenfeld, Ogborn & Krieger, 2016", s: "A review of 10 studies that compared training a muscle on 1 day a week with training it on 2 or more: people who trained it on 2 days gained more muscle than people who trained it on 1",
    ref: "Schoenfeld BJ, Ogborn D, Krieger JW. Effects of resistance training frequency on measures of muscle hypertrophy: a systematic review and meta-analysis. Sports Medicine, 2016; 46(11): 1689-1697" },
  freq2019: { t: "Schoenfeld, Grgic & Krieger, 2019", s: "A larger review of 25 studies by the same team: when people did the same number of sets a week, training a muscle on 1, 2 or 3 or more days built about the same muscle. Training more often helped mainly because it let people do more sets",
    ref: "Schoenfeld BJ, Grgic J, Krieger J. How many times per week should a muscle be trained to maximize muscle hypertrophy? A systematic review and meta-analysis of studies examining the effects of resistance training frequency. Journal of Sports Sciences, 2019; 37(11): 1286-1295" },
  grgic: { t: "Grgic et al., 2018", s: "A review of 22 studies on strength: people who trained a muscle on more days a week gained more strength, mostly because they also did more sets. With the same sets a week, the number of days made little difference",
    ref: "Grgic J, Schoenfeld BJ, Davies TB, Lazinica B, Krieger JW, Pedisic Z. Effect of resistance training frequency on gains in muscular strength: a systematic review and meta-analysis. Sports Medicine, 2018; 48(5): 1207-1220" },
  reps: { t: "Schoenfeld et al., 2021", s: "A review of earlier studies on reps: muscle grew about the same from 5 to 30 reps a set, as long as each set ended close to failure, the point where you can't do another rep. Heavy sets of few reps built the most strength, light sets of many reps the most endurance",
    ref: "Schoenfeld BJ, Grgic J, Van Every DW, Plotkin DL. Loading recommendations for muscle strength, hypertrophy, and local endurance: a re-examination of the repetition continuum. Sports, 2021; 9(2): 32" },
  loads: { t: "Schoenfeld et al., 2017", s: "A review of 21 studies that compared lifting heavy weights for few reps with lifting light weights for many reps: both built about the same muscle, and heavy weights built more strength",
    ref: "Schoenfeld BJ, Grgic J, Ogborn D, Krieger JW. Strength and hypertrophy adaptations between low- vs. high-load resistance training: a systematic review and meta-analysis. Journal of Strength and Conditioning Research, 2017; 31(12): 3508-3523" },
  acsm: { t: "American College of Sports Medicine, 2009", s: "Guidelines from a large association of exercise scientists, drawn from the studies up to 2009 and from coaching practice. For strength: heavy sets of 1-6 reps for experienced lifters and long rests on big lifts. For endurance: 15 or more reps and short rests. For beginners: 8-12 reps and 1-3 sets of an exercise. Do big lifts before single-muscle ones, and give opposing muscles, such as chest and back, about as much work",
    ref: "American College of Sports Medicine. Progression models in resistance training for healthy adults. Medicine & Science in Sports & Exercise, 2009; 41(3): 687-708" },
  simao: { t: "Simão et al., 2012", s: "A review of studies on exercise order: an exercise done early in a workout got more reps and heavier weights than the same exercise done late, when the muscles were already tired",
    ref: "Simão R, de Salles BF, Figueiredo T, Dias I, Willardson JM. Exercise order in resistance training. Sports Medicine, 2012; 42(3): 251-265" },
  nunes: { t: "Nunes et al., 2021", s: "A review of 11 studies in which people trained for weeks with exercises in different orders: people got stronger at an exercise when they did it first than when they did it last, and muscle size grew about the same either way",
    ref: "Nunes JP, Grgic J, Cunha PM, et al. What influence does resistance exercise order have on muscular strength gains and muscle hypertrophy? A systematic review and meta-analysis. European Journal of Sport Science, 2021; 21(2): 149-157" },
  restLong: { t: "Schoenfeld et al., 2016", s: "One study of young men who already lifted weights, over 8 weeks: those who rested 3 minutes between sets gained more muscle and strength than those who rested 1 minute",
    ref: "Schoenfeld BJ, Pope ZK, Benik FM, et al. Longer interset rest periods enhance muscle strength and hypertrophy in resistance-trained men. Journal of Strength and Conditioning Research, 2016; 30(7): 1805-1812" },
  singer: { t: "Singer et al., 2024", s: "A review of 19 studies that compared rest times between sets: people who rested longer than 60 seconds gained slightly more muscle than people who rested less; resting longer than about 90 seconds added no further gain the studies could see",
    ref: "Singer A, Wolf M, Generoso L, et al. Give it a rest: a systematic review with Bayesian meta-analysis on the effect of inter-set rest interval duration on muscle hypertrophy. Frontiers in Sports and Active Living, 2024; 6: 1429789" },
  helms: { t: "Helms et al., 2015", s: "Advice for bodybuilders getting lean for a contest, drawn from the research (a review, not a new study): while eating less to lose fat, keep lifting heavy weights so the body holds on to its muscle",
    ref: "Helms ER, Fitschen PJ, Aragon AA, Cronin J, Schoenfeld BJ. Recommendations for natural bodybuilding contest preparation: resistance and cardiovascular training. Journal of Sports Medicine and Physical Fitness, 2015; 55(3): 164-178" },
  bickel: { t: "Bickel et al., 2011", s: "One study of younger and older adults who first trained 3 days a week for 16 weeks: over the next 32 weeks, the younger adults kept the muscle they had built while doing only a third as many sets, all on 1 day a week. The older adults needed more sets to keep it",
    ref: "Bickel CS, Cross JM, Bamman MM. Exercise dosing to retain resistance training adaptations in young and older adults. Medicine & Science in Sports & Exercise, 2011; 43(7): 1177-1187" },
  who: { t: "World Health Organization, 2020", s: "Activity guidelines for adults, drawn from reviews of health research: do muscle-strengthening activities that work all major muscles on 2 or more days a week",
    ref: "Bull FC, et al. WHO 2020 guidelines on physical activity and sedentary behaviour. British Journal of Sports Medicine, 2020; 54(24): 1451-1462" },
} satisfies Record<string, CheckSource>;
const SRC = CHECK_RESEARCH;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const statusOf = (s: number): Check["status"] => (s >= 1 ? "good" : s >= 0.5 ? "fair" : "low");
const r1 = (x: number) => Math.round(x * 2) / 2;
const n = (x: number) => String(r1(x));
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${r1(x) === 1 ? one : many}`;
/** "biceps", "biceps and abs", "biceps, abs and calves": every one named, never "and 2 more" */
const names = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const low1 = (m: { name: string }) => m.name.toLowerCase();
/** Chest and back are one muscle each in a sentence, the others many ("Triceps are", "Chest is") */
const ONE = new Set(["chest", "back"]);
const agree = (ms: { id: string }[], one: string, many: string) => (ms.length === 1 && ONE.has(ms[0]!.id) ? one : many);
/** 90 → "1:30", 45 → "0:45" */
export const restText = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const range = ([lo, hi]: [number, number]) => (hi >= 100 ? `${lo}+` : `${lo}-${hi}`);
const lifting = (s: CheckSession) => s.filter((e) => !NOT_LIFTING.has(e.category));
const working = (e: CheckExercise) => e.sets.filter((s) => s.kind !== "warmup");
/** A big lift: one that moves several joints and works helper muscles too (a bench press, a row). A "compound" in the
 *  library with no helper (a cable rotation) is not one. */
const isBig = (e: CheckExercise) => e.mechanic === "compound" && e.secondary.length > 0;

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
/** The exercises in the workouts whose main muscle is one of `m`'s, by name, once each */
const liftsFor = (days: CheckSession[], m: { muscles: string[] }) =>
  [...new Set(days.flatMap(lifting).filter((e) => working(e).length && e.primary.some((p) => m.muscles.includes(p))).map((e) => e.name))];

type Base = Omit<Check, "weight" | "status" | "targets"> & { targets?: number };
const make = (g: GoalTargets, c: Base): Check => ({ ...c, targets: c.targets ?? 1, weight: g.weights[c.key], status: statusOf(c.share) });

/** "it"/"they", "its"/"their" and a verb's two forms for one checked muscle: "Chest gets", "Triceps get" */
const it = (m: { id: string }) => agree([m], "it", "them");
const they = (m: { id: string }) => agree([m], "it", "they");
const its = (m: { id: string }) => agree([m], "its", "their");
/** "1 more set", "2 more sets" */
const nSets = (x: number, word = "set") => plural(x, word);
/** "half" of a muscle's sets, rounded down at .5 so 9 sets move 4, 19 move 9 and 17.5 move 9 */
const halfOf = (x: number) => Math.max(1, Math.ceil(x / 2 - 0.5));
/** A library muscle as a sentence names it, and whether it reads as one ("the chest is", "the hamstrings are") */
const MUSCLE_WORD: Record<string, string> = { quadriceps: "quads", abdominals: "abs", lats: "back", "middle back": "back" };
const muscleWord = (m: string) => MUSCLE_WORD[m] ?? m;
const ONE_WORD = new Set(["chest", "back", "lower back", "neck"]);

// ----- a program's week -----
// `week`: "week 1"; `dayNames`: each workout's routine name, for tips that point at one workout

function volume(g: GoalTargets, days: CheckSession[], week: Record<string, number>, wk: string): Check {
  const lo = g.weekSets;
  const ms = CHECK_MUSCLES;
  const share = ms.reduce((t, m) => t + clamp01(week[m.id]! / lo), 0) / ms.length;
  const low = ms.filter((m) => week[m.id]! < lo).sort((a, b) => week[a.id]! - week[b.id]!);
  const high = ms.filter((m) => week[m.id]! > 20);
  // every short muscle named with its own count (at most the 10 checked), so 0 and 9 read as the different jobs they are
  const counts = low.map((m, i) => (i ? `${low1(m)} ${n(week[m.id]!)}` : `${low1(m)} ${agree([m], "gets", "get")} ${nSets(week[m.id]!)}`));
  const detail = low.length
    ? `In ${wk}, ${names(counts)}. ${low.length === 1 ? `${cap(they(low[0]!))} ${agree(low, "needs", "need")} at least ${lo} a week: add sets until ${they(low[0]!)} ${agree(low, "gets", "get")} there.` : `Each needs at least ${lo} a week: add sets until it gets there.`}`
    : `In ${wk}, every muscle gets at least ${lo} sets.`;
  const tips = low.map((m) => {
    const own = liftsFor(days, m), have = week[m.id]!, add = Math.ceil(lo - have);
    return own.length
      ? `${m.name}: ${nSets(have)} in ${wk}, ${n(lo - have)} short of ${lo}. Add ${add} more ${add === 1 ? "set" : "sets"} to ${own.slice(0, 2).join(" or ")}.`
      : `${m.name}: ${nSets(have)} in ${wk}, and no exercise in the week is mainly for ${it(m)}. Add one, such as ${m.example}, with ${nSets(add)} over the week.`;
  });
  if (high.length) {
    const list = high.map((m, i) => `${i ? low1(m) : m.name} (${i ? n(week[m.id]!) : nSets(week[m.id]!)})`);
    tips.push(`${names(list)} ${agree(high, "gets", "get")} more than 20 sets in ${wk}. That meets the target, but each set past about 20 builds less than the one before and adds to the tiredness you have to recover from${low.length ? ", so these sets would do more for the muscles that are short" : ""}.`);
  }
  return make(g, {
    key: "volume", title: `At least ${lo} sets a week per muscle`, share, value: `${ms.length - low.length} of ${plural(ms.length, "muscle")}`, detail,
    what: `How many working sets each major muscle gets in ${wk}, adding up all the week's workouts. Warm-up sets are left out. A set counts as 1 set for the muscle the exercise is mainly for, and as half a set for each muscle that helps: one set of bench press counts 1 for the chest and 0.5 for the triceps.`,
    itemsLabel: `Sets per muscle in ${wk} · target ${lo} or more`, bars: true, band: [lo, Math.max(lo, 20)],
    items: ms.map((m) => ({ label: m.name, value: r1(week[m.id]!), text: plural(week[m.id]!, "set"), ok: week[m.id]! >= lo })),
    target: `Do ${lo} or more working sets a week for each major muscle.`,
    reason: g.id === "size" ? "The more sets a muscle gets in a week, the more it grows. At 10 or more sets a week it grows clearly more than at fewer than 5; past that, each extra set still helps, but a bit less than the one before."
      : g.id === "strength" ? "Getting stronger takes fewer sets than getting bigger: a few heavy sets a week for a muscle already bring most of the strength you'd gain, and more sets add only a little."
      : g.id === "fatLoss" ? "When you eat less to lose fat, your body can also break down muscle. Lifting heavy every week shows it the muscle is still needed, so it keeps it. Keeping muscle takes fewer sets than building it, and 6 a week leaves a safety margin."
      : g.id === "endurance" ? "For endurance, what matters most is doing many reps a set with short rests; each routine's own check looks at those. The number of sets matters less: 6 a week just makes sure every muscle still gets trained."
      : "For general fitness, a few sets are enough: 2 sets for each muscle on 2 days of the week, 4 in all.",
    research: g.id === "size" ? "In a 2017 review of 15 studies (Schoenfeld and others), people who did 10 or more sets a week for a muscle gained clearly more muscle than people who did fewer than 5. A 2024 analysis of 67 studies (Pelland and others, shared before other scientists had checked it) found that more sets kept adding muscle, but each extra set added less than the one before."
      : g.id === "strength" ? "In a 2024 analysis of 67 studies (Pelland and others, shared before other scientists had checked it), strength kept rising with more sets a week, but it stopped rising much sooner than muscle size did, so a few heavy sets already gave most of the strength. No study names an exact number of sets for strength; Motus asks for 5 a week per muscle so every muscle keeps getting some heavy work."
      : g.id === "fatLoss" ? "In a 2011 study (Bickel and others), younger adults first trained 3 days a week for 16 weeks; for the next 32 weeks they kept the muscle they had built while doing only a third as many sets, all on 1 day a week. They were not eating less, and dieting makes muscle easier to lose, so Motus asks for more than that: at least 6 sets a week per muscle. A 2015 review of advice for bodybuilders (Helms and others) says that while you eat less, lifting heavy is what makes the body keep its muscle."
      : g.id === "endurance" ? "No study gives a number of sets a week for muscular endurance, so Motus picks 6 a week per muscle to keep every muscle trained. The American College of Sports Medicine's 2009 guidelines describe endurance training by its reps and rest instead: light weights, 15 or more reps a set and short rests."
      : "The World Health Organization's 2020 guidelines ask adults to train every major muscle on 2 or more days a week, and the American College of Sports Medicine's 2009 guidelines suggest beginners do 1-3 sets of each exercise. Motus puts the two together: 2 sets on each of 2 days, 4 a week.",
    tips: tips.length ? tips : ["Nothing to change: keep it as it is."],
    sources: g.id === "size" ? [SRC.volume, SRC.pelland] : g.id === "strength" ? [SRC.pelland] : g.id === "fatLoss" ? [SRC.helms, SRC.bickel] : g.id === "health" ? [SRC.who, SRC.acsm] : [SRC.acsm],
  });
}

/** The share of the checked muscles trained on 2 or more days of the week (the same muscles the sets-a-week check counts) */
function frequency(g: GoalTargets, days: Day[], week: Record<string, number>, wk: string, dayNames: string[]): Check | null {
  if (!CHECK_MUSCLES.some((m) => week[m.id]! >= DAY_SETS)) return null;
  const ms = CHECK_MUSCLES;
  const onDays = (m: string) => days.map((d, i) => (d.main.has(m) || d.sets[m]! >= 1 ? i + 1 : 0)).filter(Boolean);
  const once = ms.filter((m) => onDays(m.id).length < TWICE);
  const share = (ms.length - once.length) / ms.length;
  // on 1 day: their sets are in one workout; on none: no workout has an exercise mainly for them
  // a muscle only ever helping has no sets of its own to move, so it is told to get an exercise, as one with no day
  const ownDays = (m: string) => days.flatMap((d, i) => (d.main.has(m) ? [i + 1] : []));
  const one = once.filter((m) => ownDays(m.id).length === 1), none = once.filter((m) => !ownDays(m.id).length);
  const parts: string[] = [];
  // "trained in only one workout", not "all its sets": a helper's odd half set on another day doesn't make it a day
  if (one.length) parts.push(`${names(one.map(low1))} ${one.length === 1 ? `${agree(one, "is", "are")} trained` : "are each trained"} in only one workout. Move about half of ${one.length === 1 ? `${its(one[0]!)} sets` : "each one's sets"} to another workout in the week.`);
  if (none.length) parts.push(`${names(none.map(low1))} ${agree(none, "has", "have")} no exercise of ${none.length === 1 ? its(none[0]!) : "their"} own in any workout. Add one for ${none.length === 1 ? it(none[0]!) : "them"} to 2 workouts.`);
  const detail = !once.length ? `In ${wk}, every muscle is trained on at least ${TWICE} different days.`
    : days.length === 1 ? `${cap(wk)} has only 1 workout, so no muscle is trained on more than 1 day. Add a second workout to the week and split each muscle's sets between the two.`
    : `In ${wk}, ${parts.map((p, i) => (i ? cap(p) : p)).join(" ")}`;
  const wkt = (m: { id: string }, d: number[]) => (d.length ? `${d.length === 1 ? "Workout" : "Workouts"} ${names(d.map((x) => (dayNames[x - 1] ? `${x} (${dayNames[x - 1]})` : String(x))))}`
    : week[m.id]! > 0 ? "Only works as a helper in other exercises, and never for 2 sets in one workout, so no day counts" : "No sets in the week");
  const named = (d: number) => (dayNames[d - 1] ? `workout ${d} (${dayNames[d - 1]})` : `workout ${d}`);
  return make(g, {
    key: "frequency", title: `Muscles trained on ${TWICE} or more days`, share, value: `${ms.length - once.length} of ${plural(ms.length, "muscle")}`, detail,
    what: `On how many different days in ${wk} each muscle is trained. A day counts for a muscle when an exercise that day is mainly for it, or when it helps in at least 2 sets of other exercises: a bench press day counts for the chest, and for the triceps too, since they help push.`,
    itemsLabel: `Days each muscle is trained in ${wk} · target ${TWICE} or more`, bars: false,
    items: ms.map((m) => { const d = onDays(m.id); return { label: m.name, value: d.length, text: plural(d.length, "day"), ok: d.length >= TWICE, note: wkt(m, d) }; }),
    target: `Train each muscle on at least ${TWICE} different days of the week.`,
    reason: g.id === "health" ? `The World Health Organization asks adults to train every major muscle on at least ${TWICE} days a week, because strength training brings health benefits that walking, running and other cardio alone don't.`
      : g.id === "strength" ? `Splitting a muscle's sets over ${TWICE} days lets you do more sets in the week without one long, tiring workout, and more sets a week is what makes you stronger. The number of days itself makes little difference.`
      : g.id === "endurance" ? `No study has compared 1 and ${TWICE} days a week for endurance. ${TWICE} days keep every muscle trained regularly, as health guidelines ask of everyone.`
      : `In one workout, about the first ${SESSION_SETS} sets for a muscle do almost all the building; sets after that barely help because the muscle is tired. Splitting the sets over ${TWICE} days keeps each workout under that. The ${TWICE} days are not better in themselves: they help by keeping each workout under ${SESSION_SETS} sets as you add more.`,
    research: g.id === "endurance" ? "No study has compared training a muscle on 1 or 2 days a week for muscular endurance. The World Health Organization's 2020 guidelines ask adults to train every major muscle on 2 or more days a week, so Motus asks for the same."
      : g.id === "health" ? "The World Health Organization's 2020 guidelines, drawn from reviews of health research, ask adults to do muscle-strengthening activities that work every major muscle on 2 or more days a week, as these bring health benefits beyond those of walking, running and other cardio."
      : g.id === "strength" ? "In a 2018 review of 22 studies (Grgic and others), people who trained a muscle on more days a week gained more strength, but mostly because they also did more sets: when people did the same number of sets a week, the number of days made little difference. A 2019 review of 25 studies by Schoenfeld's team found the same for muscle size."
      : `In a 2016 review of 10 studies (Schoenfeld and others), people who trained a muscle on 2 days a week gained more muscle than people who trained it on 1 day. A larger 2019 review of 25 studies by the same team then compared people who did the same number of sets a week: whether they did them on 1, 2 or 3 days made about no difference. So the second day helps by spreading the sets out: in a 2024 analysis of 67 studies (Pelland and others, shared before other scientists had checked it), sets past about ${SESSION_SETS} for one muscle in one workout added little muscle.`,
    tips: once.length ? once.map((m) => {
      const d = ownDays(m.id);
      if (!d.length) return week[m.id]! > 0
        ? `${m.name}: no workout has an exercise mainly for ${it(m)}; ${they(m)} only ${agree([m], "helps", "help")} in a few sets of other exercises. Add an exercise for ${it(m)}, such as ${m.example}, to 2 workouts of the week.`
        : `${m.name}: no workout in the week trains ${it(m)}. Add an exercise for ${it(m)}, such as ${m.example}, to 2 workouts of the week.`;
      const on = days[d[0]! - 1]!.sets[m.id]!, all = week[m.id]!;
      const where = r1(on) === r1(all) ? `all ${nSets(all)} are in ${named(d[0]!)}` : `${n(on)} of ${its(m)} ${nSets(all)} are in ${named(d[0]!)}`;
      return `${m.name}: ${where}. Move about ${halfOf(on)} of them to another workout in the week${days.length === 1 ? ", once the week has a second one" : ""}.`;
    }) : ["Nothing to change: keep it as it is."],
    sources: g.id === "health" ? [SRC.who, SRC.freq] : g.id === "endurance" ? [SRC.who] : g.id === "strength" ? [SRC.grgic, SRC.freq2019] : [SRC.freq, SRC.freq2019, SRC.pelland],
  });
}

/** "more sets of Leg curl, or a new exercise such as Romanian deadlift": the person's own lifts first, then new ones they
 *  don't already do */
const newOnes = (own: string[], examples: string[]) => examples.filter((x) => !own.some((o) => o.toLowerCase() === x.toLowerCase()));
/** the first example the person doesn't already do (the row's line names one) */
const fresh = (own: string[], examples: string[]) => newOnes(own, examples)[0] ?? examples[0]!;
const suggest = (own: string[], examples: string[]) => {
  const fresh = newOnes(own, examples);
  const more = own.length ? `more sets of ${own.slice(0, 2).join(" or ")}` : "";
  return more && fresh.length ? `${more}, or a new exercise such as ${fresh.join(" or ")}` : more || `a new exercise such as ${fresh.join(" or ")}`;
};

/** A ratio's share of its range: in it in full, outside it by how far */
const ratioShare = (x: number, [lo, hi]: [number, number]) => (x < lo ? clamp01(x / lo) : x > hi ? clamp01(hi / x) : 1);

/** Pushing and pulling sets in the week; a week with one side only scores 0, as the other side is missing */
function pushPull(g: GoalTargets, sessions: CheckSession[], wk: string): Check | null {
  let push = 0, pull = 0;
  const pushers = new Set<string>(), pullers = new Set<string>();
  for (const e of sessions.flatMap(lifting)) {
    if (!e.primary.length || !e.primary.every((m) => UPPER.has(m))) continue;
    if (e.force === "push") { push += working(e).length; pushers.add(e.name); }
    if (e.force === "pull") { pull += working(e).length; pullers.add(e.name); }
  }
  if (!push && !pull) return null;
  const ratio = push ? pull / push : Infinity;
  const share = ratioShare(ratio, PULL_PUSH);
  const addPull = Math.ceil(push * PULL_PUSH[0] - pull), addPush = Math.ceil(pull / PULL_PUSH[1] - push);
  const detail = share >= 1 ? `In ${wk}, the upper body gets ${nSets(push, "pushing set")} and ${nSets(pull, "pulling set")}, close enough to even.`
    : ratio < PULL_PUSH[0] ? `In ${wk}, the upper body gets ${nSets(push, "pushing set")} but only ${nSets(pull, "pulling set")}. Add about ${addPull} pulling ${addPull === 1 ? "set" : "sets"}, such as ${fresh([...pullers], ["Barbell row", "Pull-up"])}, to even it out.`
    : `In ${wk}, the upper body gets ${nSets(pull, "pulling set")} but only ${nSets(push, "pushing set")}. Add about ${addPush} pushing ${addPush === 1 ? "set" : "sets"}, such as ${fresh([...pushers], ["Bench press", "Overhead press"])}, to even it out.`;
  return make(g, {
    key: "pushPull", title: "Pushing and pulling sets", share, value: `${n(push)} push · ${n(pull)} pull`, detail,
    what: `Working sets in ${wk} of upper-body exercises that push the weight away from you (presses, dips, raises) and that pull it towards you (rows, pulldowns, curls).`,
    itemsLabel: `Upper-body sets in ${wk}`, bars: false,
    items: [{ label: "Pushing", value: push, text: plural(push, "set"), ok: share >= 1, note: names([...pushers]) }, { label: "Pulling", value: pull, text: plural(pull, "set"), ok: share >= 1, note: names([...pullers]) }],
    target: "Do about as many pulling sets as pushing sets: for every 4 pushing sets, 3-6 pulling sets.",
    reason: "Coaches advise giving the muscles that push (chest, front of the shoulders, triceps) and the muscles that pull (back, rear of the shoulders, biceps) about the same work, so one side doesn't end up much stronger and tighter than the other, which is thought to strain the shoulders and round your posture. No study has tested an exact ratio, so the range is wide.",
    research: "The American College of Sports Medicine's 2009 guidelines advise giving opposing muscles, such as chest and back, about as much work. No study has tested an exact ratio, so Motus allows a wide range: 3 to 6 pulling sets for every 4 pushing sets.",
    tips: share >= 1 ? ["Nothing to change: keep it as it is."] : ratio < PULL_PUSH[0] ? [`Add about ${addPull} pulling ${addPull === 1 ? "set" : "sets"} over the week: ${suggest([...pullers], ["Barbell row", "Pull-up"])}.`]
      : [`Add about ${addPush} pushing ${addPush === 1 ? "set" : "sets"} over the week: ${suggest([...pushers], ["Bench press", "Overhead press"])}.`],
    sources: [SRC.acsm],
  });
}

function legs(g: GoalTargets, days: CheckSession[], week: Record<string, number>, wk: string): Check | null {
  const q = week.quadriceps!, h = week.hamstrings!;
  if (!q && !h) return null;
  const ratio = q ? h / q : Infinity;
  const share = ratioShare(ratio, HAMS_QUADS);
  const addH = Math.ceil(q * HAMS_QUADS[0] - h), addQ = Math.ceil(h / HAMS_QUADS[1] - q);
  const ham = CHECK_MUSCLES.find((m) => m.id === "hamstrings")!, quad = CHECK_MUSCLES.find((m) => m.id === "quadriceps")!;
  const detail = share >= 1 ? `In ${wk}, the front of the thigh (quads) gets ${nSets(q)} and the back (hamstrings) ${n(h)}: a good balance.`
    : ratio < HAMS_QUADS[0] ? `In ${wk}, the quads get ${nSets(q)} but the hamstrings only ${n(h)}. Add about ${nSets(addH, "hamstring set")}, such as Romanian deadlift, so they get at least half as many as the quads.`
    : `In ${wk}, the hamstrings get ${nSets(h)} but the quads only ${n(q)}. Add about ${nSets(addQ, "quad set")}, such as Squat, so they get at least half as many as the hamstrings.`;
  return make(g, {
    key: "legs", title: "Quad and hamstring sets", share, value: `${n(q)} quad · ${n(h)} hamstring`, detail,
    what: `Working sets in ${wk} for the front of the thigh (quads) and the back of the thigh (hamstrings). Warm-ups are left out. A set counts as half a set when the muscle only helps in that exercise instead of being the one it is mainly for.`,
    itemsLabel: `Thigh sets in ${wk}`, bars: false,
    items: [{ label: "Quads", value: r1(q), text: plural(q, "set"), ok: share >= 1, note: names(liftsFor(days, quad)) || undefined },
      { label: "Hamstrings", value: r1(h), text: plural(h, "set"), ok: share >= 1, note: names(liftsFor(days, ham)) || undefined }],
    target: "Give the hamstrings at least half as many sets as the quads, and at most twice as many.",
    reason: "Coaches advise working the front and the back of the thigh about equally, so one side doesn't end up much stronger than the other, which is thought to strain the knees and hamstrings. No study has tested an exact ratio, so the range is wide.",
    research: "The American College of Sports Medicine's 2009 guidelines advise giving opposing muscles, such as the front and back of the thigh, about as much work. No study has tested an exact ratio, so Motus allows a wide range: the hamstrings get from half to twice the quads' sets.",
    tips: share >= 1 ? ["Nothing to change: keep it as it is."] : ratio < HAMS_QUADS[0] ? [`Add about ${nSets(addH, "hamstring set")} over the week: ${suggest(liftsFor(days, ham), ["Romanian deadlift", "Lying leg curl"])}.`]
      : [`Add about ${nSets(addQ, "quad set")} over the week: ${suggest(liftsFor(days, quad), ["Squat", "Leg press"])}.`],
    sources: [SRC.acsm],
  });
}

// ----- one workout -----

const W = "in this workout";

/** ACSM 2009 and Simão et al. 2012: lifts done first get the most reps and weight, so big lifts come before single-muscle
 *  ones that tire the same muscles (in one superset they alternate, so order doesn't count). Nunes et al. 2021: this
 *  matters for strength, much less for size, hence its weight per goal. A lift that is neither (one muscle on a machine
 *  that moves several joints, such as a one-leg leg press) is shown as not checked. */
function order(g: GoalTargets, session: CheckSession): Check | null {
  const s = lifting(session).filter((e) => working(e).length);
  const bigs = s.filter(isBig);
  if (!bigs.length || !s.some((e) => e.mechanic === "isolation")) return null;
  // each late big lift: the single-muscle lift before it, and the muscle that lift already tired
  const after = new Map<CheckExercise, { by: CheckExercise; muscle: string }>();
  s.forEach((e, i) => {
    if (!isBig(e)) return;
    const uses = new Set([...e.primary, ...e.secondary]);
    const b = s.slice(0, i).find((x) => x.mechanic === "isolation" && !(e.superset && x.superset === e.superset) && x.primary.some((m) => uses.has(m)));
    if (b) after.set(e, { by: b, muscle: muscleWord(b.primary.find((m) => uses.has(m))!) });
  });
  const late = [...after.keys()];
  const share = 1 - late.length / bigs.length;
  const firsts = [...new Set(late.map((e) => after.get(e)!.by.name))];
  const tired = [...new Set(late.map((e) => after.get(e)!.muscle))];
  const isAre = tired.length === 1 && ONE_WORD.has(tired[0]!) ? "is" : "are";
  const detail = !late.length ? `${cap(W)}, every big lift comes before the single-muscle lifts that tire the same muscles.`
    : `${cap(W)}, ${names(late.map((e) => e.name))} ${late.length === 1 ? "comes" : "come"} after ${names(firsts)}, so the ${names(tired)} ${isAre} already tired when you start ${late.length === 1 ? "it" : "them"} and you lift less. Move ${late.length === 1 ? "it" : "them"} before ${names(firsts)}.`;
  return make(g, {
    key: "order", title: "Big lifts first", share, value: `${bigs.length - late.length} of ${bigs.length} big ${bigs.length === 1 ? "lift" : "lifts"}`, detail,
    what: `The order of the exercises ${W}. A big lift works several muscles at once (a press, a row, a squat); a single-muscle lift works one (a curl, a raise, a fly). Lifts that fit neither, such as one that works one muscle on a machine that moves several joints, are shown as Not checked.`,
    itemsLabel: `Exercises ${W}, in order`, bars: false,
    items: s.map((e, i) => ({ label: `${i + 1}. ${e.name}`, value: i + 1, text: isBig(e) ? "Big lift" : e.mechanic === "isolation" ? "Single-muscle" : "Not checked", ok: isBig(e) ? !after.has(e) : null,
      note: after.has(e) ? `Comes after ${after.get(e)!.by.name}, which already tired the ${after.get(e)!.muscle}` : undefined })),
    target: "Do big lifts before single-muscle lifts that work the same muscles.",
    reason: g.id === "strength" ? "The first exercises of a workout get your freshest muscles, so you lift more weight for more reps on them. Over weeks, the lift you do first is the one that gets strongest, so the big lifts belong there."
      : `The first exercises of a workout get your freshest muscles, so you lift more weight for more reps on them; the big lifts gain most from that. For ${g.lower} the order matters less than for strength${g.id === "size" || g.id === "fatLoss" ? ": over weeks, muscle grows about the same either way" : ""}.`,
    research: g.id === "strength" ? "In a 2012 review of studies (Simão and others), an exercise done early in a workout got more reps and heavier weights than the same exercise done late, when the muscles were tired. In a 2021 review of 11 studies (Nunes and others), people who did an exercise first for weeks gained more strength in it than people who did it last."
      : "In a 2012 review of studies (Simão and others), an exercise done early in a workout got more reps and heavier weights than the same exercise done late, when the muscles were tired. In a 2021 review of 11 studies (Nunes and others), people who did an exercise first for weeks got stronger at it than people who did it last, but their muscles grew about the same either way.",
    tips: late.length ? late.map((e) => `Move ${e.name} before ${after.get(e)!.by.name}.`) : ["Nothing to change: keep it as it is."],
    sources: g.id === "strength" ? [SRC.nunes, SRC.simao, SRC.acsm] : [SRC.simao, SRC.nunes],
  });
}

/** "4", "4-6": the reps a group of sets aims for */
const repsText = (rs: number[]) => { const lo = Math.min(...rs), hi = Math.max(...rs); return lo === hi ? `${lo}` : `${lo}-${hi}`; };

function reps(g: GoalTargets, session: CheckSession): Check | null {
  // strength's own range for big lifts only matters when the workout has one; without, its wording is the plain range's
  const split = g.bigReps && lifting(session).some((e) => isBig(e) && working(e).some((s) => s.reps != null)) ? g.bigReps : null;
  const rangeOf = (e: CheckExercise) => (split && isBig(e) ? split : g.reps);
  let total = 0, inRange = 0;
  const items: CheckItem[] = [], tips: string[] = [], off: { name: string; sets: number; reps: string; few: boolean; lim: number; big: boolean }[] = [];
  for (const e of lifting(session)) {
    const rs = working(e).map((s) => s.reps).filter((r): r is number => r != null);
    if (!rs.length) continue;
    const [lo, hi] = rangeOf(e);
    const bad = rs.filter((r) => r < lo || r > hi);
    total += rs.length; inRange += rs.length - bad.length;
    // with two targets, each exercise says which one it is held to; a lift that is neither kind takes the single-muscle one
    const kind = !split ? "" : isBig(e) ? " for a big lift" : e.mechanic === "isolation" ? " for a single-muscle lift" : " (not a big lift)";
    items.push({ label: e.name, value: Math.max(...rs), text: `${repsText(rs)} reps`, ok: !bad.length, note: `${plural(rs.length, "working set")} · target ${range([lo, hi])}${kind}` });
    if (!bad.length) continue;
    const fewR = bad.filter((r) => r < lo), manyR = bad.filter((r) => r > hi);
    const isFew = fewR.length > manyR.length, these = isFew ? fewR : manyR;
    off.push({ name: e.name, sets: these.length, reps: repsText(these), few: isFew, lim: isFew ? lo : hi, big: !!split && isBig(e) });
    const aim = `${e.name}: ${plural(these.length, "set")} ${these.length === 1 ? "aims" : "aim"} for ${repsText(these)} reps.`;
    tips.push(!isFew ? `${aim} Add weight until ${hi} reps are hard.`
      : g.id === "endurance" ? `${aim} Lower the weight so you can do at least ${lo}.`
      : g.id === "health" ? `${aim} Lower the weight so you can do at least ${lo}: lighter sets of ${g.reps[0]}-${g.reps[1]} reps are easier on the joints and easier to do with good form.`
      : `${aim} Lower the weight a little so you can do at least ${lo}.`);
  }
  if (!total) return null;
  const share = inRange / total;
  const tgt = split ? `${range(split)} reps on big lifts, ${range(g.reps)} on single-muscle lifts` : `${range(g.reps)} reps a set`;
  // one way and one limit: the sets by name (up to 2 exercises) or a count, then why and what to do; both ways at once
  // leaves each exercise's change to the popup
  const one = off.every((o) => o.few === off[0]?.few && o.lim === off[0]?.lim);
  const o0 = off[0];
  const who = off.length > 2
    ? `${off.length === items.length ? "all" : `${off.length} of`} ${items.length} exercises aim for ${!one ? "too few reps or too many" : `${o0!.few ? "fewer" : "more"} than ${o0!.lim} reps a set`}`
    : names(off.map((o, i) => (i ? `${plural(o.sets, "set")} of ${o.name} for ${o.reps}` : `${plural(o.sets, "set")} of ${o.name} ${o.sets === 1 ? "aims" : "aim"} for ${one && o.few ? "only " : ""}${o.reps} reps`)));
  const fix = !o0 ? "" : !one ? `For ${g.lower}, aim for ${tgt}; tap this row to see which exercises need which change.`
    : o0!.few ? (g.id === "endurance" ? `To build endurance, use lighter weights you can lift at least ${o0!.lim} times.`
      : g.id === "health" ? `Sets under ${o0!.lim} reps are harder on the joints and harder to do with good form: use a weight you can lift at least ${o0!.lim} times.`
      : `Sets under ${o0!.lim} reps build strength more than muscle: use a weight you can lift at least ${o0!.lim} times.`)
    : o0!.big ? `Big lifts build the most strength at ${o0!.lim} reps or fewer: add weight until ${o0!.lim} reps are hard.`
    : g.id === "health" ? `For general fitness, a weight you can lift ${g.reps[0]}-${g.reps[1]} times is enough: add weight until ${o0!.lim} reps are hard.`
    : `Sets of more than ${o0!.lim} reps build endurance more than muscle: add weight until ${o0!.lim} reps are hard.`;
  const detail = !off.length
    ? (split ? `${cap(W)}, every big lift aims for ${range(split)} reps a set and every single-muscle lift for ${range(g.reps)}.` : `${cap(W)}, every working set aims for ${range(g.reps)} reps.`)
    : `${cap(W)}, ${who}. ${fix}`;
  return make(g, {
    // with two targets the title names both, as the count under it holds the sets of both kinds of lift
    key: "reps", title: split ? `${range(split)} reps on big lifts, ${range(g.reps)} on single-muscle lifts` : `${range(g.reps)} reps a set`, share, value: `${inRange} of ${plural(total, "set")}`, detail,
    what: `How many reps each working set ${W} aims for, exercise by exercise (warm-ups left out).${split ? " A big lift works several muscles at once (a press, a row, a squat); a single-muscle lift works one (a curl, a raise, a fly)." : ""} The targets assume each set ends close to failure, when you couldn't do more than 1 or 2 more reps, so pick a weight that makes the last few reps a struggle.`,
    itemsLabel: `Target reps ${W}`, bars: false, items,
    target: `Aim for ${tgt}.`, targets: split ? 2 : 1,
    reason: g.id === "strength" ? (split ? `Lifting heavy for few reps makes you strongest, so big lifts aim for ${range(split)} reps a set. Single-muscle lifts, like curls, are there to build the muscle that helps the big lifts, and muscle grows about as well from ${g.reps[0]} reps a set as from ${g.reps[1]}.`
        : `This workout has no big lift with target reps, so only the single-muscle lifts are checked. They are there to build muscle, which grows about as well from ${g.reps[0]} reps a set as from ${g.reps[1]}.`)
      : g.id === "endurance" ? `Light weights lifted ${g.reps[0]} or more times a set get the muscle used to working for a long time without tiring, which is what endurance is.`
      : g.id === "health" ? `A moderate weight you can lift ${g.reps[0]}-${g.reps[1]} times is heavy enough to build strength and light enough to lift with good form, which suits beginners and older adults.`
      : g.id === "fatLoss" ? `While you eat less, hard sets of ${g.reps[0]}-${g.reps[1]} reps show your body its muscle is still needed, so it keeps it. Sets of fewer than ${g.reps[0]} reps build strength more than muscle.`
      : `Muscle grows about as well from a heavy set of ${g.reps[0]} reps as from a light set of ${g.reps[1]}, as long as the set ends close to failure. Sets of fewer than ${g.reps[0]} reps build mostly strength; sets of more than ${g.reps[1]} build mostly endurance.`,
    research: g.id === "strength" ? "In a 2017 review of 21 studies (Schoenfeld and others), people who lifted heavy weights for few reps gained more strength than people who lifted light weights for many. The American College of Sports Medicine's 2009 guidelines advise experienced lifters who want strength to use heavy sets of 1-6 reps, and beginners 8-12. For the single-muscle lifts, a 2021 review by the same team found muscle grew about as well from sets of about 5 reps as from sets of about 30, as long as each set ended close to failure."
      : g.id === "endurance" ? "The American College of Sports Medicine's 2009 guidelines advise light weights for 15 or more reps a set for endurance, and a 2021 review (Schoenfeld and others) found light sets of many reps improved endurance the most: the muscle gets used to working for longer."
      : g.id === "health" ? "The American College of Sports Medicine's 2009 guidelines advise beginners to use a weight they can lift 8-12 times, and older adults one they can lift 10-15 times. Motus covers both with 8-15 reps."
      : `In a 2017 review of 21 studies (Schoenfeld and others), people who lifted heavy weights for few reps and people who lifted light weights for many reps gained about the same muscle, as long as their sets ended close to failure. A 2021 review by the same team put numbers on it: muscle grew about as well from heavy sets of about 5 reps as from light sets of about 30.${g.id === "fatLoss" ? " For fat loss, a 2015 review of advice for bodybuilders (Helms and others) says to keep the weights heavy while you eat less, so the body holds on to its muscle." : ""}`,
    tips: tips.length ? tips : ["Nothing to change: keep it as it is."],
    sources: g.id === "fatLoss" ? [SRC.loads, SRC.reps, SRC.helms] : g.id === "health" ? [SRC.acsm] : g.id === "strength" ? [SRC.loads, SRC.acsm, SRC.reps] : g.id === "endurance" ? [SRC.acsm, SRC.reps] : [SRC.loads, SRC.reps],
  });
}

/** Pelland et al. 2024: per session a muscle's growth levels off at about 11 sets; past SESSION_SETS the extra sets add
 *  little, so they are better moved to another day */
function session(g: GoalTargets, s: CheckSession): Check | null {
  const day = dayOf(s);
  const ms = CHECK_MUSCLES.filter((m) => day.sets[m.id]! >= 1);
  if (!ms.length) return null;
  const over = ms.filter((m) => day.sets[m.id]! > SESSION_SETS);
  const share = ms.reduce((t, m) => t + Math.min(1, SESSION_SETS / day.sets[m.id]!), 0) / ms.length;
  const extra = (m: { id: string }) => Math.ceil(day.sets[m.id]! - SESSION_SETS);
  const m0 = over[0];
  const detail = !m0 ? `${cap(W)}, no muscle gets more than ${SESSION_SETS} sets.`
    : `${names(over.map((m, i) => (i ? `${low1(m)} ${n(day.sets[m.id]!)}` : `${m.name} ${agree([m], "gets", "get")} ${nSets(day.sets[m.id]!)}`)))} ${W}. `
      + (over.length === 1 ? `After about ${SESSION_SETS} sets the ${low1(m0)} ${agree([m0], "is", "are")} too tired for more sets to build much: move the other ${nSets(extra(m0))} to another day of the week.`
        : `After about ${SESSION_SETS} sets a muscle is too tired for more sets to build much: move the extra sets to another day of the week.`);
  const tips = over.map((m) => {
    // the last exercises for the muscle, enough of their sets to bring it back to the limit, in the order to move them
    const own = lifting(s).filter((e) => working(e).length && e.primary.some((p) => m.muscles.includes(p))).reverse();
    let left = day.sets[m.id]! - SESSION_SETS; const move: string[] = [];
    for (const e of own) { if (left <= 0) break; move.push(e.name); left -= working(e).length; }
    // "the last shoulder exercise", as a muscle reads before a noun
    const kind = ({ shoulders: "shoulder", quadriceps: "quad", hamstrings: "hamstring", glutes: "glute", calves: "calf" } as Record<string, string>)[m.id] ?? low1(m);
    const from = move.length === 1 ? `, from ${move[0]}, the last ${kind} exercise` : move.length ? `, starting with the last ${kind} exercises: ${move.join(", then ")}` : "";
    return `${m.name}: ${nSets(day.sets[m.id]!)}. Move about ${extra(m)} of them to another workout${from}.`;
  });
  return make(g, {
    key: "session", title: `Up to ${SESSION_SETS} sets per muscle`, share, value: `${ms.length - over.length} of ${plural(ms.length, "muscle")}`, detail,
    what: `How many working sets each muscle gets ${W} (warm-ups left out). A set counts as 1 set for the muscle the exercise is mainly for, and as half a set for each muscle that helps: one set of bench press counts 1 for the chest and 0.5 for the triceps.`,
    itemsLabel: `Sets per muscle ${W} · up to ${SESSION_SETS}`, bars: true, band: [0, SESSION_SETS],
    items: ms.map((m) => ({ label: m.name, value: r1(day.sets[m.id]!), text: plural(day.sets[m.id]!, "set"), ok: day.sets[m.id]! <= SESSION_SETS })),
    target: `Do up to ${SESSION_SETS} working sets for one muscle in one workout.`,
    reason: `In one workout, about the first ${SESSION_SETS} sets for a muscle do almost all the building; sets after that barely help because the muscle is tired. Do those extra sets on another day and they work fully again.`,
    research: `In a 2024 analysis of 67 studies (Pelland and others, shared before other scientists had checked it), sets for one muscle in one workout stopped adding much muscle after about ${SESSION_SETS}; the authors think the later sets are done too tired to do much. When the same number of sets was split over 2 workouts in the week, the sets kept adding muscle.`,
    tips: tips.length ? tips : ["Nothing to change: keep it as it is."],
    sources: [SRC.pelland],
  });
}

/** The rest between working sets of each big lift (its shortest, as that is the one the next set starts from):
 *  Singer et al. 2024 and Schoenfeld et al. 2016 for size, ACSM 2009 for strength and endurance */
function rest(g: GoalTargets, s: CheckSession): Check | null {
  const [lo, hi] = g.rest;
  const items: CheckItem[] = [];
  for (const e of lifting(s).filter(isBig)) {
    const ws = working(e);
    // between sets only (not after the last one), and not the 0 before a drop set or between a superset's turns
    const rs = ws.slice(0, -1).map((x) => x.restS).filter((r): r is number => r != null && r > 0);
    if (!rs.length) continue;
    const r = Math.min(...rs);
    items.push({ label: e.name, value: r, text: restText(r), ok: r >= lo && r <= hi });
  }
  if (!items.length) return null;
  const bad = items.filter((x) => !x.ok);
  const share = (items.length - bad.length) / items.length;
  const tgt = hi === Infinity ? `at least ${restText(lo)}` : `${restText(hi)} or less`;
  // several lifts with the same rest read as one time, so the row stays short
  const same = bad.every((x) => x.text === bad[0]?.text);
  // "only" when the rest is too short, except for strength, whose next sentence says why it must be longer
  const short = hi === Infinity && g.id !== "strength" ? "only " : "";
  const who = !bad.length ? "" : same
    ? `${short}${bad[0]!.text} between sets of ${bad.length > 1 && bad.length === items.length ? (bad.length === 2 ? "both big lifts" : `all ${bad.length} big lifts`) : names(bad.map((x) => x.label))}`
    : names(bad.map((x, i) => (i ? `${x.text} on ${x.label}` : `${short}${x.text} between sets of ${x.label}`)));
  const why = g.id === "strength" ? `For strength, rest ${tgt}, so the muscle has recovered and the next set can be just as heavy.`
    : g.id === "endurance" ? `For endurance, rest ${tgt}, so each set starts while the muscle is still a little tired.`
    : g.id === "health" ? `Rest ${tgt}, so you can catch your breath and do the next set with good form.`
    : `Rest ${tgt}, so you can do more reps in the next set.`;
  const detail = !bad.length ? `${cap(W)}, you rest ${tgt} between sets of every big lift.` : `${cap(W)}, you rest ${who}. ${why}`;
  return make(g, {
    key: "rest", title: "Rest between sets of big lifts", share, value: `${items.length - bad.length} of ${items.length} big ${items.length === 1 ? "lift" : "lifts"}`, detail,
    what: `The rest planned between working sets of each big lift ${W}: the routine's own rest times, or your defaults in Settings where it has none. A big lift works several muscles at once (a press, a row, a squat). If a lift has different rests between its sets, the shortest one is shown.`,
    itemsLabel: `Rest between sets ${W}`, bars: false, items,
    target: `Rest ${tgt} between sets of a big lift.`,
    reason: g.id === "strength" ? "A heavy set needs a long rest: after 3 minutes or more the muscle has mostly recovered, so the next set can be just as heavy."
      : g.id === "endurance" ? "With short rests you start each set while the muscle is still tired, and training it to keep going when tired is what builds endurance."
      : g.id === "health" ? "A minute is enough to catch your breath and do the next set with good form."
      : "After a longer rest you get more reps in the next set, so it builds a bit more muscle. Resting longer than 1:30 makes no difference you'd notice, but it does no harm either.",
    research: g.id === "strength" ? "The American College of Sports Medicine's 2009 guidelines advise long rests of several minutes between heavy sets of big lifts. In one 2016 study of 21 young men who already lifted (Schoenfeld and others), those who rested 3 minutes between sets got stronger than those who rested 1 minute. Motus asks for at least 3:00."
      : g.id === "endurance" ? "The American College of Sports Medicine's 2009 guidelines advise short rests for endurance: 1-2 minutes for sets of 15-20 reps, under 1 minute for sets of 10-15. Motus asks for 1:30 or less, the middle of the 1-2 minutes advised for sets of 15 or more reps."
      : g.id === "health" ? "No study sets a rest time for general fitness. Motus asks for at least 1:00, which is what trainers commonly use."
      : "In a 2024 review of 19 studies (Singer and others), people who rested longer than 1 minute between sets gained slightly more muscle than people who rested less; resting longer than about 1:30 added no further muscle that the studies could measure. In one 2016 study of 21 young men who already lifted (Schoenfeld and others), those who rested 3 minutes gained more strength, and more muscle in the thighs, than those who rested 1 minute. So Motus asks for at least 1:30, and resting longer does no harm.",
    tips: bad.length ? bad.map((x) => `${x.label}: change its rest between sets to ${tgt}.`) : ["Nothing to change: keep it as it is."],
    sources: g.id === "strength" ? [SRC.acsm, SRC.restLong] : g.id === "endurance" || g.id === "health" ? [SRC.acsm] : [SRC.singer, SRC.restLong],
  });
}

function total(g: GoalTargets, checks: (Check | null)[], sets: Record<string, number>): RoutineCheck | null {
  const cs = checks.filter((c): c is Check => !!c);
  if (!cs.length) return null;
  const w = cs.reduce((t, c) => t + c.weight, 0);
  const score = Math.round((cs.reduce((t, c) => t + c.share * c.weight, 0) / w) * 100);
  return { score, label: score >= 80 ? "Good" : score >= 50 ? "Fair" : "Low", goal: g.id, checks: cs, sets };
}

/** Whether a workout has any lifting with working sets (what a check can score at all) */
export const hasLifting = (s: CheckSession) => lifting(s).some((e) => working(e).length);

/** A routine: one workout of it, against the targets of `goal` (the goal of the program it is in, else muscle size).
 *  null when nothing applies (no lifting with sets). */
export function routineCheck(s: CheckSession, goal: string | null = DEFAULT_GOAL): RoutineCheck | null {
  if (!hasLifting(s)) return null;
  const g = goalOf(goal);
  return total(g, [reps(g, s), session(g, s), order(g, s), rest(g, s)], dayOf(s).sets);
}

/** A program's week (`week`: its number, for the wording; `dayNames`: each workout's routine name, for the tips that
 *  point at one workout): its workouts together, for sets per muscle, twice a week and balance, against the program's
 *  goal. Every major muscle is checked, since a week should cover them all. */
export function programCheck(days: CheckSession[], goal: string | null = DEFAULT_GOAL, week = 1, dayNames: string[] = []): RoutineCheck | null {
  if (!days.some(hasLifting)) return null;
  const g = goalOf(goal), wk = `week ${week}`;
  const per = days.map(dayOf);
  const sets = Object.fromEntries(CHECK_MUSCLES.map((m) => [m.id, per.reduce((t, d) => t + d.sets[m.id]!, 0)]));
  return total(g, [volume(g, days, sets, wk), frequency(g, per, sets, wk, dayNames), pushPull(g, days, wk), legs(g, days, sets, wk)], sets);
}
