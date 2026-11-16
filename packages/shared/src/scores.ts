// Health scores (M-247, the Health scores feature): last week's sleep, activity and strength training against published
// guidelines, each 0-100 from parts with stated weights, so a score can always say why it is what it is. Every rule
// sits next to the guideline it comes from. Left out on purpose:
// - sleep stages: consumer bands estimate them loosely and no guideline sets healthy shares of deep or REM sleep;
// - resting heart rate and HRV against a norm: healthy values differ too much between people, so they are only compared
//   with your own usual, which Readiness already does (Recovery is Readiness, never a second recovery score);
// - an overall score: the guidelines give no honest way to weigh sleep against training;
// - anyone under 18: the guidelines differ for children and teens (WHO 60 minutes a day, other sleep hours), so the
//   scores are for adults only and Stats → Scores says so.
import { eachSample } from "./heart";
import { GROUPS, WEEKLY_SET_RANGE } from "./muscles";

/** The scores follow the adult guidelines, so they are worked out from this age on (and without a year of birth) */
export const SCORE_MIN_AGE = 18;
export const scoresFor = (age: number | null) => age == null || age >= SCORE_MIN_AGE;

/** How many days a score covers: the last 7 (today in them), as the guidelines count per week */
export const SCORE_DAYS = 7;

// ---- sources: shown on each score as its "Based on" line
export const SCORE_SOURCES = {
  sleep: "Based on the National Sleep Foundation's sleep duration (Hirshkowitz et al. 2015) and sleep quality (Ohayon et al. 2017) recommendations and its sleep regularity consensus (Sletten et al. 2023).",
  activity: "Based on the WHO 2020 physical activity guidelines (Bull et al. 2020), ACSM heart rate intensities (Garber et al. 2011) and daily steps and mortality (Paluch et al. 2022).",
  strength: "Based on the WHO 2020 physical activity guidelines (Bull et al. 2020) and weekly sets for muscle growth (Schoenfeld, Ogborn & Krieger 2017).",
  recovery: "Based on your own usual of the last 28 days: resting heart rate and HRV have no healthy number that fits everyone.",
} as const;
/** The same in a few words, for Home's blocks (Stats → Scores has the full line) */
export const SCORE_SOURCES_SHORT = {
  sleep: "Based on the National Sleep Foundation (2015, 2017, 2023).",
  activity: "Based on WHO 2020, ACSM 2011 and Paluch et al. 2022.",
  strength: "Based on WHO 2020 and Schoenfeld et al. 2017.",
} as const;

// ---- sleep
/** Hours of sleep a night recommended by age (National Sleep Foundation, Hirshkowitz et al. 2015; the AASM/SRS adult
 *  consensus, Watson et al. 2015, also says 7 or more): teens 14-17 8-10, adults 18-64 7-9, 65 and over 7-8 */
export function sleepRange(age: number | null): [number, number] {
  if (age != null && age < 18) return [8, 10];
  if (age != null && age >= 65) return [7, 8];
  return [7, 9];
}
/** Time asleep as a share of time in bed that marks good sleep quality at every adult age (Ohayon et al. 2017, NSF) */
export const GOOD_EFFICIENCY = 0.85;
/** Bed and wake times count as regular within this many minutes of your usual. Regular timing is recommended by the NSF
 *  consensus (Sletten et al. 2023), which sets no exact window: an hour is Motus's plain reading of it */
export const REGULAR_MIN = 60;
export const SLEEP_WEIGHTS = { duration: 50, efficiency: 25, regularity: 25 } as const;
/** Fewer nights than this in the week say too little about a week's sleep */
export const MIN_NIGHTS = 3;

// ---- activity
/** Heart rate as a share of max that is moderate-intensity and vigorous-intensity effort (ACSM, Garber et al. 2011:
 *  64-76 %, 77-95 %). Not Heart's zones (HR_ZONES' "Moderate" starts at 70 %): the UI says "moderate effort" here and
 *  "Moderate" only for the zone, so one word keeps one meaning */
export const MODERATE_FROM = 0.64, VIGOROUS_FROM = 0.77;
/** WHO 2020: at least 150 minutes of moderate activity a week (or 75 vigorous; a vigorous minute counts as two) */
export const WEEKLY_ACTIVE_MIN = 150;
/** Daily steps where the drop in mortality levels off (Paluch et al. 2022): 8,000-10,000 under 60, 6,000-8,000 from
 *  60; the lower end is the target */
export const stepsTarget = (age: number | null) => (age != null && age >= 60 ? 6000 : 8000);
export const ACTIVITY_WEIGHTS = { minutes: 60, steps: 40 } as const;
/** Days of heart rate or steps the week needs before those parts count (fewer would undercount the week); with heart
 *  rate on fewer days, only recorded activities' minutes stand in for the minutes part */
export const MIN_DAYS = 3;

// ---- strength
/** WHO 2020: muscle-strengthening activities on 2 or more days a week, working all major muscle groups */
export const STRENGTH_DAYS = 2;
/** The major muscle groups counted (Motus's groups, neck left out as the Muscles views do). Each needs the low end of
 *  WEEKLY_SET_RANGE (10 hard sets a week, Schoenfeld, Ogborn & Krieger 2017), counted as Stats → Muscles counts them */
export const SCORE_GROUPS = ["chest", "back", "shoulders", "arms", "core", "legs"] as const;
export const STRENGTH_WEIGHTS = { days: 50, groups: 50 } as const;

export type ScoreKey = "sleep" | "activity" | "strength";
export type PartKey = "duration" | "efficiency" | "regularity" | "minutes" | "steps" | "days" | "groups";
export interface ScorePart {
  key: PartKey;
  /** the part's weight out of its score's 100 (the parts there are share all of it) */
  weight: number;
  /** how much of the guideline is met, 0-1 */
  share: number;
  /** what was counted and what the guideline asks: nights in range / nights, minutes / 150, steps a day / target... */
  value: number;
  target: number;
  /** the part's own detail: the average night (minutes), the average efficiency (0-1), moderate and vigorous minutes,
   *  sets per group */
  extra?: Record<string, number>;
}
export interface Score {
  key: ScoreKey;
  /** 0-100: each part's share of the guideline times its weight, over the weights of the parts there are */
  score: number;
  label: "Good" | "Fair" | "Low";
  parts: ScorePart[];
  /** the part furthest from its guideline (null when every part meets it): what the score says first */
  weakest: PartKey | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function total(key: ScoreKey, parts: ScorePart[]): Score | null {
  if (!parts.length) return null;
  const w = parts.reduce((t, p) => t + p.weight, 0);
  const score = Math.round((parts.reduce((t, p) => t + p.share * p.weight, 0) / w) * 100);
  const low = [...parts].filter((p) => p.share < 1).sort((a, b) => a.share - b.share || b.weight - a.weight)[0];
  return { key, score, label: score >= 80 ? "Good" : score >= 50 ? "Fair" : "Low", parts, weakest: low?.key ?? null };
}

/** A night for the sleep score: minutes asleep, and when it began and ended as minutes from noon (so a night's times
 *  don't wrap at midnight) */
export interface ScoreNight { asleepMin: number; inBedMin: number; bedAt: number; wakeAt: number }
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/**
 * Sleep over the week's full nights (at least MIN_NIGHTS):
 *   duration 50: the share of nights within the recommended hours for your age;
 *   efficiency 25: the share of nights asleep for 85 % or more of the time in bed;
 *   regularity 25: the share of nights whose bed and wake times were both within an hour of the week's usual (median).
 */
export function sleepScore(nights: readonly ScoreNight[], age: number | null): Score | null {
  if (nights.length < MIN_NIGHTS) return null;
  const [lo, hi] = sleepRange(age), n = nights.length;
  const inRange = nights.filter((x) => x.asleepMin >= lo * 60 && x.asleepMin <= hi * 60).length;
  const effs = nights.map((x) => (x.inBedMin > 0 ? Math.min(1, x.asleepMin / x.inBedMin) : 0));
  const good = effs.filter((e) => e >= GOOD_EFFICIENCY).length;
  const bed = median(nights.map((x) => x.bedAt)), wake = median(nights.map((x) => x.wakeAt));
  const regular = nights.filter((x) => Math.abs(x.bedAt - bed) <= REGULAR_MIN && Math.abs(x.wakeAt - wake) <= REGULAR_MIN).length;
  const avg = Math.round(nights.reduce((t, x) => t + x.asleepMin, 0) / n);
  return total("sleep", [
    { key: "duration", weight: SLEEP_WEIGHTS.duration, share: inRange / n, value: inRange, target: n, extra: { avgMin: avg, lo, hi } },
    { key: "efficiency", weight: SLEEP_WEIGHTS.efficiency, share: good / n, value: good, target: n, extra: { avg: Math.round((effs.reduce((t, e) => t + e, 0) / n) * 100) / 100 } },
    { key: "regularity", weight: SLEEP_WEIGHTS.regularity, share: regular / n, value: regular, target: n },
  ]);
}

/** Minutes at moderate and vigorous effort from heart rate samples ([unix seconds, bpm]), each sample counting for the
 *  time eachSample gives it (up to the next one, at most SAMPLE_MAX_S, the last one a minute), as zone minutes count */
export function effortMinutes(samples: readonly (readonly [number, number])[], maxHr: number): { moderate: number; vigorous: number } {
  let moderate = 0, vigorous = 0;
  eachSample(samples, (_t, bpm, secs) => {
    const share = bpm / maxHr;
    if (share >= VIGOROUS_FROM) vigorous += secs / 60; else if (share >= MODERATE_FROM) moderate += secs / 60;
  });
  return { moderate: Math.round(moderate), vigorous: Math.round(vigorous) };
}

/**
 * Activity over the week:
 *   minutes 60: moderate minutes plus twice the vigorous ones against WHO's 150 a week; more than 150 counts as met.
 *   With heart rate on at least MIN_DAYS days: its minutes plus the moving activities on days without it
 *   (activityMinOffHr); on fewer days the heart rate would undercount the week, so only the week's moving activities
 *   count (activityMin, as moderate); without either the part is left out;
 *   steps 40: the average daily steps (over at least MIN_DAYS days with steps) against the level where the benefit levels
 *   off for your age.
 * A part without its data is left out and the other takes all the weight.
 */
export function activityScore(x: { moderate: number; vigorous: number; minutesDays: number; activityMin: number; activityMinOffHr: number; stepDays: number[] }, age: number | null): Score | null {
  const parts: ScorePart[] = [];
  const hr = x.minutesDays >= MIN_DAYS;
  if (hr || x.activityMin > 0) {
    const moderate = hr ? x.moderate + x.activityMinOffHr : x.activityMin, vigorous = hr ? x.vigorous : 0;
    const eq = Math.round(moderate + 2 * vigorous);
    parts.push({ key: "minutes", weight: ACTIVITY_WEIGHTS.minutes, share: clamp01(eq / WEEKLY_ACTIVE_MIN), value: eq, target: WEEKLY_ACTIVE_MIN, extra: { moderate: Math.round(moderate), vigorous: Math.round(vigorous) } });
  }
  const days = x.stepDays.filter((s) => s > 0);
  if (days.length >= MIN_DAYS) {
    const avg = Math.round(days.reduce((t, s) => t + s, 0) / days.length), target = stepsTarget(age);
    parts.push({ key: "steps", weight: ACTIVITY_WEIGHTS.steps, share: clamp01(avg / target), value: avg, target, extra: { days: days.length } });
  }
  return total("activity", parts);
}

/** Hard sets per major muscle group from sets per muscle (muscleSets: a working set 1 for each main muscle, 0.5 for each
 *  helper), summed over the group's muscles as Stats → Muscles' "Working sets, last 7 days" sums them */
export function groupSets(muscles: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(GROUPS.map((g) => [g.id, g.muscles.reduce((t, m) => t + (muscles[m] ?? 0), 0)]));
}

/**
 * Strength training over the week (only for someone who trains: a finished workout in the last 4 weeks):
 *   days 50: days with at least one finished hard (not warm-up) set against WHO's 2;
 *   groups 50: the share of the six major muscle groups at the low end of WEEKLY_SET_RANGE (10 hard sets) or more.
 * sets: hard sets per muscle (muscleSets), grouped here as Stats → Muscles groups them.
 */
export function strengthScore(x: { days: number; sets: Record<string, number> }): Score {
  const g = groupSets(x.sets);
  const met = SCORE_GROUPS.filter((k) => (g[k] ?? 0) >= WEEKLY_SET_RANGE[0]).length;
  return total("strength", [
    { key: "days", weight: STRENGTH_WEIGHTS.days, share: clamp01(x.days / STRENGTH_DAYS), value: x.days, target: STRENGTH_DAYS },
    { key: "groups", weight: STRENGTH_WEIGHTS.groups, share: met / SCORE_GROUPS.length, value: met, target: SCORE_GROUPS.length,
      extra: Object.fromEntries(SCORE_GROUPS.map((k) => [k, Math.round((g[k] ?? 0) * 10) / 10])) },
  ])!;
}

/** The age a guideline goes by, from the year of birth in Body → About you (null without one: the adult ranges) */
export const ageOf = (birthYear: number | null | undefined, now = new Date()) => (birthYear ? now.getFullYear() - birthYear : null);
