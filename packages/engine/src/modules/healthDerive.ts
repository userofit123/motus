// The band's numbers worked out from the saved Health Connect records (M-238), so every number traces back to its
// readings: a day's steps, and an activity's steps and heart rate. The rules are the phone's (MotusHealthPlugin.kt:
// dailyTotal / ownDays / addByDay for a day, spanByApp / coverage / bestBand / rangeHr for a span), ported one to one so
// the same records give the same numbers as the phone worked out before. What the phone can't be matched on stays the
// phone's (modules/health.ts takes it as a fallback): a day no band, watch or ring counted is Health Connect's own
// total, which picks between apps by its own priority list, not something the records say.
import type { Sql } from "../db";
import type { Rec } from "./healthRecords";
import type { WornDevice } from "@motus/shared";

// Health Connect's Device.TYPE_* numbers
const PHONE = 2;
const WORN_TYPES = new Set([1, 6, 4, 7]); // watch, fitness band, ring, chest strap
// Which apps' data comes from a band, watch or ring (the phone's isBand, see there for why): never Motus itself nor the
// phone's own step counting; a record that says watch, band, ring or chest strap; else a known band app.
const PHONE_APPS = new Set(["android", "com.google.android.apps.fitness", "com.google.android.apps.healthdata", "com.mi.health"]);
const BAND_APPS = [
  "nodomain.freeyourgadget.gadgetbridge",
  "com.xiaomi.wearable", "com.xiaomi.hm.health", "com.huami.watch.hmwatchmanager", "com.huami.midong",
  "com.fitbit.FitbitMobile", "com.garmin.android.apps.connectmobile", "com.huawei.health", "com.ouraring.oura",
  "com.whoop.android", "fi.polar.polarflow", "com.suunto.android",
];
const MOTUS_APP = "org.motus.app";
const phoneApp = (pkg: string) => PHONE_APPS.has(pkg) || pkg.startsWith("com.android.healthconnect") || pkg.startsWith("com.google.android.healthconnect");
export function isBand(pkg: string, type?: number): boolean {
  if (pkg === MOTUS_APP || phoneApp(pkg) || type === PHONE) return false;
  if (type != null && WORN_TYPES.has(type)) return true;
  return BAND_APPS.some((a) => pkg === a || pkg.startsWith(`${a}.`));
}
/** The kind of worn device a record names (the phone's wornOf; the daily log keeps the kind only, none for "unknown"). */
export function wornKind(type?: number): WornDevice | null {
  return type === 1 ? "watch" : type === 6 ? "band" : type === 4 ? "ring" : type === 7 ? "chestStrap" : null;
}
const known = (r: Rec) => r.dv?.type != null && r.dv.type !== 0;

/**
 * Exact duplicates (same app, start and end) count once, the most recently changed (the phone's once()/ownDays: Health
 * Connect keeps the newest; the first seen wins a tie).
 */
function once(recs: Rec[]): Rec[] {
  const kept = new Map<string, Rec>();
  for (const r of recs) {
    const k = `${r.o}\u0000${r.s}\u0000${r.e ?? r.s}`, cur = kept.get(k);
    if (!cur || r.m > cur.m) kept.set(k, r);
  }
  return [...kept.values()];
}
const dayOf = (localS: number) => new Date(localS * 1000).toISOString().slice(0, 10);

/**
 * One record added to its local days (its own offset, as Health Connect's day totals; only the start's is kept, so the
 * end uses it too), a record across midnight split by its share of time on each side (the phone's addByDay).
 */
function addByDay(r: Rec, into: Map<string, number>) {
  const s = r.s + r.z, e = (r.e ?? r.s) + r.z, v = r.v ?? 0;
  if (e <= s) { into.set(dayOf(s), (into.get(dayOf(s)) ?? 0) + v); return; }
  for (let d = Math.floor(s / 86400) * 86400; d < e; d += 86400) {
    const a = Math.max(s, d), b = Math.min(e, d + 86400);
    if (b > a) into.set(dayOf(d), (into.get(dayOf(d)) ?? 0) + (v * (b - a)) / (e - s));
  }
}

/**
 * The days a band, watch or ring counted on (steps, distance, active calories), with that device's own total (the
 * phone's dailyTotal): each band app's records added up one by one, and on a day two apps write for the same band, the
 * larger. An app is a band app by its newest record that names a device type, else its newest record (the phone's
 * bandOrigin), taken from kinds (appKinds: the same for every request, whatever days it reads) when given, else from
 * these records. recs: every record of the type that may fall on the days (a day either side). Days no band counted on
 * are left out: Health Connect's own total stands.
 */
export function bandDays(recs: Rec[], days: Iterable<string>, kinds?: AppKinds): Map<string, DayVal> {
  const byApp = new Map<string, Rec[]>();
  for (const r of recs) (byApp.get(r.o) ?? byApp.set(r.o, []).get(r.o)!).push(r);
  const own: { totals: Map<string, number>; device: WornDevice | null }[] = [];
  for (const [app, list] of byApp) {
    let type: number | undefined;
    if (kinds?.has(app)) type = kinds.get(app);
    else { const newest = [...list].sort((a, b) => b.s - a.s); type = (newest.find(known) ?? newest[0])?.dv?.type; }
    if (!isBand(app, type)) continue;
    const totals = new Map<string, number>();
    for (const r of once(list)) addByDay(r, totals);
    own.push({ totals, device: wornKind(type) });
  }
  const out = new Map<string, DayVal>();
  for (const d of days) {
    let best: DayVal | null = null;
    for (const o of own) {
      const v = o.totals.get(d);
      if (v != null && v > 0 && (!best || v > best.value)) best = { value: v, device: o.device };
    }
    if (best) out.set(d, { value: Math.round(best.value), device: best.device });
  }
  return out;
}

/**
 * A day's reading from every app's readings taken that day where they were taken (the phone's daily() and vo2max()):
 * resting heart rate the day's average in whole bpm, SpO2 and HRV the average to one decimal, VO2 max the day's latest.
 */
export function readingDays(type: ReadingType, recs: Rec[], days: Iterable<string>): Map<string, DayVal> {
  const by = new Map<string, Rec[]>();
  for (const r of recs) if (r.v != null) { const d = dayOf(r.s + r.z); (by.get(d) ?? by.set(d, []).get(d)!).push(r); }
  const out = new Map<string, DayVal>();
  for (const d of days) {
    const list = by.get(d);
    if (!list?.length) continue;
    // the latest: the first of equal times (the phone keeps the first)
    const value = type === "vo2max" ? list.reduce((a, b) => (b.s > a.s ? b : a)).v!
      : list.reduce((n, r) => n + r.v!, 0) / list.length;
    out.set(d, { value: type === "resting_hr" ? Math.round(value) : Math.round(value * 10) / 10, device: null });
  }
  return out;
}

// The device's data stands for a span when its step records reach past it on both sides, read from 30 minutes before
// to 30 after (the phone's SYNC_SLACK_MS and coverage)
const SLACK_S = 30 * 60;
/** What the band had for a span. steps: its count (null: no step record of the band inside); hr: its readings. */
export interface SpanBand { stepsKnown: boolean; steps: number | null; covered: boolean; hr: [number, number][] | null }

/**
 * The band's steps and heart rate for [startS, endS] (unix seconds; an activity's or workout's time), as the phone's
 * readRanges worked them out: per app (and per band or not, record by record), records crossing the edges count by their
 * share of time inside; the band app with steps inside, then the most of them, then the most heart rate readings
 * stands for the span (bestBand); covered when its step records reach past both ends. stepsKnown: there are step records
 * around the span at all (else nothing can be said about its steps from here).
 */
export function spanBand(steps: Rec[], hrRecs: Rec[], startS: number, endS: number): SpanBand {
  const from = startS - SLACK_S, to = endS + SLACK_S;
  const near = (r: Rec) => { const e = r.e ?? r.s; return e === r.s ? r.s >= from && r.s < to : e > from && r.s < to; };
  const st = steps.filter(near).sort((a, b) => a.s - b.s || (a.e ?? a.s) - (b.e ?? b.s));
  const hrs = hrRecs.filter((r) => near(r) && isBand(r.o, r.dv?.type)).sort((a, b) => a.s - b.s);
  const crosses = (r: Rec) => { const e = r.e ?? r.s; return r.s === e ? r.s >= startS && r.s <= endS : e > startS && r.s < endS; };
  const inside = (r: Rec) => {
    const e = r.e ?? r.s, len = e - r.s, v = r.v ?? 0;
    if (len <= 0) return v;
    return (v * Math.max(0, Math.min(e, endS) - Math.max(r.s, startS))) / len;
  };
  const groups = new Map<string, { app: string; band: boolean; recs: Rec[] }>();
  for (const r of st) {
    const band = isBand(r.o, r.dv?.type), k = `${r.o}\u0000${band}`;
    (groups.get(k) ?? groups.set(k, { app: r.o, band, recs: [] }).get(k)!).recs.push(r);
  }
  const hrByApp = new Map<string, Rec[]>();
  for (const r of hrs) (hrByApp.get(r.o) ?? hrByApp.set(r.o, []).get(r.o)!).push(r);
  for (const app of hrByApp.keys()) { const k = `${app}\u0000true`; if (!groups.has(k)) groups.set(k, { app, band: true, recs: [] }); }
  let best: { inside: boolean; raw: number; hr: number; covered: boolean } | null = null;
  for (const g of groups.values()) {
    if (!g.band) continue;
    const recs = once(g.recs), inSpan = recs.filter(crosses);
    const hr = (hrByApp.get(g.app) ?? []).flatMap((r) => (r.p ?? []).map((q) => q[0])).filter((t) => t >= from && t <= to).length;
    const span = { inside: inSpan.length > 0, raw: inSpan.reduce((n, r) => n + inside(r), 0), hr,
      covered: recs.some((r) => (r.e ?? r.s) >= endS) && recs.some((r) => r.s <= startS) };
    if (!span.inside && !hr) continue;
    // the first of equals stays, as Kotlin's maxWithOrNull
    if (!best || (+span.inside - +best.inside || span.raw - best.raw || span.hr - best.hr) > 0) best = span;
  }
  return { stepsKnown: st.length > 0, steps: best?.inside ? Math.round(best.raw) : null, covered: best?.covered ?? false, hr: rangeHr(hrs, startS, endS) };
}

/**
 * The band's heart rate readings inside the span as [unix seconds, bpm], averaged into at most 600 time buckets (the
 * phone's rangeHr, in milliseconds as there: bucket (ms - t0) * 600 / span in whole numbers, time the bucket's average
 * ms in whole seconds).
 */
export function rangeHr(hrs: Rec[], startS: number, endS: number): [number, number][] | null {
  const samples = hrs.flatMap((r) => r.p ?? []).filter((q) => q[0] >= startS && q[0] <= endS).sort((a, b) => a[0] - b[0]);
  if (!samples.length) return null;
  if (samples.length <= 600) return samples.map((q) => [q[0], q[1]]);
  const t0 = Math.round(startS * 1000), span = Math.max(Math.round(endS * 1000) - t0, 1);
  const sumT = new Array<number>(600).fill(0), sumB = new Array<number>(600).fill(0), n = new Array<number>(600).fill(0);
  for (const [t, b] of samples) {
    const ms = Math.round(t * 1000), i = Math.min(599, Math.max(0, Math.trunc(((ms - t0) * 600) / span)));
    sumT[i]! += ms; sumB[i]! += b; n[i]!++;
  }
  const out: [number, number][] = [];
  for (let i = 0; i < 600; i++) if (n[i]) out.push([Math.round(sumT[i]! / n[i]! / 1000), Math.round(sumB[i]! / n[i]!)]);
  return out;
}

export type SumType = "steps" | "distance" | "active_kcal";
export type ReadingType = "resting_hr" | "spo2" | "hrv" | "vo2max";
/** The daily numbers worked out from the records (the daily log's kinds of the same names); water stays Health Connect's own total. */
export const DERIVED_DAYS = ["steps", "distance", "active_kcal", "resting_hr", "spo2", "hrv", "vo2max"] as const;
export type DerivedType = (typeof DERIVED_DAYS)[number];
export const isSum = (t: DerivedType): t is SumType => t === "steps" || t === "distance" || t === "active_kcal";
export const shift = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
/** A day's number worked out from the records, and the kind of worn device it came from. */
export interface DayVal { value: number; device: WornDevice | null }

/**
 * The person's records lock: every change to the saved records, and everything worked out from them, runs under it
 * (POST /health/records and afterRecords, /health/import, a deletion that marks an import deleted: 041's trigger takes
 * it too). Taken first, before any row is written, so every path holds the lock before row locks and two of them never
 * wait on each other in opposite orders.
 */
export const lockRecords = (q: Sql, userId: string) => q.query("SELECT pg_advisory_xact_lock(hashtext('health_records:' || $1::uuid::text))", [userId]);

/** Loaded blocks: per type, per day, the day's records. */
export type Blocks = Map<string, Map<string, Rec[]>>;
/** Adds a block to load (type, day). */
export const want = (into: Map<string, Set<string>>, type: string, day: string) => void (into.get(type) ?? into.set(type, new Set()).get(type)!).add(day);
/** These blocks, in one query (only those asked for: a day either side of a payload's days, not the range between). */
export async function loadBlocks(q: Sql, wanted: Map<string, Set<string>>): Promise<Blocks> {
  const types: string[] = [], days: string[] = [];
  const out: Blocks = new Map();
  for (const [t, ds] of wanted) { out.set(t, new Map()); for (const d of ds) { types.push(t); days.push(d); } }
  if (!types.length) return out;
  const { rows } = await q.query<{ type: string; day: string; recs: unknown }>(
    `SELECT h.type, to_char(h.day, 'YYYY-MM-DD') AS day, h.recs FROM health_records h
     JOIN unnest($1::text[], $2::date[]) w(type, day) ON h.type = w.type AND h.day = w.day`, [types, days]);
  for (const x of rows) out.get(x.type)!.set(x.day, Object.values((typeof x.recs === "string" ? JSON.parse(x.recs) : x.recs) as Record<string, Rec>));
  return out;
}
const recsOf = (b: Blocks, type: string, days: Iterable<string>) => [...days].flatMap((d) => b.get(type)?.get(d) ?? []);
// a record across midnight files under the day before; a zone up to 14 hours away files a day either side
const around = (d: string) => [shift(d, -2), shift(d, -1), d, shift(d, 1)];

/**
 * The times each type was read whole from Health Connect (the phone's reads posted as complete, merged), with the zone
 * of the read. A day's number is worked out from the records only when its whole day was read (readDay): a day read in
 * part (a forward read up to now, a back-fill not there yet) keeps the phone's number, which had all of it.
 */
export type Reads = Map<string, { a: number; b: number; z: number }[]>;
/**
 * A complete read of [fromS, toS] (zone: seconds east of UTC) added to the type's read times. Runs under lockRecords.
 * It merges only with reads of the same zone that it touches or overlaps: a gap between two reads was never read, and a
 * read in another zone keeps its own window and zone (its days begin where it was read).
 */
export async function noteRead(q: Sql, userId: string, type: string, fromS: number, toS: number, zone: number) {
  const { rows } = await q.query<{ a: string; b: string }>(
    "DELETE FROM health_record_reads WHERE type = $1 AND zone = $4 AND from_s <= $3 AND to_s >= $2 RETURNING from_s::text AS a, to_s::text AS b",
    [type, Math.floor(fromS), Math.ceil(toS), zone]);
  const a = Math.min(Math.floor(fromS), ...rows.map((x) => Number(x.a))), b = Math.max(Math.ceil(toS), ...rows.map((x) => Number(x.b)));
  await q.query("INSERT INTO health_record_reads (user_id, type, from_s, to_s, zone) VALUES ($1, $2, $3, $4, $5)", [userId, type, a, b, zone]);
}
export async function loadReads(q: Sql, types: string[]): Promise<Reads> {
  const out: Reads = new Map(types.map((t) => [t, []]));
  const { rows } = await q.query<{ type: string; a: string; b: string; z: number }>(
    "SELECT type, from_s::text AS a, to_s::text AS b, zone AS z FROM health_record_reads WHERE type = ANY($1::text[])", [types]);
  for (const x of rows) out.get(x.type)?.push({ a: Number(x.a), b: Number(x.b), z: Number(x.z) });
  return out;
}
/** Whether the whole local day d (in the read's zone) of this type was read. */
export const readDay = (reads: Reads, type: string, d: string) => {
  const t0 = Date.parse(d + "T00:00:00Z") / 1000;
  return (reads.get(type) ?? []).some((s) => s.a <= t0 - s.z && s.b >= t0 + 86400 - s.z);
};

/**
 * Per amount type, each app's kind of device for bandDays: its newest record naming a device type among its newest
 * 100, else its newest (the phone's bandOrigin), over the KIND_DAYS days up to the type's newest saved day. Independent
 * of the days a request asks about, so the import and afterRecords classify an app the same way. Runs on every save
 * under the records lock, so it looks at a short recent stretch only (a band app writes well over 100 records in it); an
 * app with no records there is classified by its records on the days asked about (bandDays), as before 90 days.
 */
const KIND_DAYS = 14;
export type AppKinds = Map<string, number | undefined>;
export async function appKinds(q: Sql, types: SumType[]): Promise<Map<SumType, AppKinds>> {
  const out = new Map<SumType, AppKinds>(types.map((t) => [t, new Map()]));
  if (!types.length) return out;
  const { rows } = await q.query<{ type: SumType; o: string; t: number | null }>(
    `WITH lim AS (SELECT type, max(day) - ${KIND_DAYS} AS d FROM health_records WHERE type = ANY($1::text[]) GROUP BY type),
     r AS (SELECT h.type, x.r->>'o' AS o, nullif((x.r->'dv'->>'type')::int, 0) AS t, (x.r->>'s')::float8 AS s
           FROM health_records h JOIN lim ON lim.type = h.type AND h.day >= lim.d CROSS JOIN LATERAL jsonb_each(h.recs) x(id, r)),
     n AS (SELECT *, row_number() OVER (PARTITION BY type, o ORDER BY s DESC) AS i FROM r),
     k AS (SELECT *, row_number() OVER (PARTITION BY type, o ORDER BY (t IS NOT NULL) DESC, s DESC) AS j FROM n WHERE i <= 100)
     SELECT type, o, t FROM k WHERE j = 1`, [types]);
  for (const x of rows) out.get(x.type)?.set(x.o, x.t ?? undefined);
  return out;
}

/** The blocks derivedDays needs for these days of this type (only those read whole). */
export function dayBlocks(type: DerivedType, days: Iterable<string>, reads: Reads, into: Map<string, Set<string>>) {
  for (const d of new Set(days)) if (readDay(reads, type, d)) for (const x of around(d)) want(into, type, x);
}
/** One type's daily numbers for the days read whole, from loaded blocks (bandDays, readingDays); other days are left out. */
export function derivedDays(type: DerivedType, blocks: Blocks, days: Iterable<string>, reads: Reads, kinds?: AppKinds): Map<string, DayVal> {
  const ok = [...new Set(days)].filter((d) => readDay(reads, type, d));
  const recs = recsOf(blocks, type, new Set(ok.flatMap((d) => around(d))));
  return isSum(type) ? bandDays(recs, ok, kinds) : readingDays(type, recs, ok);
}

const utcDay = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
/** The blocks a span's records may be filed under (spanFrom; read from 30 minutes either side, a zone a day either side). */
export function spanBlocks(startS: number, endS: number, into: Map<string, Set<string>>) {
  const a = shift(utcDay(startS - SLACK_S), -2), b = shift(utcDay(endS + SLACK_S), 1);
  for (let d = a; d <= b; d = shift(d, 1)) { want(into, "steps", d); want(into, "heart_rate", d); }
}
/** What the band had for a span, from loaded blocks (spanBlocks; spanBand). */
export function spanFrom(blocks: Blocks, startS: number, endS: number): SpanBand {
  const days: string[] = [];
  for (let d = shift(utcDay(startS - SLACK_S), -2), b = shift(utcDay(endS + SLACK_S), 1); d <= b; d = shift(d, 1)) days.push(d);
  return spanBand(recsOf(blocks, "steps", days), recsOf(blocks, "heart_rate", days), startS, endS);
}

// Health Connect's sleep stage numbers: awake, out of bed, awake in bed
const AWAKE = new Set([1, 3, 7]);
/** A stage's kind in a night: light, deep, REM, asleep with no stage (sleeping, unknown, a night without stages), awake (the phone's stageKind). */
const stageKind = (k: number) => (k === 4 ? 0 : k === 5 ? 1 : k === 6 ? 2 : AWAKE.has(k) ? 4 : 3);
/** A night as the phone sent it (POST /health/import sleepNights; readNight checks it). */
export interface NightIn {
  date: string; start: string; end: string; asleepMin: number; awakeMin: number; lightMin?: number; deepMin?: number; remMin?: number;
  avgHr?: number; minHr?: number; hr?: [number, number][]; avgSpo2?: number; minSpo2?: number; respRate?: number;
}
// a session's z is its end's offset (the phone sends endZoneOffset for sleep, MotusHealthPlugin.kt), so this is the day
// it ended where it ended, as the phone's wakeDay
const wakeDay = (r: Rec) => dayOf((r.e ?? r.s) + r.z);

/**
 * Each wake-up day's sleep from the night's sessions (the phone's sleep() and sleepNights(), the day of a session's end
 * where it was written): hours: the time asleep, overlapping sessions' asleep parts counted once; night: from the
 * earliest start to the latest end, minutes per stage (sessions with stages first, then the longest; a later one only
 * fills time the earlier ones left), and every app's heart rate (average, lowest, at most 300 points), SpO2 and
 * breathing rate in that window. A day without time asleep is left out.
 */
export function sleepDays(sessions: Rec[], hr: Rec[], spo2: Rec[], resp: Rec[], days: Iterable<string>): Map<string, { hours: number | null; night: NightIn | null }> {
  const want = new Set(days);
  const byDay = new Map<string, Rec[]>();
  for (const r of sessions) { const d = wakeDay(r); if (want.has(d)) (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r); }
  const out = new Map<string, { hours: number | null; night: NightIn | null }>();
  interface N { day: string; s: number; e: number; ms: number[]; staged: boolean }
  const nights: N[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const list = byDay.get(day)!;
    // hours: the asleep parts merged
    const parts = list.flatMap((r) => (r.st?.length ? r.st.filter((x) => !AWAKE.has(x[2])).map((x) => [x[0], x[1]]) : [[r.s, r.e ?? r.s]]))
      .sort((a, b) => a[0]! - b[0]!);
    let secs = 0, cs: number | null = null, ce = 0;
    for (const [a, b] of parts) {
      if (cs == null || a! > ce) { if (cs != null) secs += ce - cs; cs = a!; ce = b!; } else if (b! > ce) ce = b!;
    }
    if (cs != null) secs += ce - cs;
    const hours = secs > 0 ? secs / 3600 : null;
    // stages, each moment once
    const ordered = [...list].sort((a, b) => +!a.st?.length - +!b.st?.length || ((b.e ?? b.s) - b.s) - ((a.e ?? a.s) - a.s));
    let claimed: [number, number][] = [];
    const ms = [0, 0, 0, 0, 0];
    for (const r of ordered) {
      const segs = r.st?.length ? r.st.map((x) => [x[0], x[1], stageKind(x[2])]) : [[r.s, r.e ?? r.s, 3]];
      for (const [a, b, k] of segs as [number, number, number][]) {
        if (b <= a) continue;
        let cur = a;
        for (const iv of claimed) {
          if (iv[1] <= cur) continue;
          if (iv[0] >= b) break;
          if (iv[0] > cur) ms[k]! += iv[0] - cur;
          cur = Math.max(cur, iv[1]);
          if (cur >= b) break;
        }
        if (cur < b) ms[k]! += b - cur;
        claimed.push([a, b]);
        claimed.sort((x, y) => x[0] - y[0]);
        const merged: [number, number][] = [];
        for (const iv of claimed) { const last = merged.at(-1); if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else merged.push([iv[0], iv[1]]); }
        claimed = merged;
      }
    }
    out.set(day, { hours, night: null });
    if (ms[0]! + ms[1]! + ms[2]! + ms[3]! <= 0) continue;
    nights.push({ day, s: Math.min(...list.map((r) => r.s)), e: Math.max(...list.map((r) => r.e ?? r.s)), ms, staged: ms[0]! + ms[1]! + ms[2]! > 0 });
  }
  // the night whose window holds time t (the later one wins where two overlap)
  const at = (t: number): number | null => {
    let i = -1;
    for (let j = 0; j < nights.length && nights[j]!.s <= t; j++) i = j;
    for (let j = i; j >= Math.max(i - 1, 0); j--) if (t <= nights[j]!.e && t >= nights[j]!.s) return j;
    return null;
  };
  const hrAcc = nights.map(() => ({ sum: 0, n: 0, min: Infinity, bt: new Array<number>(300).fill(0), bb: new Array<number>(300).fill(0), bn: new Array<number>(300).fill(0) }));
  if (nights.length) for (const r of hr) for (const [t, b] of r.p ?? []) {
    const i = at(t);
    if (i == null) continue;
    const h = hrAcc[i]!, n = nights[i]!;
    h.sum += b; h.n++; h.min = Math.min(h.min, b);
    const k = Math.min(299, Math.max(0, Math.floor(((t - n.s) * 300) / Math.max(n.e - n.s, 0.001))));
    h.bt[k]! += t; h.bb[k]! += b; h.bn[k]!++;
  }
  const pick = (recs: Rec[]) => { const by = nights.map(() => [] as number[]); for (const r of recs) { const i = at(r.s); if (i != null && r.v != null) by[i]!.push(r.v); } return by; };
  const ox = pick(spo2), rr = pick(resp);
  const one = (v: number) => Math.round(v * 10) / 10, mins = (s: number) => Math.round(s / 60);
  nights.forEach((n, i) => {
    const night: NightIn = { date: n.day, start: new Date(n.s * 1000).toISOString(), end: new Date(n.e * 1000).toISOString(),
      asleepMin: mins(n.ms[0]! + n.ms[1]! + n.ms[2]! + n.ms[3]!), awakeMin: mins(n.ms[4]!) };
    if (n.staged) Object.assign(night, { lightMin: mins(n.ms[0]!), deepMin: mins(n.ms[1]!), remMin: mins(n.ms[2]!) });
    const h = hrAcc[i]!;
    if (h.n) {
      night.avgHr = Math.round(h.sum / h.n); night.minHr = h.min;
      night.hr = [];
      for (let k = 0; k < 300; k++) if (h.bn[k]) night.hr.push([Math.round(h.bt[k]! / h.bn[k]!), Math.round(h.bb[k]! / h.bn[k]!)]);
    }
    if (ox[i]!.length) { night.avgSpo2 = one(ox[i]!.reduce((a, b) => a + b, 0) / ox[i]!.length); night.minSpo2 = one(Math.min(...ox[i]!)); }
    if (rr[i]!.length) night.respRate = one(rr[i]!.reduce((a, b) => a + b, 0) / rr[i]!.length);
    out.get(n.day)!.night = night;
  });
  for (const [d, v] of out) if (v.hours == null && !v.night) out.delete(d);
  return out;
}

/**
 * The sleep of these wake-up days from loaded blocks (sleepBlocks says which), only for nights whose sessions were read
 * whole (the day before and the day itself, readDay); the night's detail only when the heart rate then was read whole
 * too (else the phone's night stands).
 */
export function sleepFrom(blocks: Blocks, days: Iterable<string>, reads: Reads) {
  const ok = [...new Set(days)].filter((d) => readDay(reads, "sleep", d) && readDay(reads, "sleep", shift(d, -1)));
  const near = [...new Set(ok.flatMap((d) => around(d)))];
  const got = sleepDays(recsOf(blocks, "sleep", near), recsOf(blocks, "heart_rate", near), recsOf(blocks, "spo2", near), recsOf(blocks, "resp_rate", near), ok);
  for (const [d, v] of got) if (v.night && !(readDay(reads, "heart_rate", d) && readDay(reads, "heart_rate", shift(d, -1)))) v.night = null;
  for (const [d, v] of got) if (v.hours == null && !v.night) got.delete(d);
  return got;
}
/** The blocks sleepFrom needs for these days (only those read whole). */
export function sleepBlocks(days: Iterable<string>, reads: Reads, into: Map<string, Set<string>>) {
  for (const d of new Set(days)) {
    if (!(readDay(reads, "sleep", d) && readDay(reads, "sleep", shift(d, -1)))) continue;
    for (const t of ["sleep", "heart_rate", "spo2", "resp_rate"]) for (const x of around(d)) want(into, t, x);
  }
}
