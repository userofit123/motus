// Heart rate zones: the share of the person's max heart rate a beat falls in. The max is the one set in Body → About
// you, else the usual estimate from age (220 - age); without either there are no zones (a guess would mislead).

/** The five zones as shares of the max heart rate (from, up to the next one's from), the commonly used split */
export const HR_ZONES = [
  { key: "z1", name: "Very light", from: 0.5 },
  { key: "z2", name: "Light", from: 0.6 },
  { key: "z3", name: "Moderate", from: 0.7 },
  { key: "z4", name: "Hard", from: 0.8 },
  { key: "z5", name: "Maximum", from: 0.9 },
] as const;
export type HrZoneKey = (typeof HR_ZONES)[number]["key"];

/** The max heart rate to use, and whether it is the person's own or worked out from their age; null without either */
export function maxHeartRate(profile: { birthYear?: number | null; maxHr?: number | null }, now = new Date()): { bpm: number; own: boolean } | null {
  if (profile.maxHr && profile.maxHr > 0) return { bpm: profile.maxHr, own: true };
  if (profile.birthYear) return { bpm: 220 - (now.getFullYear() - profile.birthYear), own: false };
  return null;
}

/** The zone of a heart rate (index into HR_ZONES), or -1 under the first one */
export function zoneOf(bpm: number, max: number): number {
  for (let i = HR_ZONES.length - 1; i >= 0; i--) if (bpm >= HR_ZONES[i]!.from * max) return i;
  return -1;
}

/** A sample counts for the time up to the next one, at most this long (a longer gap: the band was off or not reading) */
export const SAMPLE_MAX_S = 300;

/**
 * Minutes in each zone from heart rate samples ([unix seconds, bpm], any order), each counting for the time up to the
 * next one (at most SAMPLE_MAX_S; the last one a minute). by: groups them (a day's key from its time), else one group "".
 */
export function zoneMinutes(samples: readonly (readonly [number, number])[], max: number, by: (t: number) => string = () => ""): Map<string, number[]> {
  const s = [...samples].sort((a, b) => a[0] - b[0]);
  const out = new Map<string, number[]>();
  for (let i = 0; i < s.length; i++) {
    const z = zoneOf(s[i]![1], max);
    if (z < 0) continue;
    const secs = i + 1 < s.length ? Math.min(SAMPLE_MAX_S, s[i + 1]![0] - s[i]![0]) : 60;
    const k = by(s[i]![0]), row = out.get(k) ?? out.set(k, HR_ZONES.map(() => 0)).get(k)!;
    row[z]! += secs / 60;
  }
  return out;
}

/**
 * Days whose resting heart rate stands out above the person's usual: at least `over` bpm above the average of the 28
 * days before it, with at least 7 of them read (fewer say too little). A raised resting heart rate can follow a hard
 * day, a short night or an illness coming on. days: { date: YYYY-MM-DD, value } in any order.
 */
export function highRestingDays(days: readonly { date: string; value: number }[], over = 5): { date: string; value: number; usual: number }[] {
  const s = [...days].filter((d) => d.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  const out: { date: string; value: number; usual: number }[] = [];
  for (const d of s) {
    const from = new Date(Date.parse(d.date + "T12:00:00Z") - 28 * 86400000).toISOString().slice(0, 10);
    const before = s.filter((x) => x.date >= from && x.date < d.date);
    if (before.length < 7) continue;
    const usual = before.reduce((t, x) => t + x.value, 0) / before.length;
    if (d.value - usual >= over) out.push({ date: d.date, value: d.value, usual: Math.round(usual) });
  }
  return out;
}

/** A ticked set of a finished workout, for its heart rate: when it was ticked (unix seconds), the rest taken after it and its own time when timed */
export interface TickedSet { id: string; weId: string; doneS: number; restS?: number | null; durationS?: number | null }
/** A set's own time on the clock, [a, b] (unix seconds), and the rest after it, [b, restB], when one was taken */
export interface SetSpan { id: string; weId: string; a: number; b: number; restB: number | null }

/** The longest stretch before a tick taken as its set (with the rest before it); a longer break doesn't count */
const MAX_SET_S = 10 * 60;
/** A set's own time when nothing says how long it took (not timed, no rest before it): about a set of 8-12 reps */
const GUESS_SET_S = 40;
/** Rests shorter than this are a tap between sides or exercises, not a rest */
const MIN_REST_S = 5;

/**
 * Where each set sits on the clock, from its tick: it ends at its tick and starts at the end of the rest before it (the
 * previous tick plus the rest taken), else its own time when timed, else GUESS_SET_S before its tick; never before
 * the previous tick or the workout's start, nor more than MAX_SET_S before its tick. The rest after it runs from its
 * tick for the rest taken, up to the next set's start. A workout typed in afterwards has every set ticked at the same
 * moment, which says nothing about when each was done: no spans then (as the engine's exerciseHr).
 */
export function setSpans(sets: readonly TickedSet[], startS: number): SetSpan[] {
  const s = sets.filter((x) => Number.isFinite(x.doneS)).sort((a, b) => a.doneS - b.doneS);
  if (s.length > 1 && new Set(s.map((x) => x.doneS)).size === 1) return [];
  const out: SetSpan[] = [];
  let prev = startS, prevRest: number | null = null;
  for (const x of s) {
    const own = x.durationS && x.durationS > 0 ? x.doneS - x.durationS : prevRest != null ? prev + prevRest : x.doneS - GUESS_SET_S;
    const a = Math.min(x.doneS, Math.max(prev, x.doneS - MAX_SET_S, own));
    const rest = x.restS != null && x.restS >= MIN_REST_S ? x.restS : null;
    out.push({ id: x.id, weId: x.weId, a, b: x.doneS, restB: rest != null ? x.doneS + rest : null });
    prev = Math.max(prev, x.doneS); prevRest = rest;
  }
  // a rest never runs into the next set
  for (let i = 0; i + 1 < out.length; i++) if (out[i]!.restB != null) out[i]!.restB = Math.min(out[i]!.restB!, out[i + 1]!.a);
  return out;
}

/** A set as the heart rate per exercise reads it: its exercise in the workout and when it was ticked (unix seconds) */
export interface HrTick { weId: string; doneS: number | null }

/**
 * Each exercise's average and highest heart rate, from samples ([unix seconds, bpm]), the one count the server (the
 * engine's exerciseHr) and the workout's page both use. A set's time runs from the set ticked before it (any exercise, so
 * supersets split correctly; the workout's start for the first) to its own tick, at most MAX_SET_S: the rest before a set
 * and the set itself. An exercise's heart rate is every reading in its sets' times. Exercises whose sets have no tick
 * times fall back to the exercise's own start and end (`fallback`), if it has them. A workout typed in afterwards has every
 * set ticked at the same moment, which says nothing about when each was done: its ticks are not used.
 */
export function exercisePeaks(samples: readonly (readonly [number, number])[], sets: readonly HrTick[], startS: number,
  fallback: ReadonlyMap<string, readonly [number, number]> = new Map()): Map<string, { avgHr: number; maxHr: number }> {
  const win = new Map<string, [number, number][]>();
  const add = (we: string, a: number, b: number) => (win.get(we) ?? win.set(we, []).get(we)!).push([a, b]);
  const ticked = sets.filter((x): x is HrTick & { doneS: number } => x.doneS != null && Number.isFinite(x.doneS)).sort((a, b) => a.doneS - b.doneS);
  const told = ticked.length < 2 || new Set(ticked.map((x) => x.doneS)).size > 1;
  let prev = startS;
  for (const x of told ? ticked : []) {
    add(x.weId, Math.max(prev, x.doneS - MAX_SET_S), x.doneS);
    prev = Math.max(prev, x.doneS);
  }
  for (const [we, [a, b]] of fallback) if (!win.has(we) && b > a) add(we, a, b);
  const out = new Map<string, { avgHr: number; maxHr: number }>();
  for (const [we, ws] of win) {
    const mine = samples.filter((p) => ws.some(([a, b]) => p[0] > a && p[0] <= b));
    if (mine.length) out.set(we, { avgHr: Math.round(mine.reduce((t, p) => t + p[1], 0) / mine.length), maxHr: Math.max(...mine.map((p) => p[1])) });
  }
  return out;
}

/** How long into a rest the heart rate is read for recovery: the usual one minute */
export const RECOVERY_S = 60;
/**
 * Heart rate recovery over the rests: how far the heart rate fell in the first minute of each rest of at least a minute,
 * from the highest reading around the set's end (30 s before its tick to 15 s after) to the reading nearest a minute in
 * (within 10 s), averaged. A quicker fall is a fitter heart. null when no rest has both readings.
 */
export function restRecovery(samples: readonly (readonly [number, number])[], spans: readonly SetSpan[]): { drop: number; rests: number } | null {
  const drops: number[] = [];
  for (const x of spans) {
    if (x.restB == null || x.restB - x.b < RECOVERY_S) continue;
    const near = samples.filter((p) => p[0] >= x.b - 30 && p[0] <= x.b + 15);
    const at = x.b + RECOVERY_S;
    const after = samples.filter((p) => Math.abs(p[0] - at) <= 10).sort((p, q) => Math.abs(p[0] - at) - Math.abs(q[0] - at))[0];
    if (!near.length || !after) continue;
    drops.push(Math.max(...near.map((p) => p[1])) - after[1]);
  }
  return drops.length ? { drop: Math.round(drops.reduce((t, d) => t + d, 0) / drops.length), rests: drops.length } : null;
}
