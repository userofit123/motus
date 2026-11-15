// An activity's own distance and climb count where its type tracks them: a time only type (yoga, climbing) shows and
// sums none, even with a number saved from before its type changed. Health Connect's whole sessions keep theirs (the
// numbers are the device's), so does an activity with a route; a type since deleted (unknown) shows what there is.
// One rule for the activity's page, every list and every sum, so they never disagree.
import type { ActivityType } from "./types";

/** What these rules read of an activity: list rows carry hasRoute, the full activity its route. */
export interface ActivityFigures { distanceM?: number | string | null; elevationM?: number | string | null; source?: string | null; route?: unknown[] | null; hasRoute?: boolean | null }
type TypeLike = Pick<ActivityType, "hasDistance" | "hasGps"> | null | undefined;

const routed = (a: ActivityFigures) => !!a.route?.length || !!a.hasRoute;
/** Whether the activity's type tracks distance (and so pace), or the activity brought its own */
export const tracksDistance = (a: ActivityFigures, t: TypeLike) => !t || t.hasDistance || t.hasGps || a.source === "health_connect" || routed(a);
/** The activity's own distance in metres where it counts, else null (also for none or 0) */
export function activityDistance(a: ActivityFigures, t: TypeLike): number | null {
  const m = Number(a.distanceM ?? 0);
  return m > 0 && Number.isFinite(m) && tracksDistance(a, t) ? m : null;
}
/** The activity's own climb in metres where its type records a route, else null */
export function activityClimb(a: ActivityFigures, t: TypeLike): number | null {
  if (a.elevationM == null || a.elevationM === "") return null;
  const m = Number(a.elevationM);
  return Number.isFinite(m) && (!t || t.hasGps || routed(a)) ? m : null;
}

// When the worn device's step count for an activity recorded in Motus replaces the phone's own (the engine's
// POST /health/ranges) and, when it doesn't, why (the activity's Step sources sheet): one rule, so the sheet never
// gives a reason the engine doesn't go by.
/** The bounds plausibleSteps checks by: the app's own count must be over minApp for a check, and the device's within low-high times it */
export const STEPS_CHECK = { minApp: 200, low: 0.4, high: 2.5 } as const;
/** Whether the device's count for an activity is believable next to the app's own (null or 0: the app counted none). */
export function plausibleSteps(band: number, app: number | null) {
  // A band whose clock is off (after a reset, before Gadgetbridge sets its time again) files its steps under the wrong
  // minutes, so its count for this activity's time belongs to some other time. Where the app counted a fair number
  // itself, a band count far from it (under 0.4 or over 2.5 times) is taken as that, and the app's count stays.
  // With few or no steps of the app's own there is nothing to check against, and the band's count is the better one.
  if (app == null || app <= STEPS_CHECK.minApp) return true;
  const r = band / app;
  return r >= STEPS_CHECK.low && r <= STEPS_CHECK.high;
}
/** What the step rules read of an activity (the full row, camelCase) */
export interface StepsFigures { steps?: number | null; stepsSource?: string | null; stepsApp?: number | null; source?: string | null }
/** The count was typed: changed by hand later ("manual"), or typed when the activity was logged by hand */
export const stepsTyped = (a: StepsFigures) => a.stepsSource === "manual" || (a.stepsSource == null && a.source === "manual" && a.steps != null);
/** The app's own count: kept aside (stepsApp) once the device's replaced it */
export const appSteps = (a: StepsFigures): number | null => (a.stepsSource === "band" ? a.stepsApp ?? null : a.stepsApp ?? a.steps ?? null);
/** use: the device's count is taken; else why not: typed (the person's own), notCounted (the type counts no steps),
 *  none (no worn device counted then), partial (its step records don't reach past the time on both sides: it hasn't synced past it; heart rate is never asked), phone (the same as the
 *  app's own count: the phone's counter, not the device), far (not plausibleSteps) */
export type BandStepsVerdict = "use" | "typed" | "notCounted" | "none" | "partial" | "phone" | "far";
export function bandStepsVerdict(x: { steps: number | null; covered: boolean; app: number | null; counts: boolean; typed: boolean }): BandStepsVerdict {
  if (x.typed) return "typed";
  if (!x.counts) return "notCounted";
  if (x.steps == null || x.steps <= 0) return "none";
  if (!x.covered) return "partial";
  if (x.app != null && x.steps === x.app) return "phone";
  if (!plausibleSteps(x.steps, x.app)) return "far";
  return "use";
}

/**
 * A day's steps (039): the typed count when the day uses it, else the larger of the day's own count (the synced one) and
 * what the walks recorded in Motus add up to, never the two added. from: which of them counts. The engine's stepsByDay
 * and the daily log's choices both read it, so a choice offered is one that changes what counts.
 */
export function daySteps(own: number | null, typed: boolean, walked: number): { value: number; from: "typed" | "synced" | "walks" } {
  if (typed && own != null) return { value: own, from: "typed" };
  return walked > (own ?? 0) ? { value: walked, from: "walks" } : { value: own ?? 0, from: "synced" };
}

/** The most Health Connect deletions one POST /health/records takes (the engine keeps no more, the phone sends no more at once). */
export const HEALTH_DELETED_MAX = 10_000;
