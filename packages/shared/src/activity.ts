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
