// The health scores (@motus/shared scores.ts) as Home's blocks and Stats → Scores show them, in one place so both read
// the same: each score's name, icon and stretch, its parts as rows (what, the guideline, how much of it was met) and the
// one line that says why it is what it is.
import { GROUPS, WEEKLY_SET_RANGE, SCORE_DAYS, SCORE_SOURCES, SCORE_SOURCES_SHORT, type Score, type ScoreKey, type ScorePart } from "@motus/shared";
import { mins } from "./sleep";

export const SCORE_META: Record<ScoreKey, { name: string; icon: string; span: string; source: string; brief: string }> = {
  sleep: { name: "Sleep score", icon: "moon", span: "Last 7 nights", source: SCORE_SOURCES.sleep, brief: SCORE_SOURCES_SHORT.sleep },
  activity: { name: "Activity score", icon: "moveRing", span: "Last 7 days", source: SCORE_SOURCES.activity, brief: SCORE_SOURCES_SHORT.activity },
  strength: { name: "Strength score", icon: "dumbbell", span: "Last 7 days", source: SCORE_SOURCES.strength, brief: SCORE_SOURCES_SHORT.strength },
};
export const SCORE_KEYS: ScoreKey[] = ["sleep", "activity", "strength"];

export interface ScoreRow { key: string; icon: string; t: string; s: string; r: string; tone?: "pos" | "neg" }
type Num = (v: number) => string;
const of = (p: ScorePart) => `${p.value} of ${p.target}`;
const x = (p: ScorePart, k: string) => p.extra?.[k] ?? 0;
const groupName = (id: string) => (GROUPS.find((g) => g.id === id)?.name ?? id).toLowerCase();
// hard sets a muscle group needs in the week: the low end of the range Stats → Muscles marks
const [SETS] = WEEKLY_SET_RANGE;
const short = (p: ScorePart) => Object.entries(p.extra ?? {}).filter(([, v]) => v < SETS).map(([k]) => groupName(k));
// "chest, back and arms"
const list = (a: string[]) => a.join(", ").replace(/, ([^,]*)$/, " and $1");
// the nights a sleep part counted: the week's 7, or fewer when some had no full record
const nights = (p: ScorePart) => (p.target === SCORE_DAYS ? `the last ${p.target} nights` : `${p.target} recorded nights`);
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** A part as a row: met in full reads positive, under half negative, as Readiness's rows take the tone of their effect */
export function scoreRow(p: ScorePart, num: Num): ScoreRow {
  const tone = p.share >= 1 ? "pos" : p.share < 0.5 ? "neg" : undefined;
  switch (p.key) {
    // each row's result counts nights, so its line says which nights it counts, then the average
    case "duration": return { key: p.key, icon: "moon", t: "Hours asleep", s: `Nights with ${x(p, "lo")}-${x(p, "hi")} hours · average ${mins(x(p, "avgMin"))}`, r: of(p), tone };
    case "efficiency": return { key: p.key, icon: "bed", t: "Asleep in bed", s: `Nights at 85% or more · average ${Math.round(x(p, "avg") * 100)}%`, r: of(p), tone };
    case "regularity": return { key: p.key, icon: "clock", t: "Regular times", s: "Nights within an hour of your usual bed and wake times", r: of(p), tone };
    // "moderate effort" (WHO's moderate intensity), never bare "Moderate", which is Heart's 70 % zone; the icon is zone
    // minutes' bolt, since these are minutes at a heart rate effort (heartPulse is the resting heart rate)
    case "minutes": return { key: p.key, icon: "bolt", t: "Active minutes", s: `${num(x(p, "moderate"))} moderate effort · ${num(x(p, "vigorous"))} vigorous effort (counts double)`, r: `${num(p.value)} of ${p.target}`, tone };
    case "steps": return { key: p.key, icon: "steps", t: "Daily steps", s: `Average a day · aim ${num(p.target)} or more`, r: `${num(p.value)} of ${num(p.target)}`, tone };
    case "days": return { key: p.key, icon: "calendar", t: "Strength days", s: `Days with hard sets · aim ${p.target} or more`, r: of(p), tone };
    case "groups": { const low = short(p);
      return { key: p.key, icon: "activity", t: `Muscle groups with ${SETS}+ hard sets`, s: low.length ? `Under ${SETS}: ${low.join(", ")}` : `All ${p.target} at ${SETS} or more`, r: of(p), tone }; }
  }
}

/** The line under the score: the part furthest from its guideline, cause then advice, saying which days or nights it counts
 *  ("You slept less than 7 hours on 3 of the last 7 nights: aim for 7-9 hours.") */
export function scoreWhy(s: Score, num: Num): string {
  const p = s.parts.find((y) => y.key === s.weakest);
  if (!p) return `You met every guideline in the last 7 ${s.key === "sleep" ? "nights" : "days"}.`;
  const off = p.target - p.value;
  switch (p.key) {
    case "duration": {
      const lo = x(p, "lo"), hi = x(p, "hi"), under = x(p, "short"), over = x(p, "long"), aim = `aim for ${lo}-${hi} hours`;
      // an older server sends no counts under and over: the nights in the hours, as the row counts them
      if (!over && !under) return `You slept ${lo}-${hi} hours on ${p.value} of ${nights(p)}: ${aim}.`;
      if (over && under) return `You slept less than ${lo} hours on ${under} and more than ${hi} on ${over} of ${nights(p)}: ${aim}.`;
      return `You slept ${over ? `more than ${hi}` : `less than ${lo}`} hours on ${over || under} of ${nights(p)}: ${aim}.`;
    }
    case "efficiency": return `You were asleep for less than 85% of your time in bed on ${off} of ${nights(p)}: aim for 85% or more.`;
    case "regularity": return `You went to bed or got up more than an hour off your usual time on ${off} of ${nights(p)}: keep to the same times.`;
    case "minutes": return `You had ${num(p.value)} active minutes in the last 7 days: ${num(off)} more would reach the ${p.target} a week.`;
    case "steps": return `You averaged ${num(p.value)} steps a day in the last 7 days: aim for ${num(p.target)} or more.`;
    case "days": return p.value
      ? `You did strength training on ${days(p.value)} in the last 7: aim for ${p.target} or more.`
      : `You did no strength training in the last 7 days: aim for ${days(p.target)} or more.`;
    case "groups": { const low = short(p);
      return `Your ${list(low)} got fewer than ${SETS} hard sets in the last 7 days: aim for ${SETS} or more each.`; }
  }
}
