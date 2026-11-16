// Training load (M-245): how hard each workout or activity was, and the last 7 days against the 4 weeks before. Readiness
// takes the comparison as one of its parts, Stats → Heart shows it. Kept to methods that fit in a sentence each.
import { zoneMinutes } from "./heart";

/** Each heart rate zone's weight (zone 1 counts 1 a minute ... zone 5 counts 5): Edwards' TRIMP, the simplest zone weighting */
export const ZONE_WEIGHTS = [1, 2, 3, 4, 5] as const;
/** A done set without heart rate to go by counts this much: about a set and its rest at a light-to-moderate heart rate */
export const SET_LOAD = 4;
/** An activity without heart rate counts this much a minute (a light zone's weight, as most walks are) */
export const MINUTE_LOAD = 2;

/** The TRIMP-style load of minutes in each zone (HR_ZONES' order): each minute times its zone's number */
export const zoneLoad = (zoneMin: readonly number[]) => zoneMin.reduce((t, m, i) => t + m * (ZONE_WEIGHTS[i] ?? 0), 0);

/**
 * One session's load. A heart rate series (and a max heart rate to place it in zones) gives its zone load; a workout also
 * counts its done sets (SET_LOAD each) and takes the larger, so a strength session, whose heart rate drops between sets,
 * isn't counted as easy; an activity without heart rate counts its minutes (MINUTE_LOAD each). Rounded to a whole number.
 */
export function sessionLoad(s: { hr?: readonly (readonly [number, number])[] | null; maxHr?: number | null; sets?: number; minutes?: number }): number {
  const hr = s.hr && s.hr.length > 1 && s.maxHr ? zoneLoad(zoneMinutes(s.hr, s.maxHr).get("") ?? []) : 0;
  const vol = (s.sets ?? 0) * SET_LOAD;
  const time = !hr && !s.sets ? (s.minutes ?? 0) * MINUTE_LOAD : 0;
  return Math.round(Math.max(hr, vol, time));
}

export const ACUTE_DAYS = 7, CHRONIC_DAYS = 28;
/** The 4 weeks need this many days since the first session before they say what's usual (fewer would read as a jump) */
export const MIN_LOAD_DAYS = 21;
export type LoadState = "lighter" | "steady" | "higher" | "much higher";
export interface LoadTrend {
  /** the load of the last 7 days (today in them) */
  week: number;
  /** the weekly average of the last 28 days (today in them) */
  usual: number;
  /** week / usual: the acute:chronic ratio, null while the 4 weeks are still filling (or had no load) */
  ratio: number | null;
  state: LoadState | null;
  /** days until the usual is known (counted from the first session), null when there is no session, the usual is known, or
   *  the first session is over 21 days back but the last 4 weeks had no load */
  left?: number | null;
}

/**
 * The acute:chronic comparison (7:28): the last 7 days' load against the weekly average of the last 28. Under 0.8 the
 * training is lighter than usual, 0.8-1.3 steady, over 1.3 higher (the range where injuries become more likely), over 1.5
 * much higher. days: { date: YYYY-MM-DD, load } in any order (a date may repeat); first: the earliest session's date.
 */
export function loadTrend(days: readonly { date: string; load: number }[], today: string, first: string | null): LoadTrend {
  const back = (n: number) => new Date(Date.parse(today + "T12:00:00Z") - n * 86400000).toISOString().slice(0, 10);
  const sum = (n: number) => days.filter((d) => d.date > back(n) && d.date <= today).reduce((t, d) => t + d.load, 0);
  const week = Math.round(sum(ACUTE_DAYS)), usual = Math.round(sum(CHRONIC_DAYS) / (CHRONIC_DAYS / ACUTE_DAYS));
  const ready = !!first && first <= back(MIN_LOAD_DAYS) && usual > 0;
  const ratio = ready ? Math.round((week / usual) * 100) / 100 : null;
  const state: LoadState | null = ratio == null ? null : ratio < 0.8 ? "lighter" : ratio <= 1.3 ? "steady" : ratio <= 1.5 ? "higher" : "much higher";
  const since = first ? Math.floor((Date.parse(today + "T12:00:00Z") - Date.parse(first + "T12:00:00Z")) / 86400000) : 0;
  return { week, usual, ratio, state, left: first && ratio == null && since < MIN_LOAD_DAYS ? MIN_LOAD_DAYS - since : null };
}

