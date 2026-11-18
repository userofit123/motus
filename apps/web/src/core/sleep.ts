// Nights of sleep from a band (Stats → Sleep and Home's night): the stages, their colours, and times of night.
import { duration, isNightMin, MIN_NIGHT_H } from "@motus/shared";
import type { SleepNight } from "../api/queries";

// Deep in the accent, light a pale accent, REM the chart palette's teal (the second accent sits too close to the first
// in some themes), awake the warning colour. Theme tokens only, so every theme and dark mode keep them apart.
export const STAGES = [
  { key: "deepMin", name: "Deep", color: "var(--acc)" },
  { key: "lightMin", name: "Light", color: "color-mix(in srgb, var(--acc) 40%, var(--s2))" },
  { key: "remMin", name: "REM", color: "var(--c3)" },
  { key: "awakeMin", name: "Awake", color: "var(--warn)" },
] as const;
/** A night the band didn't split into stages, beside ones it did: thin stripes of the plain bar colour (BarChart's
 *  hatch), apart from the stages' solid fills (so it isn't read as one long deep sleep) yet quieter than them, so the
 *  nights with stages draw the eye; never a grey that looks switched off. The legend draws its swatch the same way. */
export const NO_STAGES_COLOR = "color-mix(in srgb, var(--acc) 70%, transparent)";
export const NO_STAGES_SWATCH = `repeating-linear-gradient(-45deg, ${NO_STAGES_COLOR} 0 2px, color-mix(in srgb, var(--acc) 21%, transparent) 2px 4px)`;
/** A nap or partial record (under the shared MIN_NIGHT_H) in the time-asleep chart: still a bar, in a muted grey apart
 *  from the nights' colours, since it is set aside from every average; the legend names it. */
export const SHORT_COLOR = "color-mix(in srgb, var(--tx2) 35%, transparent)";
/** Why a short record is set aside, said the same on Stats → Sleep and Home */
export const SHORT_WHY = `Under ${MIN_NIGHT_H} hours: a nap or part of a night, so it's left out of your sleep averages.`;
export type StageKey = (typeof STAGES)[number]["key"];

/** Whether the band told the stages apart, or only asleep from awake */
export const hasStages = (n: SleepNight) => n.deepMin != null || n.lightMin != null || n.remMin != null;
/** Minutes asleep: the day's own number when it was typed in (edited), else the band's */
export const asleepMin = (n: SleepNight) => (n.edited && n.sleepH ? Math.round(n.sleepH * 60) : n.asleepMin);
/** Whether a night's record counts as a night, or is a nap or partial record left out of averages and counts */
export const isFull = (n: SleepNight) => isNightMin(asleepMin(n));
/** Minutes the band's record covers, from its start to its end ("tracked" in the UI): it starts when the band saw you
 *  fall asleep, or a little before when it logged you awake first, never when you got into bed, which no band knows */
export const inBedMin = (n: SleepNight) => Math.max(0, Math.round((Date.parse(n.endAt) - Date.parse(n.startAt)) / 60000));
/** Whether the band told asleep from awake that night (stages, or time awake); without, its record is all asleep */
export const awakeKnown = (n: SleepNight) => hasStages(n) || (n.awakeMin ?? 0) > 0;
/** The share of the tracked time spent asleep, 0-1: the band's own minutes asleep (not hours typed in, which were never
 *  measured against its record), as the sleep score counts it */
export const efficiency = (n: SleepNight) => { const b = inBedMin(n); return b ? Math.min(1, n.asleepMin / b) : 0; };
/** A share (0-1) as a whole percent rounded down, so a night with time awake never reads "100%" and 84.6% stays under the
 *  85% the sleep score counts from; the tiny nudge stops 0.29 (28.999… in floating point) from losing a whole percent */
export const pctDown = (v: number) => Math.floor(v * 100 + 1e-6);
/** The percent in a night's ring, and in its sleep score's Stayed asleep row (the same minutes the score counts) */
export const asleepPct = (n: SleepNight) => pctDown(efficiency(n));
/** The line under a night's ring (NightRing), on Home and Stats → Sleep alike, and the ring's own label: what the ring
 *  shows, or why it is empty. Said even for a nap, so the percent in the ring is never left unexplained */
// lower: it follows other words on its line ("23:10-06:40 · asleep for…"), so it starts in lowercase
export const nightRingLine = (n: SleepNight, lower = false) => (awakeKnown(n)
  ? `${lower ? "asleep" : "Asleep"} for ${asleepPct(n)}% of the ${mins(inBedMin(n))} tracked`
  : `${mins(inBedMin(n))} tracked · time awake not recorded`);

/** A time of night as minutes after the noon before, so 23:30 and 00:30 sit an hour apart rather than a day */
export const nightMin = (iso: string) => { const d = new Date(iso); return (d.getHours() * 60 + d.getMinutes() + 720) % 1440; };
/** Back to a time to show: minutes after noon as an ISO time on some day, for fmt.time */
export const nightIso = (m: number) => { const d = new Date(2000, 0, 1, 12, 0); d.setMinutes(d.getMinutes() + Math.round(m)); return d.toISOString(); };
/** "7h 12m" */
export const mins = (m: number) => duration(Math.round(m) * 60, true);

/** Some times of night: the middle one, and the range they usually fall in, widened out to 5 minutes (the start rounded
 *  down, the end up) so the middle one always sits inside it. From 5 nights on, the middle half (so one late night
 *  doesn't stretch it); with fewer, the earliest to the latest. */
export function typical(ms: number[]): { at: number; lo: number; hi: number; n: number } | null {
  if (!ms.length) return null;
  const xs = [...ms].sort((a, b) => a - b), n = xs.length;
  const at = (p: number) => { const i = (n - 1) * p, f = Math.floor(i); return xs[f]! + (xs[Math.min(n - 1, f + 1)]! - xs[f]!) * (i - f); };
  const down = (m: number) => Math.floor(Math.round(m) / 5) * 5, up = (m: number) => Math.ceil(Math.round(m) / 5) * 5;
  return n >= 5 ? { at: at(0.5), lo: down(at(0.25)), hi: up(at(0.75)), n } : { at: at(0.5), lo: down(xs[0]!), hi: up(xs[n - 1]!), n };
}

/** A stretch of a night in one stage, from the band's saved sleep record (ms). asleep: the band only told asleep from
 *  awake there. */
export type Seg = { a: number; b: number; k: "awake" | "rem" | "light" | "deep" | "asleep" };
/** Health Connect's stage numbers: awake, out of bed and awake in bed are all time awake; 0 (unknown) is left out */
const HC_STAGE: Record<number, Seg["k"]> = { 1: "awake", 3: "awake", 7: "awake", 2: "asleep", 4: "light", 5: "deep", 6: "rem" };
/** The lanes of a hypnogram, top to bottom, each with its colour (a stretch only "asleep" sits in Light's lane, striped
 *  as a night without stages is in the time-asleep chart) */
export const LANES = [
  { k: "awake", name: "Awake", color: STAGES[3].color },
  { k: "rem", name: "REM", color: STAGES[2].color },
  { k: "light", name: "Light", color: STAGES[1].color },
  { k: "deep", name: "Deep", color: STAGES[0].color },
] as const;
export const laneOf = (k: Seg["k"]) => (k === "asleep" ? 2 : LANES.findIndex((l) => l.k === k));
export const segColor = (k: Seg["k"]) => (k === "asleep" ? NO_STAGES_COLOR : LANES[laneOf(k)]!.color);
export const SEG_NAME: Record<Seg["k"], string> = { awake: "Awake", rem: "REM", light: "Light", deep: "Deep", asleep: "Asleep" };

export type SleepRecord = { start: string; end?: string; origin: string; stages?: [number, number, number][] };
/**
 * A night's stretches from the saved sleep records around it: the records of one app (two apps writing the same night
 * would otherwise draw it twice), their stages in order: an app that told the stages apart before one that only told
 * asleep from awake, then the one that covered most of the night. A record without stages
 * counts as asleep from start to end. Empty when no saved record covers the night (it was imported before records were
 * kept): the night then shows its totals only.
 */
export function nightSegments(recs: SleepRecord[], startAt: string, endAt: string): Seg[] {
  const n0 = Date.parse(startAt), n1 = Date.parse(endAt);
  const by = new Map<string, { cover: number; staged: boolean; recs: SleepRecord[] }>();
  for (const r of recs) {
    const a = Date.parse(r.start), b = Date.parse(r.end ?? r.start), cover = Math.min(b, n1) - Math.max(a, n0);
    // most of it inside the night, or most of the night inside it
    if (cover <= 0 || (cover < (b - a) / 2 && cover < (n1 - n0) / 2)) continue;
    const g = by.get(r.origin) ?? by.set(r.origin, { cover: 0, staged: false, recs: [] }).get(r.origin)!;
    g.cover += cover; g.recs.push(r);
    if (r.stages?.some(([, , k]) => k >= 4)) g.staged = true;
  }
  const best = [...by.values()].sort((x, y) => Number(y.staged) - Number(x.staged) || y.cover - x.cover)[0];
  if (!best) return [];
  const out: Seg[] = [];
  for (const r of best.recs) {
    if (r.stages?.length) { for (const [s, e, k] of r.stages) if (HC_STAGE[k] && e > s) out.push({ a: s * 1000, b: e * 1000, k: HC_STAGE[k]! }); }
    else if (r.end) out.push({ a: Date.parse(r.start), b: Date.parse(r.end), k: "asleep" });
  }
  out.sort((x, y) => x.a - y.a);
  // two stretches in a row of the same stage drawn as one
  return out.reduce<Seg[]>((m, x) => { const l = m.at(-1); if (l && l.k === x.k && x.a <= l.b + 1000) l.b = Math.max(l.b, x.b); else m.push({ ...x }); return m; }, []);
}
