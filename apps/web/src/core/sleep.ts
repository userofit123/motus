// Nights of sleep from a band (Stats → Sleep and a night's sheet): the stages, their colours, and times of night.
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
/** Minutes from going to bed to getting up */
export const inBedMin = (n: SleepNight) => Math.max(0, Math.round((Date.parse(n.endAt) - Date.parse(n.startAt)) / 60000));
/** The share of the time in bed spent asleep, 0-1 */
export const efficiency = (n: SleepNight) => { const b = inBedMin(n); return b ? Math.min(1, asleepMin(n) / b) : 0; };

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
