// The health scores (@motus/shared scores.ts) as Home's blocks and Stats → Scores show them, in one place so both read
// the same: each score's name, icon and stretch, its parts as rows (what, the guideline, how much of it was met) and the
// one line that says why it is what it is.
import { GROUPS, WEEKLY_SET_RANGE, SCORE_DAYS, MIN_NIGHTS, SCORE_SOURCES, type Score, type ScoreKey, type ScorePart } from "@motus/shared";
import { mins, pctDown } from "./sleep";

// `lesson`: the lesson its "Where the aims come from" row opens (components/learn/lessons.ts)
export const SCORE_META: Record<ScoreKey, { name: string; icon: string; span: string; sources: string; lesson: "sleepScore" | "activityScore" | "strengthScore" }> = {
  sleep: { name: "Sleep score", icon: "moon", span: "Last 7 nights", sources: SCORE_SOURCES.sleep, lesson: "sleepScore" },
  activity: { name: "Activity score", icon: "moveRing", span: "Last 7 days", sources: SCORE_SOURCES.activity, lesson: "activityScore" },
  strength: { name: "Strength score", icon: "dumbbell", span: "Last 7 days", sources: SCORE_SOURCES.strength, lesson: "strengthScore" },
};
export const SCORE_KEYS: ScoreKey[] = ["sleep", "activity", "strength"];

export interface ScoreRow { key: string; icon: string; t: string; s: string; r: string; tone?: "pos" | "neg" | "muted" }
type Num = (v: number) => string;
const of = (p: ScorePart) => `${p.value} of ${p.target}`;
const x = (p: ScorePart, k: string) => p.extra?.[k] ?? 0;
const groupName = (id: string) => (GROUPS.find((g) => g.id === id)?.name ?? id).toLowerCase();
// hard sets a muscle group needs in the week: the low end of the range Stats → Muscles marks
const [SETS] = WEEKLY_SET_RANGE;
const short = (p: ScorePart) => Object.entries(p.extra ?? {}).filter(([, v]) => v < SETS).map(([k]) => groupName(k));
// the nights a sleep part counted: the week's 7 (the header already says "Last 7 nights"), or fewer when some had no full record
const nights = (p: ScorePart) => (p.target === SCORE_DAYS ? `${p.target} nights` : `${p.target} recorded nights`);
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const nightsN = (n: number) => `${n} ${n === 1 ? "night" : "nights"}`;

/** The parts a score left out (weight 0), each by its row's title with why: "Stayed asleep didn't count: time awake
 *  wasn't recorded on enough nights."; none: "". "didn't count" agrees with any title, one or many ("Regular times");
 *  `night`: a single night's score (Stats → Sleep's night), whose own night had no time awake */
export function leftOutLine(parts: readonly ScorePart[], num: Num, night = false): string {
  const why: Partial<Record<ScorePart["key"], string>> = {
    efficiency: night ? "time awake wasn't recorded this night" : "time awake wasn't recorded on enough nights",
    regularity: "too few nights recorded",
  };
  return parts.filter((p) => p.weight === 0).map((p) => `${scoreRow(p, num).t} didn't count${why[p.key] ? `: ${why[p.key]}` : ""}.`).join(" ");
}

/** A part as a row: met in full reads positive, under half negative, as Readiness's rows take the tone of their effect.
 *  A part counted out of a fixed whole (nights of the week, muscle groups) reads "4 of 7", its line saying what it counts,
 *  then " · " and its average when there is one. A part with a least amount to reach (active minutes, steps, strength
 *  days) shows its own number alone and its line names the aim, since it can go past it: "5 of 2" days read as a muddle */
export function scoreRow(p: ScorePart, num: Num): ScoreRow {
  const tone = p.share >= 1 ? "pos" : p.share < 0.5 ? "neg" : undefined;
  switch (p.key) {
    // each row's result counts nights, so its line says which nights it counts, then the average
    case "duration": return { key: p.key, icon: "moon", t: "Hours asleep", s: `Nights with ${x(p, "lo")}-${x(p, "hi")} hours · average ${mins(x(p, "avgMin"))}`, r: of(p), tone };
    // the share of the time the band tracked spent asleep: it can't know when you got into bed, so never "in bed". Only
    // nights the band split into asleep and awake count, so when that is fewer than the week's the line says how many it
    // left out and why, as missing data, never "without time awake", which reads as never waking (its "of" is smaller
    // than the other rows'); with too few the part is left out of the score (weight 0) and says so as
    // Readiness's left-out rows do, the fact then the reason
    case "efficiency": {
      if (p.weight === 0) return { key: p.key, icon: "bed", t: "Stayed asleep", s: p.value ? `Time awake recorded on ${p.value} of ${p.target} nights · needs ${MIN_NIGHTS} nights to count` : `No time awake recorded in the last ${SCORE_DAYS} nights · nothing to count`, r: "Left out", tone: "muted" };
      const out = x(p, "nights") - p.target;
      return { key: p.key, icon: "bed", t: "Stayed asleep", s: `Nights asleep 85% of the time or more · average ${pctDown(x(p, "avg"))}%${out > 0 ? ` · time awake not recorded on ${nightsN(out)}` : ""}`, r: of(p), tone }; }
    case "regularity": return { key: p.key, icon: "clock", t: "Regular times", s: "Nights within an hour of your usual bed and wake times", r: of(p), tone };
    // what counts under the title (workouts, every recorded activity but stretching and yoga, and the band's brisk
    // minutes, M-268), never a "Moderate" title, which
    // is Heart's 70 % zone; vigorous minutes said only when there are some, since they make the result more than the
    // minutes; the icon is zone minutes' bolt (heartPulse is the resting heart rate)
    case "minutes": { const vig = x(p, "vigorous");
      return { key: p.key, icon: "bolt", t: "Active minutes", s: `Workouts, walks and other brisk activity${vig ? ` · ${num(vig)} vigorous minutes count double` : ""} · aim for ${num(p.target)} or more`, r: `${num(p.value)} min`, tone }; }
    case "steps": return { key: p.key, icon: "steps", t: "Daily steps", s: `Average steps a day · aim for ${num(p.target)} or more`, r: num(p.value), tone };
    case "days": return { key: p.key, icon: "calendar", t: "Strength days", s: `Days with hard sets · aim for ${days(p.target)} or more`, r: days(p.value), tone };
    case "groups": { const low = short(p);
      return { key: p.key, icon: "activity", t: `Muscle groups with ${SETS}+ hard sets`, s: low.length ? `Under ${SETS}: ${low.join(", ")}` : `All ${p.target} at ${SETS} or more`, r: of(p), tone }; }
  }
}

/** The line under the score: the part furthest from its guideline, cause then advice, short enough for two lines on a
 *  phone (three when every part counted was met and some didn't count, each with why). The header names the 7 nights or days ("Last 7 nights", "Last 7 days"), so no line repeats it ("You slept less
 *  than 7 hours on 3 of 7 nights: aim for 7-9 hours.", "You averaged 6,000 steps a day: aim for 8,000 or more.").
 *  Names (of muscle groups) stay in the rows below. */
export function scoreWhy(s: Score, num: Num): string {
  const p = s.parts.find((y) => y.key === s.weakest);
  // every part counted was met: "every guideline" then says "that counted" and names the parts left out with why, so it
  // never covers one
  if (!p) {
    const left = leftOutLine(s.parts, num);
    const met = `every guideline${left ? " that counted" : ""}`;
    return `${s.key === "sleep" ? `On all ${nights(s.parts[0]!)} you met ${met}` : `You met ${met}`}.${left ? ` ${left}` : ""}`;
  }
  const off = p.target - p.value;
  switch (p.key) {
    case "duration": {
      const lo = x(p, "lo"), hi = x(p, "hi"), under = x(p, "short"), over = x(p, "long"), aim = `aim for ${lo}-${hi} hours`;
      // an older server sends no counts under and over: the nights in the hours, as the row counts them
      if (!over && !under) return `You slept ${lo}-${hi} hours on ${p.value ? `only ${p.value} of` : "none of the"} ${nights(p)}: aim for that every night.`;
      if (over && under) return `You slept less than ${lo} hours on ${nightsN(under)} and more than ${hi} hours on ${over}: ${aim}.`;
      return `You slept ${over ? `more than ${hi}` : `less than ${lo}`} hours on ${over || under} of ${nights(p)}: ${aim}.`;
    }
    case "efficiency": return `You were awake for over 15% of the time tracked on ${off} of ${nights(p)}: aim to be asleep for 85% or more of it.`;
    case "regularity": return `Your bed or wake time was over an hour off your usual on ${off} of ${nights(p)}: keep to the same times.`;
    case "minutes": return `You had ${num(p.value)} active minutes: ${num(off)} more would reach the ${p.target} a week.`;
    case "steps": return `You averaged ${num(p.value)} steps a day: aim for ${num(p.target)} or more.`;
    case "days": return p.value
      ? `You did strength training on ${days(p.value)}: aim for ${days(p.target)} or more.`
      : `You did no strength training: aim for ${days(p.target)} or more.`;
    // the count only: the row below names the groups
    case "groups": { const n = short(p).length;
      return n === 1 ? `1 muscle group got fewer than ${SETS} hard sets: aim for ${SETS} or more.`
        : `${n} muscle groups got fewer than ${SETS} hard sets: aim for ${SETS} or more each.`; }
  }
}
