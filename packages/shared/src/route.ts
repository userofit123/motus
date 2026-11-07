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
 *  `counter` from the step counter (-1 before its first reading), `detector` from the step detector, and `atCounter`
 *  the detector's count when the counter last reported (older Android apps leave it out). */
export interface StepReading { session: number; counter: number; detector: number; atCounter?: number }
/** Where a recording's step count stands: `steps` so far, and the sensors' own count (`seen`) at the last reading of `session`. */
export interface StepState { steps: number; session: number | null; seen: number }

/** How many detector steps may be added on top of the counter's last report before they're taken for false positives
 *  (handling the phone, a bus ride): more than the counter ever holds back while it makes sure you're walking. */
export const STEP_DETECTOR_LEAD = 40;

/** Adds a step reading to the recording's count. The step counter is the accurate one but reports late (it holds back
 *  the first ten or so steps each time you set off, and some phones send it in bunches); the step detector reports each
 *  step at once. So the count is the counter's, plus the detector's steps since the counter last reported: it rises
 *  one step at a time, and each counter report corrects it, so neither drifts. Only its growth since the last reading
 *  is added: a reading that comes late, twice or out of order adds nothing twice, and when the counter corrects it
 *  down nothing is added until you've walked past it again. While paused the readings move `seen` on without
 *  counting. A new session (the app was restarted) counts from its own zero. */
export function addStepReading(s: StepState, r: StepReading, paused: boolean): StepState {
  const now = r.counter < 0 ? Math.max(r.detector, 0)
    : r.atCounter == null ? Math.max(r.counter, Math.min(r.detector, r.counter + STEP_DETECTOR_LEAD)) // an older app's reading
    : r.counter + Math.min(Math.max(0, r.detector - r.atCounter), STEP_DETECTOR_LEAD);
  const from = s.session === r.session ? s.seen : 0;
  const grew = Math.max(0, now - from);
  return { steps: s.steps + (paused ? 0 : grew), session: r.session, seen: Math.max(from, now) };
}

/** Counts steps from the phone's motion sensor (browsers have no step sensors). Feed it how hard the phone is pushed
 *  (acceleration including gravity, m/s²) with each reading's time in ms; it says how many steps that reading adds.
 *  A step is a rise of the smoothed push above its slow average (gravity plus how the phone is held). How high it has
 *  to rise follows how hard your recent steps were, so a phone held in front of you counts as well as one in a pocket,
 *  and the bumps between steps don't count. Each step counts at once, so the count rises one by one from the first;
 *  a step that no second one follows within two seconds (a tap, picking the phone up) is taken back (-1). */
export class MotionSteps {
  private t = -1; private fast = 0; private slow = 0;
  private armed = true; private peak = 0; private size = 0;
  private last = -Infinity; private runLen = 0;
  push(push: number, t: number): number {
    if (this.t < 0) { this.t = t; this.fast = this.slow = push; return 0; }
    const dt = Math.min(0.2, Math.max(0.001, (t - this.t) / 1000));
    this.t = t;
    this.fast += (push - this.fast) * (dt / (0.04 + dt)); // smooths sensor noise, keeps the ~2 a second of walking
    this.slow += (push - this.slow) * (dt / (1 + dt)); // gravity and how the phone is held
    const d = this.fast - this.slow;
    let n = 0;
    // a lone step whose second never came
    if (this.runLen === 1 && t - this.last > 2000) { this.runLen = 0; n = -1; }
    if (t - this.last > 2000) this.size = 0; // standing still: the next walk may be gentler than the last
    if (this.armed && d > Math.max(0.3, this.size * 0.4) && t - this.last > 250) {
      this.armed = false; this.peak = d;
      this.runLen = t - this.last > 2000 ? 1 : this.runLen + 1;
      this.last = t;
      return n + 1;
    }
    if (!this.armed) {
      this.peak = Math.max(this.peak, d);
      // back below the average: the step is over, and its height sets the bar for the next ones
      if (d < 0) { this.armed = true; this.size = this.size ? this.size * 0.6 + this.peak * 0.4 : this.peak; }
    }
    return n;
  }
}
