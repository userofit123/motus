// Nights of sleep from a band (Stats → Sleep and a night's sheet): the stages, their colours, and times of night.
import { duration } from "@motus/shared";
import type { SleepNight } from "../api/queries";

// Deep in the accent, light a pale accent, REM the chart palette's teal (the second accent sits too close to the first
// in some themes), awake the warning colour. Theme tokens only, so every theme and dark mode keep them apart.
export const STAGES = [
  { key: "deepMin", name: "Deep", color: "var(--acc)" },
  { key: "lightMin", name: "Light", color: "color-mix(in srgb, var(--acc) 40%, var(--s2))" },
  { key: "remMin", name: "REM", color: "var(--c3)" },
  { key: "awakeMin", name: "Awake", color: "var(--warn)" },
] as const;
/** A night the band didn't split into stages, beside ones it did: neutral, so it isn't read as one long deep sleep */
export const ASLEEP_COLOR = "color-mix(in srgb, var(--tx2) 35%, var(--s2))";
export type StageKey = (typeof STAGES)[number]["key"];

/** Whether the band told the stages apart, or only asleep from awake */
export const hasStages = (n: SleepNight) => n.deepMin != null || n.lightMin != null || n.remMin != null;
/** Minutes asleep: the day's own number when it was typed in (edited), else the band's */
export const asleepMin = (n: SleepNight) => (n.edited && n.sleepH ? Math.round(n.sleepH * 60) : n.asleepMin);
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

const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
/** The average of some times of night, and how far a typical one lies from it (mean distance, in minutes) */
export function typical(ms: number[]): { at: number; within: number } | null {
  if (!ms.length) return null;
  const at = mean(ms);
  return { at, within: mean(ms.map((m) => Math.abs(m - at))) };
}
