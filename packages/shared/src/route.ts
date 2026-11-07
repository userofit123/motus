// A recorded route of [lat, lon, unix s, altitude] points: which fixes go on it, its distance, moving time and climb,
// and the walk's step count (from the phone's step counter, or, in a browser or on a phone without one, estimated from
// its motion sensor). Shared so the recording screen shows the same distance that is saved, and so this counting is
// tested.

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

/** One reading from the Android app's step counter (the phone's own pedometer, Sensor.TYPE_STEP_COUNTER): the steps
 *  it has counted since `session` (when it started counting for this app), -1 before its first report. */
export interface StepReading { session: number; counter: number }
/** Where a recording's step count stands: `steps` so far, and the counter's count (`seen`) at the last reading of `session`. */
export interface StepState { steps: number; session: number | null; seen: number }

/** Adds a step reading to the recording's count. The step counter is the phone's own pedometer, the one Android's
 *  docs recommend for counting steps: it only counts once it's sure you're walking (so shaking or tapping the phone
 *  adds nothing), and reports in bunches up to ten seconds apart, each with every step since the last, so nothing is
 *  lost. Only its growth since the last reading is added: a reading that comes late or twice adds nothing twice. While
 *  paused the readings move `seen` on without counting. A new session (the app was restarted) counts from its own zero. */
export function addStepReading(s: StepState, r: StepReading, paused: boolean): StepState {
  const now = Math.max(0, r.counter);
  const from = s.session === r.session ? s.seen : 0;
  const grew = Math.max(0, now - from);
  return { steps: s.steps + (paused ? 0 : grew), session: r.session, seen: Math.max(from, now) };
}

/** Whether a live step report counts as taken while paused. Pause and Resume each ask the counter for the steps it
 *  still holds back (`settle` and `resume`: when each was asked, null when none is on its way), and each waits for the
 *  one asked before it. Until the older one's answer is in, reports belong to its side: before Pause they count, before
 *  Resume (taken while paused) they don't. With neither on its way, it is whether the recording is paused now. */
export function stepsPaused(pausedNow: boolean, settle: number | null, resume: number | null): boolean {
  if (settle != null && (resume == null || settle < resume)) return false;
  if (resume != null) return true;
  return pausedNow;
}

/** Estimates steps from the motion sensor, for browsers, which have no step counter. Feed it how hard the phone is
 *  pushed (acceleration including gravity, m/s²) with each reading's time in ms; it says how many steps that reading
 *  adds. Done the way pedometers do it: the push is smoothed, its slow average (gravity plus how the phone is held) is
 *  taken off, and a step is a peak at least STEP_MIN_PUSH above that average, then a fall back below it. Like the
 *  phone's own step counter, nothing counts until STEP_RUN peaks have come in a walking rhythm (each 0.3-2 s after the
 *  last, none much quicker or slower than the one before); then those count at once and each step after it as it
 *  comes. So a wobble, a tap or picking the phone up never adds steps: they are too weak, or too few, or out of rhythm.
 *  Once counting, one step out of rhythm doesn't stop it; two in a row do. A late one (a step too soft to see before
 *  it) counts only once the next step comes back in the old rhythm, so a bump after you've stopped adds nothing. */
export const STEP_MIN_PUSH = 1; // m/s²: walking with the phone in a hand or pocket is well above it, a wobble below
export const STEP_RUN = 6;
export class MotionSteps {
  private t = -1; private fast = 0; private slow = 0;
  private armed = true; private peak = 0; private size = 0;
  private last = -Infinity; private gap = 0;
  /** peaks so far in the current rhythm, and whether it was confirmed as walking (its steps are being counted) */
  private run = 0; private walking = false;
  /** a step out of rhythm was let through; the next must be in it again */
  private odd = false;
  /** steps of a late one held back until the walk goes on in its rhythm; dropped if it doesn't */
  private held = 0;
  push(push: number, t: number): number {
    if (this.t < 0) { this.t = t; this.fast = this.slow = push; return 0; }
    const dt = Math.min(0.2, Math.max(0.001, (t - this.t) / 1000));
    this.t = t;
    this.fast += (push - this.fast) * (dt / (0.05 + dt)); // takes off sensor noise, keeps the 1-3 steps a second
    this.slow += (push - this.slow) * (dt / (1.5 + dt)); // gravity and how the phone is held
    const d = this.fast - this.slow;
    // stopped: the next walk starts over, and a late step held back was a bump after it, not a step
    if (t - this.last > 2000) { this.run = 0; this.walking = false; this.size = 0; this.odd = false; this.held = 0; }
    if (!this.armed) {
      this.peak = Math.max(this.peak, d);
      // back below the average: the step is over, and its height sets the bar for the next ones (a strong walk's
      // in-between bumps then don't count)
      if (d < 0) { this.armed = true; this.size = this.size ? this.size * 0.7 + this.peak * 0.3 : this.peak; }
      return 0;
    }
    if (d < Math.max(STEP_MIN_PUSH, this.size * 0.5)) return 0;
    this.armed = false; this.peak = d;
    const gap = t - this.last;
    if (gap < 300) return 0; // a second bump within one step
    // in rhythm: about as long after the last step as that one was after the one before it
    const steady = this.run > 0 && gap <= 2000 && (this.run < 2 || (gap > this.gap * 0.6 && gap < this.gap / 0.6));
    if (!steady && this.walking && !this.odd && gap <= 2000) {
      // one odd step in a walk already counting (a stumble, a bump between steps, a step too soft to see): the walk
      // goes on in its rhythm. Two in a row and it starts over, so it never lets wobbles through.
      this.odd = true;
      if (gap < this.gap) return 0; // a bump between two steps: not one, and the next step is timed from the last
      // late: held back until the next step comes in the old rhythm (this.gap stays), so a bump after you've stopped
      // (taking the phone out, a tap) never counts. About two steps' time (where a missed step would put it): this step
      // and one too soft to see before it; sooner or later than that, a hesitation: this step only.
      this.last = t;
      this.held = gap >= this.gap * 1.8 && gap <= this.gap * 2.25 ? 2 : 1;
      return 0;
    }
    if (!steady) this.held = 0; // a second odd step: the late one wasn't part of the walk
    this.last = t;
    this.gap = gap;
    this.odd = false;
    if (!steady) { this.run = 1; this.walking = false; return 0; }
    this.run++;
    if (this.walking) { const n = 1 + this.held; this.held = 0; return n; }
    if (this.run < STEP_RUN) return 0;
    this.walking = true;
    return this.run;
  }
}
