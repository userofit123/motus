// A recorded route of [lat, lon, unix s, altitude] points: which fixes go on it, its distance, moving time and climb,
// and the walk's step count from the phone's step sensors. Shared so the recording screen shows the same distance that
// is saved, and so this counting is tested.

const R = 6371000;
export function haversine(a: [number, number] | number[], b: [number, number] | number[]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0]! - a[0]!), dLon = toRad(b[1]! - a[1]!);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0]!)) * Math.cos(toRad(b[0]!)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance, moving time and climb from a route of [lat, lon, unix s, altitude] points. `breaks` are the indexes of
 *  points that start a new stretch (the first point after a pause): the way from the point before is not counted,
 *  since you may have walked on while paused. */
export function routeStats(route: number[][], breaks: number[] = []) {
  let dist = 0, moving = 0, climb = 0;
  const skip = new Set(breaks);
  // a phone's GPS altitude wobbles a few metres from point to point; adding up every small rise would turn a flat walk
  // into a hill, so a climb counts once it's 5 m above the lowest point since the last one counted
  let low: number | null = null;
  let seen = false; // any altitude at all, kept apart from `low` because a pause break resets `low`
  for (let i = 0; i < route.length; i++) {
    const b = route[i]!, alt = b[3];
    if (skip.has(i)) low = null; // what was climbed while paused doesn't count
    if (alt != null && Number.isFinite(alt)) {
      seen = true;
      if (low == null || alt < low) low = alt;
      else if (alt - low >= 5) { climb += alt - low; low = alt; }
    }
    if (!i || skip.has(i)) continue;
    const a = route[i - 1]!;
    const d = haversine(a, b);
    dist += d;
    const dt = (b[2] ?? 0) - (a[2] ?? 0);
    if (dt > 0 && dt < 120 && d / dt > 0.3) moving += dt; // faster than ~1 km/h counts as moving
  }
  // no altitude anywhere on the route: the climb is unknown, not 0 m
  return { distanceM: Math.round(dist), movingS: Math.round(moving), elevationM: !seen ? null : Math.round(climb) };
}

/** The weakest fix a route takes, in metres: a rougher one zig-zags the route and adds distance you didn't go. */
export const ROUTE_ROUGH_M = 50;
/** Whether a new fix goes on the route: not while paused, not a rough one, and not when you've stood still (under 3 m
 *  from the last point, which would add GPS jitter as distance). */
export function takesPoint(route: number[][], pt: number[], accuracyM: number, paused: boolean): boolean {
  if (paused || !(accuracyM <= ROUTE_ROUGH_M)) return false;
  const last = route.at(-1);
  return !last || haversine(last, pt) >= 3;
}

/** One reading from the Android app's step sensors, all counted since `session` (when they started counting):
 *  `counter` from the step counter (-1 before its first reading), `detector` from the step detector. */
export interface StepReading { session: number; counter: number; detector: number }
/** Where a recording's step count stands: `steps` so far, and the sensors' own count (`seen`) at the last reading of `session`. */
export interface StepState { steps: number; session: number | null; seen: number }

/** How many steps the detector may run ahead of the counter (which holds back its first steps) before it's taken for false positives. */
export const STEP_DETECTOR_LEAD = 30;

/** Adds a step reading to the recording's count. The step counter is the accurate one but holds back the first ten or
 *  so steps each time you set off; the step detector reports each step at once but may miss some. Both are counts
 *  since the sensors started, so the larger of the two is how far you've walked, and only its growth since the last
 *  reading is added: a reading that comes late, twice or out of order adds nothing twice. While paused the readings
 *  move `seen` on without counting. A new session (the app was restarted) counts from its own zero. */
export function addStepReading(s: StepState, r: StepReading, paused: boolean): StepState {
  // the detector can fire on handling the phone or a bus ride, so once the counter has reported it may only lead by a few steps
  const now = r.counter >= 0 ? Math.max(r.counter, Math.min(r.detector, r.counter + STEP_DETECTOR_LEAD)) : Math.max(r.detector, 0);
  const from = s.session === r.session ? s.seen : 0;
  const grew = Math.max(0, now - from);
  return { steps: s.steps + (paused ? 0 : grew), session: r.session, seen: Math.max(from, now) };
}
