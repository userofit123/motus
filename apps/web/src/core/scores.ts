// The health scores (@motus/shared scores.ts) as Home's blocks and Stats → Scores show them, in one place so both read
// the same: each score's name, icon and stretch, its parts as rows (what, the guideline, how much of it was met) and the
// one line that says why it is what it is.
import { GROUPS, WEEKLY_SET_RANGE, SCORE_SOURCES, SCORE_SOURCES_SHORT, type Score, type ScoreKey, type ScorePart } from "@motus/shared";
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

/** A part as a row: met in full reads positive, under half negative, as Readiness's rows take the tone of their effect */
export function scoreRow(p: ScorePart, num: Num): ScoreRow {
  const tone = p.share >= 1 ? "pos" : p.share < 0.5 ? "neg" : undefined;
  switch (p.key) {
    case "duration": return { key: p.key, icon: "moon", t: "Hours asleep", s: `Average ${mins(x(p, "avgMin"))} · aim ${x(p, "lo")}-${x(p, "hi")} hours`, r: of(p), tone };
    case "efficiency": return { key: p.key, icon: "bed", t: "Asleep in bed", s: `Average ${Math.round(x(p, "avg") * 100)}% · aim 85% or more`, r: of(p), tone };
    case "regularity": return { key: p.key, icon: "clock", t: "Regular times", s: "Bed and wake within an hour of your usual", r: of(p), tone };
    // "moderate effort" (WHO's moderate intensity), never bare "Moderate", which is Heart's 70 % zone; the icon is zone
    // minutes' bolt, since these are minutes at a heart rate effort (heartPulse is the resting heart rate)
    case "minutes": return { key: p.key, icon: "bolt", t: "Active minutes", s: `${num(x(p, "moderate"))} moderate effort · ${num(x(p, "vigorous"))} vigorous effort (counts double)`, r: `${num(p.value)} of ${p.target}`, tone };
    case "steps": return { key: p.key, icon: "steps", t: "Daily steps", s: `Average a day · aim ${num(p.target)} or more`, r: `${num(p.value)} of ${num(p.target)}`, tone };
    case "days": return { key: p.key, icon: "calendar", t: "Strength days", s: `Aim ${p.target} or more a week`, r: of(p), tone };
    case "groups": { const low = short(p);
      return { key: p.key, icon: "activity", t: `Muscle groups with ${SETS}+ hard sets`, s: low.length ? `Under ${SETS}: ${low.join(", ")}` : `All ${p.target} at ${SETS} or more`, r: of(p), tone }; }
  }
}

/** The line under the score: the part furthest from its guideline, plainly */
export function scoreWhy(s: Score, num: Num): string {
  const p = s.parts.find((y) => y.key === s.weakest);
  if (!p) return "Meets every part of the guidelines.";
  const off = p.target - p.value;
  switch (p.key) {
    case "duration": return `${off} of ${p.target} nights outside ${x(p, "lo")}-${x(p, "hi")} hours asleep.`;
    case "efficiency": return `${off} of ${p.target} nights asleep for under 85% of the time in bed.`;
    case "regularity": return `Bed or wake time more than an hour off your usual on ${off} of ${p.target} nights.`;
    case "minutes": return `${num(off)} more active minutes would meet the 150 a week.`;
    case "steps": return `Averaging ${num(p.value)} steps a day, under ${num(p.target)}.`;
    case "days": return `${off} more strength ${off === 1 ? "day" : "days"} would meet the ${p.target} a week.`;
    case "groups": return `${off} of ${p.target} muscle groups got under ${SETS} hard sets.`;
  }
}
