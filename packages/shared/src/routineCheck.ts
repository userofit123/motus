// Routine check (M-273, the Routine check feature): a routine or a program's week scored 0-100 against training research,
// each check saying what it measured, the result and what to change, and carrying what its popup shows (the numbers per
// muscle or exercise, the target and why, the sources). Pure, so the rules are tested once and the pages only show them.
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
  size: { id: "size", name: "Muscle size", lower: "muscle size", hint: "Build bigger muscles: 5-30 reps a set, 10 or more sets a week for each muscle.",
    reps: [5, 30], weekSets: 10, rest: [90, Infinity], weights: { ...PROGRAM_W, reps: 35, session: 30, order: 15, rest: 20 } },
  // ACSM 2009: 1-6 reps and 3-5 minutes' rest on the main lifts for strength; Schoenfeld et al. 2017: heavy loads build more
  // strength than light; Pelland et al. 2024: strength needs fewer weekly sets than size; Nunes et al. 2021: a lift gains
  // most strength when it is done early in the workout, so order counts more here
  strength: { id: "strength", name: "Strength", lower: "strength", hint: "Lift more weight: 1-6 reps a set on big lifts (ones that work several muscles, such as squat or bench press), at least 3 minutes' rest between their sets, and those lifts first.",
    reps: [5, 30], bigReps: [1, 6], weekSets: 5, rest: [180, Infinity], weights: { ...PROGRAM_W, reps: 35, order: 30, rest: 20, session: 15 } },
  // Helms et al. 2015: while dieting, keep lifting heavy so the body keeps its muscle; Bickel et al. 2011: about a third of
  // the sets kept the muscle gained, so 6 sets a week is a careful floor; reps and rest as for size
  fatLoss: { id: "fatLoss", name: "Fat loss", lower: "keeping muscle while losing fat", hint: "Keep your muscle while you lose weight: keep lifting heavy, at least 6 sets a week for each muscle. The weight loss itself comes from eating less.",
    reps: [5, 30], weekSets: 6, rest: [90, Infinity], weights: { ...PROGRAM_W, reps: 35, session: 30, order: 15, rest: 20 } },
  // ACSM 2009: light loads for 15 or more reps and short rests (1-2 minutes, under 1 for moderate reps) for endurance;
  // research gives no weekly set count for it, so 6 keeps every muscle trained
  endurance: { id: "endurance", name: "Muscular endurance", lower: "muscular endurance", hint: "Do more reps before your muscles tire: 15 or more reps a set, up to 1:30 rest between sets.",
    reps: [15, 100], weekSets: 6, rest: [0, 90], weights: { ...PROGRAM_W, reps: 40, rest: 25, session: 20, order: 15 } },
  // WHO 2020: every major muscle group on 2 or more days a week; ACSM 2009: 8-12 reps for beginners (up to 15 for older
  // adults), 1-3 sets an exercise, so about 4 sets a week per muscle over 2 days
  health: { id: "health", name: "General fitness", lower: "general fitness", hint: "Stay fit and healthy: every muscle on 2 or more days a week, 8-15 reps a set.",
    reps: [8, 15], weekSets: 4, rest: [60, Infinity], weights: { ...PROGRAM_W, reps: 35, session: 30, order: 15, rest: 20 } },
};
/** a goal by its id; anything else (none, unknown, an inherited name like "toString") is muscle size */
export const goalOf = (g: string | null | undefined): GoalTargets => (g && Object.hasOwn(GOALS, g) ? GOALS[g as ProgramGoal] : GOALS[DEFAULT_GOAL]);

export const CHECK_SOURCES = "Schoenfeld et al. 2016-2021, Pelland et al. 2024, ACSM 2009 and more";

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

/** Schoenfeld, Ogborn & Krieger 2016: training a muscle on 2 or more days a week built more than once. A muscle is
 *  checked from DAY_SETS sets a week. A day counts for it when it is the main muscle of a lift that day, or gets at
 *  least 1 set as a helper (2 helper sets), so a bench press trains the triceps but a helper's odd half set doesn't. */
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
   *  the target and why, what to change, the research */
  what: string;
  itemsLabel: string;
  items: CheckItem[];
  bars: boolean;
  band?: [number, number];
  target: string;
  why: string;
  tips: string[];
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
  acsm: { t: "American College of Sports Medicine, 2009", s: "Guidelines from a large association of exercise scientists, drawn from the studies up to 2009 and from coaching practice. For strength: 1-6 reps and 3-5 minutes' rest on big lifts. For endurance: 15 or more reps and short rests. For beginners: 8-12 reps and 1-3 sets of an exercise. Do big lifts before single-muscle ones, and give opposing muscles, such as chest and back, about as much work",
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

type Base = Omit<Check, "weight" | "status">;
const make = (g: GoalTargets, c: Base): Check => ({ ...c, weight: g.weights[c.key], status: statusOf(c.share) });

// ----- a program's week -----

function volume(g: GoalTargets, days: CheckSession[], week: Record<string, number>, wk: string): Check {
  const lo = g.weekSets;
  const ms = CHECK_MUSCLES;
  const share = ms.reduce((t, m) => t + clamp01(week[m.id]! / lo), 0) / ms.length;
  const low = ms.filter((m) => week[m.id]! < lo).sort((a, b) => week[a.id]! - week[b.id]!);
  const high = ms.filter((m) => week[m.id]! > 20);
  // every short muscle named (at most the 10 checked), never "and 2 more"
  const detail = low.length
    ? `${cap(names(low.map(low1)))} ${low.length === 1 ? agree(low, "gets", "get") : "get"} fewer than ${lo} sets ${wk}. Add sets for ${low.length === 1 ? agree(low, "it", "them") : "them"} to reach ${lo}.`
    : `Every muscle gets ${lo} or more sets ${wk}.`;
  const tips = low.map((m) => {
    const own = liftsFor(days, m), add = Math.ceil(lo - week[m.id]!);
    return `${m.name}: ${n(week[m.id]!)} of ${lo} sets. Add ${plural(add, "set")} a week, ${own.length ? `e.g. to ${own.slice(0, 2).join(" or ")}` : `e.g. ${m.example}`}.`;
  });
  if (high.length) tips.push(`${cap(names(high.map(low1)))} ${agree(high, "gets", "get")} over 20 sets. The check still counts this as met: in a 2024 analysis of 67 studies (Pelland and others), more sets still built a little more muscle, but each extra set added less than the one before, and more sets take longer to recover from.`);
  return make(g, {
    key: "volume", title: `${lo}+ sets a week per muscle`, share, value: `${ms.length - low.length} of ${plural(ms.length, "muscle")}`, detail,
    what: `Working sets (the sets after warm-ups) for each major muscle ${wk}, all its workouts together. A set counts 1 for the muscle the exercise is mainly for and 0.5 for each muscle that helps (a set of bench press: chest 1, triceps 0.5); warm-up sets don't count.`,
    itemsLabel: `Sets per muscle ${wk} · target ${lo}+`, bars: true, band: [lo, Math.max(lo, 20)],
    items: ms.map((m) => ({ label: m.name, value: r1(week[m.id]!), text: plural(week[m.id]!, "set"), ok: week[m.id]! >= lo })),
    target: `${lo} or more working sets a week for every major muscle.`,
    why: g.id === "size" ? "In a 2017 review of 15 studies (Schoenfeld and others), people who did 10 or more sets a week for a muscle gained clearly more muscle than people who did fewer than 5. A 2024 analysis of 67 studies (Pelland and others) found that more sets kept adding muscle, but each extra set added less than the one before."
      : g.id === "strength" ? "In a 2024 analysis of 67 studies (Pelland and others), strength rose with more sets a week but levelled off sooner than muscle size, so a few heavy sets already gave most of the gain. No study names an exact number for strength: Motus asks for 5 a week per muscle so every muscle keeps getting stronger."
      : g.id === "fatLoss" ? "In a 2011 study (Bickel and others), younger adults who had trained for 16 weeks kept their muscle for 32 more weeks doing only a third of their sets. That study did not test people eating less, so Motus asks for at least 6 sets a week per muscle as a careful minimum. Lifting heavy is what tells the body to keep its muscle while you lose fat (a 2015 review of advice for bodybuilders, Helms and others)."
      : g.id === "endurance" ? "No study gives a number of sets a week for muscular endurance. Motus asks for 6 a week per muscle so every muscle keeps being trained; for this goal, many reps a set and short rests matter more (American College of Sports Medicine guidelines, 2009)."
      : "The World Health Organization's 2020 guidelines ask adults to train every major muscle on 2 or more days a week, and the American College of Sports Medicine's 2009 guidelines suggest beginners start with 1-3 sets of an exercise. So 2 sets on each of 2 days, 4 a week, is enough to start.",
    tips: tips.length ? tips : ["Nothing to change: keep it as it is."],
    sources: g.id === "size" ? [SRC.volume, SRC.pelland] : g.id === "strength" ? [SRC.pelland] : g.id === "fatLoss" ? [SRC.helms, SRC.bickel] : g.id === "health" ? [SRC.who, SRC.acsm] : [SRC.acsm],
  });
}

/** The share of trained muscles on 2 or more days a week */
function frequency(g: GoalTargets, days: Day[], week: Record<string, number>, wk: string): Check | null {
  const ms = CHECK_MUSCLES.filter((m) => week[m.id]! >= DAY_SETS);
  if (!ms.length) return null;
  const onDays = (m: string) => days.map((d, i) => (d.main.has(m) || d.sets[m]! >= 1 ? i + 1 : 0)).filter(Boolean);
  const once = ms.filter((m) => onDays(m.id).length < TWICE);
  const share = (ms.length - once.length) / ms.length;
  const detail = !once.length ? `Each muscle is trained on ${TWICE} or more days ${wk}.`
    : days.length === 1 ? `${cap(wk.replace(/^in /, ""))} has 1 workout, so each muscle is trained on 1 day. Add a second workout.`
    : `${cap(names(once.map(low1)))} ${agree(once, "is", "are")} trained on only 1 day ${wk}. Spread ${agree(once, "its", "each one's")} sets over 2 days.`;
  const wkt = (d: number[]) => (d.length ? `${d.length === 1 ? "Workout" : "Workouts"} ${names(d.map(String))}` : "As a helper only");
  return make(g, {
    key: "frequency", title: "Muscles trained twice a week", share, value: `${ms.length - once.length} of ${plural(ms.length, "muscle")}`, detail,
    what: `On how many days ${wk} each muscle is trained. A day counts when an exercise that day is mainly for the muscle, or the muscle helps in 2 or more sets of other exercises (a bench press is mainly for the chest, and the triceps help).`,
    itemsLabel: `Days per muscle ${wk} · target ${TWICE}+`, bars: false,
    items: ms.map((m) => { const d = onDays(m.id); return { label: m.name, value: d.length, text: plural(d.length, "day"), ok: d.length >= TWICE, note: wkt(d) }; }),
    target: `Each trained muscle on ${TWICE} or more days a week.`,
    why: g.id === "health" ? "The World Health Organization's 2020 guidelines ask adults to train every major muscle on 2 or more days a week."
      : g.id === "strength" ? `In a 2018 review of 22 studies (Grgic and others), people who trained a muscle on more days a week gained more strength, but mostly because they also did more sets: with the same sets a week, the number of days made little difference. So 2 days is not a must; it mainly lets you do more sets in the week without piling them all into one workout.`
      : `In a 2016 review of 10 studies (Schoenfeld and others), people who trained a muscle on 2 days a week gained more muscle than people who trained it on 1 day. A larger 2019 review of 25 studies by the same team found that when the sets a week were the same, 1, 2 or 3 days built about the same muscle. So with the same sets a week, 1 or 2 days both work. Training on 2 days keeps each workout under about ${SESSION_SETS} sets for the muscle; in a 2024 analysis of 67 studies (Pelland and others), sets past that in one workout added little.`,
    tips: once.length ? once.map((m) => { const d = onDays(m.id); return d.length
      ? `${m.name}: all its sets are on workout ${d[0]}. Move about half of them to another workout${days.length === 1 ? ", once the week has a second one" : ""}.`
      : `${m.name}: it only helps in a few sets of other exercises, spread over the week. Add an exercise mainly for it on 2 workouts, e.g. ${m.example}.`; })
      : ["Nothing to change: keep it as it is."],
    sources: g.id === "health" ? [SRC.who, SRC.freq] : g.id === "strength" ? [SRC.grgic, SRC.freq2019] : [SRC.freq, SRC.freq2019, SRC.pelland],
  });
}

/** A ratio's share of its range: in it in full, outside it by how far */
const ratioShare = (x: number, [lo, hi]: [number, number]) => (x < lo ? clamp01(x / lo) : x > hi ? clamp01(hi / x) : 1);
/** why the balance checks: a guideline and common practice, no study, and the text says so */
const balanceWhy = (pair: string) => `The American College of Sports Medicine's 2009 guidelines advise giving opposing muscles (${pair}) about as much work, a common practice meant to protect the joints and keep posture upright. No study has tested an exact ratio, so Motus allows a wide range: take it as a rough guide, not a rule.`;

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
  const detail = share >= 1 ? `${n(push)} pushing and ${n(pull)} pulling sets for the upper body ${wk}: about even.`
    : ratio < PULL_PUSH[0] ? `${n(push)} pushing sets and only ${n(pull)} pulling ${wk}. Add about ${addPull} pulling sets, e.g. Barbell row.`
    : `Only ${n(push)} pushing sets and ${n(pull)} pulling ${wk}. Add about ${addPush} pushing sets, e.g. Bench press.`;
  return make(g, {
    key: "pushPull", title: "Pushing and pulling sets", share, value: `${n(push)} push · ${n(pull)} pull`, detail,
    what: `Working sets of upper-body exercises that push (presses, dips, raises) and pull (rows, pulldowns, curls) ${wk}.`,
    itemsLabel: `Upper-body sets ${wk}`, bars: false,
    items: [{ label: "Pushing", value: push, text: plural(push, "set"), ok: share >= 1, note: names([...pushers]) }, { label: "Pulling", value: pull, text: plural(pull, "set"), ok: share >= 1, note: names([...pullers]) }],
    target: `Pulling sets ${PULL_PUSH[0]}-${PULL_PUSH[1]} times the pushing sets.`, why: balanceWhy("muscles that push, such as the chest, and muscles that pull, such as the back"),
    tips: share >= 1 ? ["Nothing to change: keep it as it is."] : ratio < PULL_PUSH[0] ? [`Add about ${addPull} pulling sets a week, e.g. Barbell row or Pull-up${pullers.size ? `, or more sets of ${names([...pullers].slice(0, 2))}` : ""}.`]
      : [`Add about ${addPush} pushing sets a week, e.g. Bench press or Overhead press${pushers.size ? `, or more sets of ${names([...pushers].slice(0, 2))}` : ""}.`],
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
  const detail = share >= 1 ? `${n(q)} quad and ${n(h)} hamstring sets ${wk}: hamstrings get at least half of what quads get.`
    : ratio < HAMS_QUADS[0] ? `${n(q)} quad sets and only ${n(h)} hamstring ${wk}. Add about ${addH} hamstring sets, e.g. Romanian deadlift.`
    : `Only ${n(q)} quad sets and ${n(h)} hamstring ${wk}. Add about ${addQ} quad sets, e.g. Squat.`;
  return make(g, {
    key: "legs", title: "Quad and hamstring sets", share, value: `${n(q)} quad · ${n(h)} hamstring`, detail,
    what: `Working sets (the sets after warm-ups) for the front of the thighs (quads) and the back (hamstrings) ${wk}. A set counts half when the muscle only helps in it.`,
    itemsLabel: `Thigh sets ${wk}`, bars: false,
    items: [{ label: "Quads", value: r1(q), text: plural(q, "set"), ok: share >= 1, note: names(liftsFor(days, quad)) || undefined },
      { label: "Hamstrings", value: r1(h), text: plural(h, "set"), ok: share >= 1, note: names(liftsFor(days, ham)) || undefined }],
    target: `Hamstring sets ${HAMS_QUADS[0]}-${HAMS_QUADS[1]} times the quad sets.`, why: balanceWhy("the front and the back of the thigh"),
    tips: share >= 1 ? ["Nothing to change: keep it as it is."] : ratio < HAMS_QUADS[0] ? [`Add about ${addH} hamstring sets a week, e.g. Romanian deadlift or Lying leg curl.`]
      : [`Add about ${addQ} quad sets a week, e.g. Squat or Leg press.`],
    sources: [SRC.acsm],
  });
}

// ----- one workout -----

const W = "in this workout";

/** ACSM 2009 and Simão et al. 2012: lifts done first get the most reps and weight, so big lifts come before single-muscle
 *  ones that tire the same muscles (in one superset they alternate, so order doesn't count). Nunes et al. 2021: this
 *  matters for strength, much less for size, hence its weight per goal. */
function order(g: GoalTargets, session: CheckSession): Check | null {
  const s = lifting(session).filter((e) => working(e).length);
  const bigs = s.filter(isBig);
  if (!bigs.length || !s.some((e) => e.mechanic === "isolation")) return null;
  const after = new Map<CheckExercise, CheckExercise>();
  s.forEach((e, i) => {
    if (!isBig(e)) return;
    const uses = new Set([...e.primary, ...e.secondary]);
    const b = s.slice(0, i).find((x) => x.mechanic === "isolation" && !(e.superset && x.superset === e.superset) && x.primary.some((m) => uses.has(m)));
    if (b) after.set(e, b);
  });
  const late = [...after.keys()];
  const share = 1 - late.length / bigs.length;
  const firsts = [...new Set(late.map((e) => after.get(e)!.name))];
  const detail = !late.length ? `Every big lift comes before the single-muscle lifts ${W}.`
    : `${cap(W)}, ${names(late.map((e) => e.name))} ${late.length === 1 ? "comes" : "come"} after ${names(firsts)}, which tires the same muscles first. Move ${late.length === 1 ? "it" : "them"} earlier.`;
  return make(g, {
    key: "order", title: "Big lifts first", share, value: `${bigs.length - late.length} of ${bigs.length} big ${bigs.length === 1 ? "lift" : "lifts"}`, detail,
    what: `The order of the exercises ${W}. A big lift works several muscles at once (a press, a row, a squat); a single-muscle lift works one (a curl, a raise, a fly).`,
    itemsLabel: `Exercises ${W}, in order`, bars: false,
    items: s.map((e, i) => ({ label: `${i + 1}. ${e.name}`, value: i + 1, text: isBig(e) ? "Big lift" : e.mechanic === "isolation" ? "Single-muscle" : "Other lift", ok: isBig(e) ? !after.has(e) : null,
      note: after.has(e) ? `After ${after.get(e)!.name}, which tires the same muscles` : undefined })),
    target: "Big lifts before single-muscle lifts that work the same muscles.",
    why: g.id === "strength" ? "In a 2012 review of studies (Simão and others), an exercise done early in a workout got more reps and heavier weights than the same exercise done late, when the muscles were tired. In a 2021 review of 11 studies (Nunes and others), people who did an exercise first for weeks gained more strength in it than people who did it last. For strength, this matters most."
      : `In a 2012 review of studies (Simão and others), an exercise done early in a workout got more reps and heavier weights than the same exercise done late, when the muscles were tired. In a 2021 review of 11 studies (Nunes and others), doing an exercise first for weeks built more strength in it, but muscle size grew about the same in either order, so for ${g.lower} the order matters less.`,
    tips: late.length ? late.map((e) => `Move ${e.name} before ${after.get(e)!.name}.`) : ["Nothing to change: keep it as it is."],
    sources: g.id === "strength" ? [SRC.nunes, SRC.simao, SRC.acsm] : [SRC.simao, SRC.nunes],
  });
}

function reps(g: GoalTargets, session: CheckSession): Check | null {
  // strength's own range for big lifts only matters when the workout has one; without, its wording is the plain range's
  const split = g.bigReps && lifting(session).some((e) => isBig(e) && working(e).some((s) => s.reps != null)) ? g.bigReps : null;
  const rangeOf = (e: CheckExercise) => (split && isBig(e) ? split : g.reps);
  let total = 0, inRange = 0;
  const items: CheckItem[] = [], tips: string[] = [], off: { name: string; reps: string; few: boolean; lim: number }[] = [];
  for (const e of lifting(session)) {
    const rs = working(e).map((s) => s.reps).filter((r): r is number => r != null);
    if (!rs.length) continue;
    const [lo, hi] = rangeOf(e);
    const bad = rs.filter((r) => r < lo || r > hi);
    total += rs.length; inRange += rs.length - bad.length;
    const min = Math.min(...rs), max = Math.max(...rs);
    items.push({ label: e.name, value: max, text: min === max ? `${min} reps` : `${min}-${max} reps`, ok: !bad.length,
      note: `${plural(rs.length, "working set")} · target ${range([lo, hi])}${split ? (isBig(e) ? " for a big lift" : " for a single-muscle lift") : ""}` });
    if (!bad.length) continue;
    const few = bad.filter((r) => r < lo).length, many = bad.length - few;
    const bmin = Math.min(...bad), bmax = Math.max(...bad);
    off.push({ name: e.name, reps: bmin === bmax ? `${bmin}` : `${bmin}-${bmax}`, few: few > many, lim: few > many ? lo : hi });
    tips.push(many >= few
      ? `${e.name}: ${plural(many, "set")} ${many === 1 ? "aims" : "aim"} for more than ${hi} reps. ${hi >= 100 ? "" : `Add weight so ${hi} or fewer are hard.`}`.trim()
      : g.id === "endurance" ? `${e.name}: ${plural(few, "set")} ${few === 1 ? "aims" : "aim"} for fewer than ${lo} reps. Lower the weight so you can do ${lo} or more.`
      : `${e.name}: ${plural(few, "set")} ${few === 1 ? "aims" : "aim"} for fewer than ${lo} reps. ${g.bigReps ? `Single-muscle lifts are there to build muscle, which grows from ${lo}-${hi} reps a set: use a weight you can lift ${lo} or more times.` : `That builds strength more than size: for ${g.lower}, use a weight you can lift ${lo} or more times.`}`);
  }
  if (!total) return null;
  const share = inRange / total;
  const tgt = split ? `${range(split)} reps on big lifts, ${range(g.reps)} on single-muscle lifts` : `${range(g.reps)} reps a set`;
  // which way to change: lighter for too few reps, heavier for too many; both ways at once leaves it to the popup
  // one way and one limit reads as "fewer than 5"; a mix as "outside" the target; more than 2 exercises as a count, the
  // popup naming each
  const one = off.every((o) => o.few === off[0]?.few && o.lim === off[0]?.lim);
  const how = one ? `${off[0]?.few ? "fewer" : "more"} than ${off[0]?.lim} reps` : split ? "reps outside their targets" : `reps outside ${range(g.reps)}`;
  const fix = !one ? `For ${g.lower}, aim for ${tgt}: open this check for each exercise.`
    : off[0]?.few ? `For ${g.lower}, use a weight you can lift ${off[0].lim} or more times.`
    : `For ${g.lower}, add weight so ${off[0]?.lim} or fewer reps are hard.`;
  const who = off.length > 2 ? `${off.length === items.length ? "all" : `${off.length} of`} ${items.length} exercises aim` : `${names(off.map((o) => `${o.name} (${o.reps} reps)`))} ${off.length === 1 ? "aims" : "aim"}`;
  const detail = !off.length ? `Every working set ${W} aims for ${split ? tgt : `${range(g.reps)} reps`}.` : `${cap(W)}, ${who} for ${how}. ${fix}`;
  return make(g, {
    key: "reps", title: split ? `${range(split)} reps on big lifts` : `${range(g.reps)} reps per set`, share, value: `${inRange} of ${plural(total, "set")}`, detail,
    what: `The target reps of each working set (each set after the warm-ups) ${W}, by exercise.${split ? " A big lift works several muscles at once (a press, a row, a squat); a single-muscle lift works one (a curl, a raise, a fly)." : ""} Pick a weight that makes the last few reps a struggle: the reviews below count sets that end close to failure, the point where you can't do another rep.`,
    itemsLabel: `Target reps ${W}`, bars: false, items,
    target: `${cap(tgt)}.`,
    why: g.id === "strength" ? "In a 2017 review of 21 studies (Schoenfeld and others), people who lifted heavy weights for few reps gained more strength than people who lifted light weights for many, and the American College of Sports Medicine's 2009 guidelines advise 1-6 reps on big lifts for strength. Single-muscle lifts are there to build muscle, which grew about the same from 5 to 30 reps a set (a 2021 review, Schoenfeld and others)."
      : g.id === "endurance" ? "The American College of Sports Medicine's 2009 guidelines advise light weights for 15 or more reps a set for endurance, and a 2021 review (Schoenfeld and others) found light sets of many reps improved endurance the most: the muscle gets used to working for longer."
      : g.id === "health" ? "The American College of Sports Medicine's 2009 guidelines advise beginners to use a weight they can lift 8-12 times, and older adults one they can lift 10-15 times. Motus uses 8-15 reps for this goal."
      : `In a 2017 review of 21 studies (Schoenfeld and others), people who lifted heavy weights for few reps and people who lifted light weights for many reps gained about the same muscle, as long as their sets ended close to failure (when you can't do another rep). A 2021 review by the same team puts the range at about 5-30 reps a set: fewer than 5 builds strength more than size, more than 30 mostly builds endurance.${g.id === "fatLoss" ? " While losing fat, a 2015 review of advice for bodybuilders (Helms and others) says to keep the weights heavy so the body holds on to its muscle." : ""}`,
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
  const detail = !over.length ? `Every muscle gets ${SESSION_SETS} or fewer sets ${W}.`
    : `${names(over.map((m, i) => (i ? `${low1(m)} ${n(day.sets[m.id]!)}` : `${m.name} ${agree([m], "gets", "get")} ${plural(day.sets[m.id]!, "set")}`)))} ${W}. In a 2024 analysis of 67 studies (Pelland and others), sets past about ${SESSION_SETS} for one muscle in one workout added little: move some to another day.`;
  const tips = over.map((m) => {
    // the last exercises for the muscle, enough of their sets to bring it back to the limit
    const own = lifting(s).filter((e) => working(e).length && e.primary.some((p) => m.muscles.includes(p))).reverse();
    let extra = day.sets[m.id]! - SESSION_SETS; const move: string[] = [];
    for (const e of own) { if (extra <= 0) break; move.push(e.name); extra -= working(e).length; }
    return `${m.name}: ${n(day.sets[m.id]!)} sets. Move about ${Math.ceil(day.sets[m.id]! - SESSION_SETS)} to another day, e.g. ${names(move)}.`;
  });
  return make(g, {
    key: "session", title: `Up to ${SESSION_SETS} sets per muscle`, share, value: `${ms.length - over.length} of ${plural(ms.length, "muscle")}`, detail,
    what: `Working sets (the sets after warm-ups) for each muscle ${W}. A set counts 1 for the muscle the exercise is mainly for and 0.5 for each muscle that helps (a set of bench press: chest 1, triceps 0.5); warm-up sets don't count.`,
    itemsLabel: `Sets per muscle ${W} · up to ${SESSION_SETS}`, bars: true, band: [0, SESSION_SETS],
    items: ms.map((m) => ({ label: m.name, value: r1(day.sets[m.id]!), text: plural(day.sets[m.id]!, "set"), ok: day.sets[m.id]! <= SESSION_SETS })),
    target: `Up to ${SESSION_SETS} working sets for one muscle in one workout.`,
    why: `In a 2024 analysis of 67 studies (Pelland and others), sets for one muscle in one workout stopped adding much muscle after about ${SESSION_SETS}, likely because the later sets are done tired. The same sets split over two workouts in the week still added muscle.`,
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
  const tgt = hi === Infinity ? `at least ${restText(lo)}` : `up to ${restText(hi)}`;
  // several lifts with the same rest read as one count, so the row stays short
  const same = bad.every((x) => x.text === bad[0]?.text);
  const who = !bad.length ? "" : bad.length === 1 ? `${bad[0]!.label} rests ${bad[0]!.text}` : same ? `${bad.length === items.length ? "All " : ""}${bad.length} big lifts rest ${bad[0]!.text}` : names(bad.map((x) => `${x.label} rests ${x.text}`));
  const detail = !bad.length ? `Big lifts rest ${tgt} between sets ${W}.` : `${who} between sets ${W}. Rest ${tgt} for ${g.lower}.`;
  return make(g, {
    key: "rest", title: "Rest on big lifts", share, value: `${items.length - bad.length} of ${items.length} big ${items.length === 1 ? "lift" : "lifts"}`, detail,
    what: `The rest between working sets (the sets after warm-ups) of each big lift ${W}, as the routine plans it (its own rests, else your defaults in Settings). A big lift works several muscles at once (a press, a row, a squat). Where a lift's rests differ, the shortest counts.`,
    itemsLabel: `Rest between sets ${W}`, bars: false, items,
    target: `${cap(tgt)} between sets of a big lift.`,
    why: g.id === "strength" ? "The American College of Sports Medicine's 2009 guidelines advise 3-5 minutes' rest between heavy sets of big lifts, so the muscle has recovered and the next set can be as heavy. Motus asks for at least 3:00."
      : g.id === "endurance" ? "The American College of Sports Medicine's 2009 guidelines advise short rests for endurance, about 1-2 minutes or less, so the muscle learns to keep working while it is still tired. Motus asks for up to 1:30."
      : g.id === "health" ? "No study sets a rest time for general fitness. Motus asks for at least 1:00, common practice so you can do the next set with good form."
      : "In a 2024 review of 19 studies (Singer and others), people who rested longer than 1 minute between sets gained slightly more muscle than people who rested less, and resting longer than about 90 seconds added nothing more the studies could see. In one 2016 study of young men who already lifted (Schoenfeld and others), 3 minutes' rest built more muscle and strength than 1 minute. So Motus asks for at least 1:30.",
    tips: bad.length ? bad.map((x) => `${x.label}: set its rest between sets to ${tgt}.`) : ["Nothing to change: keep it as it is."],
    sources: g.id === "strength" || g.id === "endurance" || g.id === "health" ? [SRC.acsm] : [SRC.singer, SRC.restLong],
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

/** A program's week (`week`: its number, for the wording): its workouts together, for sets per muscle, twice a week and
 *  balance, against the program's goal. Every major muscle is checked, since a week should cover them all. */
export function programCheck(days: CheckSession[], goal: string | null = DEFAULT_GOAL, week = 1): RoutineCheck | null {
  if (!days.some(hasLifting)) return null;
  const g = goalOf(goal), wk = `in week ${week}`;
  const per = days.map(dayOf);
  const sets = Object.fromEntries(CHECK_MUSCLES.map((m) => [m.id, per.reduce((t, d) => t + d.sets[m.id]!, 0)]));
  return total(g, [volume(g, days, sets, wk), frequency(g, per, sets, wk), pushPull(g, days, wk), legs(g, days, sets, wk)], sets);
}
