// Health Connect (Android): what other apps on the phone recorded (a band through Gadgetbridge, a scale, a watch) comes
// in here. The Android app reads Health Connect and sends one batch; the engine decides what to keep, so the rules hold
// for a local account and for a server account's copy on the phone alike.
// - Daily steps and sleep go into the daily log as source "health_connect". A value typed in by hand stays: the person's
//   own number wins over a device's (as for steps, PLAN.md decision M-155). The same for a band's daily resting heart
//   rate, SpO2 and HRV (028), daily distance (metres) and active calories (029), water (ml) and VO2 max (030).
// - A night of sleep in detail (stages, heart rate, SpO2, breathing) goes into sleep_nights (029), under the day's
//   sleep key: the night is the detail, the daily sleep hours stay the person's when typed.
// - Weight and body fat go into the body log once: by their Health Connect id, or (from an app that doesn't send one) a
//   reading of that kind already logged at the same minute is the same reading.
// - A day's heart rate (lowest, highest, average and a series for a chart) goes into hr_days (030), written again on each
//   import. It is a by-product of the heart rate samples, not an entry of its own, so it is not in the import log.
// - Exercise sessions become activities keyed by their Health Connect id, so a second sync never adds them twice and an
//   activity edited in Motus keeps the edits.
// - Activities recorded and workouts done in Motus while wearing a band get the band's side of them afterwards
//   (/health/ranges): its step count for exactly that time, and heart rate.
// Everything brought in is noted in health_imports (027), the import log the person can edit and delete from. A deletion
// sticks: from the log, or of the data itself anywhere else in the app, the key is never imported again.
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { dateStr, isoTime, numOrNull, intOrNull, str, tzOf } from "../util";
import { uuidv7, isUuid } from "../ids";
import { bad, notFound } from "../errors";
import { ensureTypes, saveActivity, stepsByDay } from "./activities";
import { dayIn } from "./achievements";

export const HEALTH_SOURCE = "health_connect";
type Daily = "steps" | "sleep" | "resting_hr" | "spo2" | "hrv" | "distance" | "active_kcal" | "water" | "vo2max";
/** Readings that go into the body log (body_metrics), one row each. */
type Body = "weight" | "body_fat";
type Kind = Daily | Body | "activity";
/** The daily log's kind for each daily import. */
const DAILY_KIND: Record<Daily, string> = {
  steps: "steps", sleep: "sleep_h", resting_hr: "resting_hr", spo2: "spo2", hrv: "hrv", distance: "distance_m", active_kcal: "active_kcal", water: "water_ml", vo2max: "vo2max",
};
const isDaily = (k: string): k is Daily => k in DAILY_KIND;
const isBody = (k: string): k is Body => k === "weight" || k === "body_fat";
/** What a day's value may be, and how it is kept: bpm, ms, metres, kcal and ml whole, sleep hours, SpO2 % and VO2 max to one decimal. */
const DAILY_RANGE: Record<Daily, [number, number, number]> = {
  steps: [0, 1e6, 1], sleep: [0, 24, 10], resting_hr: [25, 200, 1], spo2: [50, 100, 10], hrv: [1, 500, 1], distance: [0, 500000, 1], active_kcal: [0, 20000, 1],
  water: [0, 20000, 1], vo2max: [10, 100, 10],
};
/** What a body reading may be, and how it is kept: kg to two decimals, body fat % to one. */
const BODY_RANGE: Record<Body, [number, number, number]> = { weight: [1, 700, 100], body_fat: [1, 75, 10] };
const bodyValue = (k: Body, v: unknown) => {
  const [min, max, f] = BODY_RANGE[k];
  const n = numOrNull(v, min, max);
  return n == null ? null : Math.round(n * f) / f;
};
const dailyValue = (k: Daily, v: unknown) => {
  const [min, max, f] = DAILY_RANGE[k];
  const n = numOrNull(v, min, max);
  return n == null ? null : Math.round(n * f) / f;
};
/** A value from a band that is out of range (a glitch, a reading taken off the wrist) is skipped, not the whole batch. */
const lenient = (k: Daily, v: unknown) => { try { return dailyValue(k, v); } catch { return null; } };
const lenientBody = (k: Body, v: unknown) => { try { return bodyValue(k, v); } catch { return null; } };
const DAILY_SQL = `(${Object.values(DAILY_KIND).map((k) => `'${k}'`).join(", ")})`;
/** The daily log's kind for an import log row's kind, in SQL (h: health_imports). */
const DAILY_CASE = `CASE h.kind ${Object.entries(DAILY_KIND).map(([i, d]) => `WHEN '${i}' THEN '${d}'`).join(" ")} END`;
interface Imp { kind: Kind; date: string | null; ref: string | null; deleted: boolean }

const remember = (ctx: Ctx, key: string, kind: Kind, date: string | null, ref: string | null) => ctx.q.query(
  `INSERT INTO health_imports (user_id, key, kind, date, ref) VALUES ($1,$2,$3,$4,$5)
   ON CONFLICT (user_id, key) DO UPDATE SET imported_at = now(), ref = EXCLUDED.ref WHERE health_imports.deleted_at IS NULL`,
  [ctx.userId, key, kind, date, ref]);
const forget = (ctx: Ctx, key: string) => ctx.q.query("UPDATE health_imports SET deleted_at = now() WHERE key = $1 AND deleted_at IS NULL", [key]);

/** One entry of the log with what it is now: null when it is deleted, or its data was deleted elsewhere. */
async function entry(ctx: Ctx, key: string) {
  const h = (await ctx.q.query("SELECT kind, to_char(date, 'YYYY-MM-DD') AS date, ref FROM health_imports WHERE key = $1 AND deleted_at IS NULL", [key])).rows[0] as
    { kind: Kind; date: string | null; ref: string | null } | undefined;
  if (!h) return null;
  const there = isDaily(h.kind)
    ? (await ctx.q.query("SELECT 1 FROM daily_logs WHERE date = $1 AND kind = $2", [h.date, DAILY_KIND[h.kind]])).rows.length > 0
    : (await ctx.q.query(`SELECT 1 FROM ${isBody(h.kind) ? "body_metrics" : "activities"} WHERE id::text = $1`, [h.ref])).rows.length > 0;
  return { ...h, there };
}

/** The most heart rate points kept per activity or workout: enough for a chart, small enough to sync. */
const HR_POINTS = 600;
/**
 * A band's heart rate for one activity or workout: [unix seconds, bpm] pairs inside its time (a minute either side, for
 * clocks a little apart), sorted, at most HR_POINTS (averaged in even runs, so a long session keeps its shape).
 * Average and max come from every reading, before thinning. Readings out of 25-250 bpm are glitches and left out.
 */
export function heartRate(v: unknown, startS: number, endS: number, points = HR_POINTS): { hr: [number, number][]; avg: number; max: number; min: number } | null {
  if (!Array.isArray(v)) return null;
  const pts = new Map<number, number>();
  for (const p of v.slice(0, 100000)) {
    if (!Array.isArray(p)) continue;
    const t = Number(p[0]), b = Number(p[1]);
    if (!Number.isFinite(t) || !Number.isFinite(b) || b < 25 || b > 250 || t < startS - 60 || t > endS + 60) continue;
    pts.set(Math.round(t), Math.round(b));
  }
  const all = [...pts].sort((a, b) => a[0] - b[0]);
  if (all.length < 2) return null;
  const avg = Math.round(all.reduce((s, p) => s + p[1], 0) / all.length);
  const max = all.reduce((m, p) => Math.max(m, p[1]), 0), min = all.reduce((m, p) => Math.min(m, p[1]), 999);
  if (all.length <= points) return { hr: all, avg, max, min };
  const hr: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const run = all.slice(Math.floor((i * all.length) / points), Math.floor(((i + 1) * all.length) / points));
    hr.push([Math.round(run.reduce((s, p) => s + p[0], 0) / run.length), Math.round(run.reduce((s, p) => s + p[1], 0) / run.length)]);
  }
  return { hr, avg, max, min };
}

/** The most heart rate points kept per night: a night is long and calm, so fewer than a workout. */
const NIGHT_HR_POINTS = 300;
/** A value from a band, or null when missing or out of range (a glitch is dropped, not the night). */
const soft = (v: unknown, min: number, max: number, f = 1) => {
  try { const n = numOrNull(v, min, max); return n == null ? null : Math.round(n * f) / f; } catch { return null; }
};
const MIN_PER_NIGHT = 24 * 60;
interface Night {
  date: string; start: string; end: string; asleep: number; awake: number; light: number | null; deep: number | null; rem: number | null;
  avgHr: number | null; minHr: number | null; hr: [number, number][] | null; avgSpo2: number | null; minSpo2: number | null; respRate: number | null;
}
/** A night as the phone sent it, checked; null when it can't be a night (no day, no asleep time, times the wrong way round, over a day long). */
export function readNight(e: any): Night | null {
  if (!e || typeof e !== "object") return null;
  let date: string | null, start: string, end: string;
  try { date = dateStr(e.date); start = isoTime(e.start); end = isoTime(e.end); } catch { return null; }
  const s = Date.parse(start) / 1000, t = Date.parse(end) / 1000;
  if (!date || t <= s || t - s > MIN_PER_NIGHT * 60) return null;
  const asleep = soft(e.asleepMin, 0, MIN_PER_NIGHT), awake = soft(e.awakeMin, 0, MIN_PER_NIGHT) ?? 0;
  if (asleep == null) return null;
  const h = heartRate(e.hr, s, t, NIGHT_HR_POINTS);
  return {
    date, start, end, asleep, awake,
    light: soft(e.lightMin, 0, MIN_PER_NIGHT), deep: soft(e.deepMin, 0, MIN_PER_NIGHT), rem: soft(e.remMin, 0, MIN_PER_NIGHT),
    // the phone's own figures when it sent them (from every reading), else worked out from the series
    avgHr: soft(e.avgHr, 25, 250) ?? h?.avg ?? null, minHr: soft(e.minHr, 25, 250) ?? h?.min ?? null, hr: h?.hr ?? null,
    avgSpo2: soft(e.avgSpo2, 50, 100, 10), minSpo2: soft(e.minSpo2, 50, 100, 10), respRate: soft(e.respRate, 4, 60, 10),
  };
}
const NIGHT_COLS = ["start_at", "end_at", "asleep_min", "awake_min", "light_min", "deep_min", "rem_min", "avg_hr", "min_hr", "hr", "avg_spo2", "min_spo2", "resp_rate"];
const UPSERT_NIGHT = `INSERT INTO sleep_nights (user_id, date, ${NIGHT_COLS.join(", ")}, source) VALUES (${[...NIGHT_COLS, 0, 0, 0].map((_, i) => `$${i + 1}`).join(",")})
  ON CONFLICT (user_id, date) DO UPDATE SET ${NIGHT_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, source = EXCLUDED.source
  WHERE (${NIGHT_COLS.map((c) => `sleep_nights.${c}`).join(", ")}) IS DISTINCT FROM (${NIGHT_COLS.map((c) => `EXCLUDED.${c}`).join(", ")})
  RETURNING 1`;

/** The most heart rate points kept per day: one per 5 minutes. */
const DAY_HR_POINTS = 288;
/** A day's heart rate as the phone sent it, checked; null without a day, or with neither figures nor a series. */
export function readHrDay(e: any): { date: string; min: number | null; max: number | null; avg: number | null; hr: [number, number][] | null } | null {
  if (!e || typeof e !== "object") return null;
  let date: string | null;
  try { date = dateStr(e.date); } catch { return null; }
  if (!date) return null;
  // the series is the phone's for that day; its times are not checked against the day, whose bounds depend on the phone's zone
  const h = heartRate(e.hr, -Infinity, Infinity, DAY_HR_POINTS);
  const min = soft(e.min, 25, 250) ?? h?.min ?? null, max = soft(e.max, 25, 250) ?? h?.max ?? null, avg = soft(e.avg, 25, 250) ?? h?.avg ?? null;
  if (min == null && max == null && avg == null) return null;
  return { date, min, max, avg, hr: h?.hr ?? null };
}

/** A set as the heart rate per exercise reads it: its exercise in the workout and when it was ticked (unix seconds). */
export interface HrSet { weId: string; doneS: number | null }
/** The longest a set's time is taken to be (its rest before it and the set): a long break before it doesn't count. */
const MAX_SET_S = 10 * 60;
/**
 * Heart rate per exercise of a workout, from the workout's series. A set's time runs from the set ticked before it (any
 * exercise, so supersets split correctly; the first from the workout's start) to its own tick, at most MAX_SET_S: the
 * rest before a set and the set itself. An exercise's heart rate is every reading in its sets' times. Exercises whose
 * sets have no tick times fall back to the exercise's own start and end (`spans`), if it has them. A workout typed in
 * afterwards has every set ticked at the same moment, which says nothing about when each was done: its ticks are not used.
 */
export function exerciseHr(hr: unknown, startS: number, sets: HrSet[], spans: Map<string, [number, number]> = new Map()): { workoutExerciseId: string; avgHr: number; maxHr: number }[] {
  if (!Array.isArray(hr) || !hr.length) return [];
  const pts = (hr as [number, number][]).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  const windows = new Map<string, [number, number][]>();
  const add = (we: string, a: number, b: number) => (windows.get(we) ?? windows.set(we, []).get(we)!).push([a, b]);
  let prev = startS;
  const ticked = sets.filter((x) => x.doneS != null).sort((a, b) => a.doneS! - b.doneS!);
  const told = ticked.length < 2 || new Set(ticked.map((x) => x.doneS)).size > 1;
  for (const s of told ? ticked : []) {
    add(s.weId, Math.max(prev, s.doneS! - MAX_SET_S), s.doneS!);
    prev = Math.max(prev, s.doneS!);
  }
  for (const [we, [a, b]] of spans) if (!windows.has(we) && b > a) add(we, a, b);
  const out: { workoutExerciseId: string; avgHr: number; maxHr: number }[] = [];
  for (const [we, ws] of windows) {
    const mine = pts.filter((p) => ws.some(([a, b]) => p[0] > a && p[0] <= b));
    if (!mine.length) continue;
    out.push({ workoutExerciseId: we, avgHr: Math.round(mine.reduce((t, p) => t + p[1], 0) / mine.length), maxHr: Math.max(...mine.map((p) => p[1])) });
  }
  return out;
}
/** exerciseHr for each of these workouts that has a band's heart rate, by workout exercise id. Two queries for them all. */
export async function exerciseHrOf(q: Sql, workoutIds: string[]): Promise<Map<string, { avgHr: number; maxHr: number }>> {
  const out = new Map<string, { avgHr: number; maxHr: number }>();
  if (!workoutIds.length) return out;
  const ws = (await q.query("SELECT id, started_at, hr FROM workouts WHERE id = ANY($1::uuid[]) AND hr IS NOT NULL", [workoutIds])).rows;
  if (!ws.length) return out;
  const { rows } = await q.query(
    `SELECT we.workout_id, we.id AS we_id, we.started_at, we.ended_at, s.done_at FROM workout_exercises we
     LEFT JOIN workout_sets s ON s.workout_exercise_id = we.id AND s.done WHERE we.workout_id = ANY($1::uuid[])`, [ws.map((w: any) => w.id)]);
  const secs = (v: unknown) => (v == null ? null : new Date(v as string).getTime() / 1000);
  for (const w of ws) {
    const mine = rows.filter((r: any) => r.workout_id === w.id);
    const spans = new Map<string, [number, number]>();
    for (const r of mine) if (r.started_at && r.ended_at) spans.set(r.we_id, [secs(r.started_at)!, secs(r.ended_at)!]);
    const hr = typeof w.hr === "string" ? JSON.parse(w.hr) : w.hr;
    for (const x of exerciseHr(hr, secs(w.started_at)!, mine.filter((r: any) => r.done_at).map((r: any) => ({ weId: r.we_id, doneS: secs(r.done_at) })), spans))
      out.set(x.workoutExerciseId, { avgHr: x.avgHr, maxHr: x.maxHr });
  }
  return out;
}

/** The median of some numbers, null for none. */
const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const BASELINE_DAYS = 28, MIN_BASELINE = 7;
type Effect = "up" | "down" | "flat";
export interface ReadinessPart { key: "sleep" | "restingHr" | "hrv"; value: number; baseline: number; change: number; effect: Effect }
/**
 * How ready for training the body looks today, from last night's sleep, today's resting heart rate and HRV, each against
 * the person's own usual (the median of the 28 days before, with at least 7 of them). Kept simple so it can be explained:
 *   start at 70;
 *   sleep: +10 per hour more than usual, -10 per hour less, within -20..+10;
 *   resting heart rate: -2 per % above usual, +2 per % below, within -20..+10 (a raised resting rate: tired, ill, stressed);
 *   HRV: +0.5 per % above usual, -0.5 per % below, within -20..+10 (HRV swings a lot from day to day, so it counts less);
 *   clamped to 0-100. Ready from 75, Normal from 50, else Take it easy. No score with fewer than 2 parts.
 * change: sleep in minutes, resting heart rate and HRV in % (signed). effect: which way the part moves the score; flat
 * within a small margin (15 min of sleep, 3 % resting heart rate, 5 % HRV) that is everyday noise.
 */
export function readiness(parts: { key: ReadinessPart["key"]; value: number; history: number[] }[]): { score: number | null; label: "Ready" | "Normal" | "Take it easy" | null; parts: ReadinessPart[] } {
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  const out: ReadinessPart[] = [];
  let score = 70;
  for (const p of parts) {
    if (p.history.length < MIN_BASELINE) continue;
    const base = median(p.history)!;
    if (!base) continue;
    let change: number, pts: number, flat: boolean;
    if (p.key === "sleep") {
      change = Math.round((p.value - base) * 60);
      pts = clamp((change / 60) * 10, -20, 10);
      flat = Math.abs(change) < 15;
    } else {
      change = Math.round(((p.value - base) / base) * 1000) / 10;
      pts = p.key === "restingHr" ? clamp(-change * 2, -20, 10) : clamp(change * 0.5, -20, 10);
      flat = Math.abs(change) < (p.key === "restingHr" ? 3 : 5);
    }
    score += pts;
    out.push({ key: p.key, value: p.value, baseline: Math.round(base * 10) / 10, change, effect: flat ? "flat" : pts > 0 ? "up" : "down" });
  }
  if (out.length < 2) return { score: null, label: null, parts: out };
  const s = Math.round(clamp(score, 0, 100));
  return { score: s, label: s >= 75 ? "Ready" : s >= 50 ? "Normal" : "Take it easy", parts: out };
}

/** Whether the band's count for an activity is believable next to the app's own (null or 0: the app counted none). */
export function plausibleSteps(band: number, app: number | null) {
  // A band whose clock is off (after a reset, before Gadgetbridge sets its time again) files its steps under the wrong
  // minutes, so its count for this activity's time belongs to some other time. Where the app counted a fair number
  // itself, a band count far from it (under 0.4 or over 2.5 times) is taken as that, and the app's count stays.
  // With few or no steps of the app's own there is nothing to check against, and the band's count is the better one.
  if (app == null || app <= 200) return true;
  const r = band / app;
  return r >= 0.4 && r <= 2.5;
}

export function healthRoutes(r: Router) {
  r.post("/health/import", async (ctx, _p, b) => {
    const list = (v: unknown, max: number): any[] => (Array.isArray(v) ? v.slice(0, max) : []);
    const out = { steps: 0, sleep: 0, sleepNights: 0, restingHr: 0, spo2: 0, hrv: 0, distance: 0, activeKcal: 0, hydration: 0, vo2max: 0, weight: 0, bodyFat: 0, activities: 0, hrDays: 0 };
    let touched = false; // the log changed (a row noted or marked deleted), even when no number did

    const imps = new Map<string, Imp>((await ctx.q.query("SELECT key, kind, to_char(date, 'YYYY-MM-DD') AS date, ref, deleted_at IS NOT NULL AS deleted FROM health_imports")).rows
      .map((x: any) => [x.key, { kind: x.kind, date: x.date, ref: x.ref, deleted: x.deleted }]));
    // what the log's rows became, as it is now (missing: the person deleted it elsewhere in the app)
    const daily = new Map<string, string>((await ctx.q.query(`SELECT kind || ':' || to_char(date, 'YYYY-MM-DD') AS k, source FROM daily_logs WHERE kind IN ${DAILY_SQL}`)).rows
      .map((x: any) => [x.k, x.source]));
    const refs = [...imps.values()].filter((x) => !x.deleted && x.ref).map((x) => x.ref!);
    const alive = new Set<string>((await ctx.q.query("SELECT id::text AS id FROM body_metrics WHERE id::text = ANY($1) UNION ALL SELECT id::text FROM activities WHERE id::text = ANY($1)", [refs])).rows.map((x: any) => x.id));
    /** Whether to bring this key in: not when deleted from the log, nor when its data was deleted elsewhere (noted now). */
    const open = async (key: string, there: boolean) => {
      const h = imps.get(key);
      if (!h) return true;
      if (h.deleted) return false;
      if (there) return true;
      await forget(ctx, key);
      h.deleted = touched = true;
      return false;
    };

    // a typed value (source "manual", or null on rows from before sources) is never replaced
    const day = async (kind: Daily, date: unknown, value: number | null) => {
      const d = dateStr(date);
      if (!d || value == null) return false;
      const key = `${kind}:${d}`, dk = `${DAILY_KIND[kind]}:${d}`;
      if (!(await open(key, daily.has(dk)))) {
        // deleted, yet the phone's number is back: a copy that hadn't heard of the deletion synced it again
        if (imps.get(key)?.deleted && daily.get(dk) === HEALTH_SOURCE) await ctx.q.query("DELETE FROM daily_logs WHERE date = $1 AND kind = $2 AND source = $3", [d, DAILY_KIND[kind], HEALTH_SOURCE]);
        return false;
      }
      const { rows } = await ctx.q.query(
        `INSERT INTO daily_logs (user_id, date, kind, value, source) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, date, kind) DO UPDATE SET value = $4, source = $5
         WHERE daily_logs.source = $5 AND daily_logs.value <> $4 RETURNING 1`, [ctx.userId, d, DAILY_KIND[kind], value, HEALTH_SOURCE]);
      const known = imps.has(key);
      // noted when it came from the phone: now, or by an app from before the log (a typed day is not an import)
      if (rows.length || (!known && daily.get(dk) === HEALTH_SOURCE)) {
        await remember(ctx, key, kind, d, null);
        imps.set(key, { kind, date: d, ref: null, deleted: false });
        touched = true;
      }
      return rows.length > 0;
    };
    for (const e of list(b.steps, 400)) if (await day("steps", e?.date, intOrNull(e?.value, 0, 1e6))) out.steps++;
    for (const e of list(b.sleep, 400)) {
      const h = numOrNull(e?.hours, 0, 24);
      if (await day("sleep", e?.date, h == null ? null : Math.round(h * 10) / 10)) out.sleep++;
    }
    for (const [field, kind] of [["restingHr", "resting_hr"], ["spo2", "spo2"], ["hrv", "hrv"], ["distance", "distance"], ["activeKcal", "active_kcal"], ["vo2max", "vo2max"]] as const)
      for (const e of list(b[field], 400)) if (await day(kind, e?.date, lenient(kind, e?.value))) out[field]++;
    for (const e of list(b.hydration, 400)) if (await day("water", e?.date, lenient("water", e?.ml))) out.hydration++;

    // nights: after the daily sleep, whose key they share
    const sleepDays = new Set(list(b.sleep, 400).map((e) => e?.date));
    for (const n of list(b.sleepNights, 400).map(readNight)) {
      if (!n) continue;
      const key = `sleep:${n.date}`;
      // a night without the day's hours alongside: its asleep time is the day's sleep (a typed day stays as it is)
      if (!sleepDays.has(n.date)) await day("sleep", n.date, Math.round(n.asleep / 6) / 10);
      if (imps.get(key)?.deleted) continue; // its night is cleared below
      if (!imps.has(key)) {
        // the day's sleep is typed, so day() noted nothing: the night still came in, and is noted so a deletion sticks
        const typed = (await ctx.q.query("SELECT 1 FROM daily_logs WHERE date = $1 AND kind = 'sleep_h'", [n.date])).rows.length > 0;
        if (!typed) continue;
        await remember(ctx, key, "sleep", n.date, null);
        imps.set(key, { kind: "sleep", date: n.date, ref: null, deleted: false });
        touched = true;
      }
      const { rows } = await ctx.q.query(UPSERT_NIGHT, [ctx.userId, n.date, n.start, n.end, n.asleep, n.awake, n.light, n.deep, n.rem,
        n.avgHr, n.minHr, n.hr && JSON.stringify(n.hr), n.avgSpo2, n.minSpo2, n.respRate, HEALTH_SOURCE]);
      if (rows.length) out.sleepNights++;
    }
    // a night whose day was deleted (here, or on a copy whose deletion synced in) goes too
    if ((await ctx.q.query("DELETE FROM sleep_nights n USING health_imports h WHERE h.kind = 'sleep' AND h.deleted_at IS NOT NULL AND h.date = n.date RETURNING 1")).rows.length) touched = true;

    // weight and body fat readings, each into the body log once
    const reading = async (kind: Body, e: any, value: number | null) => {
      if (value == null || !e?.at) return false;
      const at = isoTime(e.at);
      const id = e.id != null ? str(String(e.id), 100) : "";
      // an app without record ids keys a reading by its time; with ids, that older key still counts as the same reading
      const key = id ? `${kind}:${id}` : `${kind}:${at}`, legacy = imps.get(`${kind}:${at}`);
      const h = imps.get(key);
      if (!(await open(key, !!h?.ref && alive.has(h.ref))) || h) return false;
      if (id && legacy?.deleted) return false;
      const same = (await ctx.q.query("SELECT id::text AS id FROM body_metrics WHERE kind = $2 AND measured_at BETWEEN $1::timestamptz - interval '1 minute' AND $1::timestamptz + interval '1 minute' LIMIT 1", [at, kind])).rows[0];
      let ref: string | null = same?.id ?? null, added = false;
      if (ref) {
        // already in the log under another key (sent without an id before): one entry per reading
        if ([...imps.values()].some((x) => x.ref === ref && !x.deleted)) return false;
      } else {
        ref = uuidv7();
        await ctx.q.query("INSERT INTO body_metrics (id, user_id, kind, value, measured_at) VALUES ($1,$2,$3,$4,$5)", [ref, ctx.userId, kind, value, at]);
        added = true;
      }
      await remember(ctx, key, kind, null, ref);
      imps.set(key, { kind, date: null, ref, deleted: false });
      alive.add(ref);
      touched = true;
      return added;
    };
    for (const e of list(b.weight, 1000)) if (await reading("weight", e, lenientBody("weight", e?.kg))) out.weight++;
    for (const e of list(b.bodyFat, 1000)) if (await reading("body_fat", e, lenientBody("body_fat", e?.pct))) out.bodyFat++;

    const sessions = list(b.sessions, 500).filter((s) => s?.id && s?.start && s?.end);
    if (sessions.length) await ensureTypes(ctx);
    for (const s of sessions) {
      const hcId = str(String(s.id), 70), key = `activity:${hcId}`, clientId = `hc:${hcId}`;
      const h = imps.get(key);
      if (!(await open(key, !!h?.ref && alive.has(h.ref))) || h) continue;
      // brought in before the log existed: noted, not added again
      let ref: string | null = (await ctx.q.query("SELECT id::text AS id FROM activities WHERE client_id = $1", [clientId])).rows[0]?.id ?? null;
      if (!ref) {
        const type = str(s.type, 40) || "other";
        const known = (await ctx.q.query("SELECT 1 FROM activity_types WHERE slug = $1", [type])).rows.length > 0;
        ref = await saveActivity(ctx, {
          type: known ? type : "other", name: str(s.title, 120), startedAt: s.start, endedAt: s.end,
          distanceM: s.distanceM, steps: s.steps, avgHr: s.avgHr, calories: s.calories, source: HEALTH_SOURCE, clientId,
        });
        out.activities++;
      }
      await remember(ctx, key, "activity", null, ref);
      imps.set(key, { kind: "activity", date: null, ref, deleted: false });
      touched = true;
    }

    // a day's heart rate: written again each time (not in the import log), counted when it changed
    for (const e of list(b.hrDays, 400)) {
      const d = readHrDay(e);
      if (!d) continue;
      const { rows } = await ctx.q.query(
        `INSERT INTO hr_days (user_id, date, min_hr, max_hr, avg_hr, hr) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id, date) DO UPDATE SET min_hr = EXCLUDED.min_hr, max_hr = EXCLUDED.max_hr, avg_hr = EXCLUDED.avg_hr, hr = EXCLUDED.hr
         WHERE (hr_days.min_hr, hr_days.max_hr, hr_days.avg_hr, hr_days.hr) IS DISTINCT FROM (EXCLUDED.min_hr, EXCLUDED.max_hr, EXCLUDED.avg_hr, EXCLUDED.hr)
         RETURNING 1`, [ctx.userId, d.date, d.min, d.max, d.avg, d.hr && JSON.stringify(d.hr)]);
      if (rows.length) out.hrDays++;
    }

    if (touched || Object.values(out).some((n) => n > 0)) ctx.changed("health");
    return out;
  });

  // Activities recorded and workouts done in Motus that the band may have more for: its steps (a type that counts steps,
  // not yet from the band nor typed later) or heart rate. The phone reads Health Connect for each time and answers below.
  // Sessions that came from Health Connect itself already have what the band had.
  r.get("/health/ranges", async (ctx, _p, _b, qs) => {
    const from = isoTime(qs.from, new Date(ctx.now().getTime() - 30 * 86400000).toISOString());
    const { rows } = await ctx.q.query(
      `SELECT * FROM (
         SELECT 'activity' AS kind, a.id, a.started_at, a.ended_at FROM activities a LEFT JOIN activity_types t ON t.slug = a.type
          WHERE a.source <> $2 AND a.ended_at IS NOT NULL AND a.started_at >= $1
            AND (a.hr IS NULL OR (a.steps_source IS NULL AND coalesce(t.has_steps, a.type IN ('walk', 'run', 'hike'))
              -- a count typed when the walk was logged by hand is the person's: the band's never replaces it
              AND NOT (a.source = 'manual' AND a.steps IS NOT NULL)))
         UNION ALL
         SELECT 'workout', w.id, w.started_at, w.ended_at FROM workouts w
          WHERE w.status = 'completed' AND w.ended_at IS NOT NULL AND w.started_at >= $1 AND w.hr IS NULL
       ) x ORDER BY started_at DESC LIMIT 200`, [from, HEALTH_SOURCE]);
    const iso = (v: unknown) => new Date(v as string).toISOString();
    return { ranges: rows.map((x: any) => ({ kind: x.kind as "activity" | "workout", id: x.id as string, start: iso(x.started_at), end: iso(x.ended_at) })) };
  });

  // What the band had for those times. steps only counts when covered: the band's data spans the whole activity, so its
  // count is for exactly that time (a band that synced half of it would undercount).
  r.post("/health/ranges", async (ctx, _p, b) => {
    const out = { steps: 0, hr: 0 };
    let acts = false, works = false;
    for (const e of (Array.isArray(b.results) ? b.results : []).slice(0, 200)) {
      if (!e || (e.kind !== "activity" && e.kind !== "workout") || !isUuid(e.id)) throw bad("Invalid result");
      const steps = e.steps == null ? null : intOrNull(e.steps, 0, 1e7);
      if (e.kind === "workout") {
        const w = (await ctx.q.query("SELECT started_at, ended_at FROM workouts WHERE id = $1 AND status = 'completed'", [e.id])).rows[0];
        const h = w?.ended_at ? heartRate(e.hr, new Date(w.started_at).getTime() / 1000, new Date(w.ended_at).getTime() / 1000) : null;
        if (!h) continue;
        // an average typed in stays; the band's only fills an empty one
        await ctx.q.query("UPDATE workouts SET hr = $2, max_hr = $3, avg_hr = coalesce(avg_hr, $4), updated_at = $5 WHERE id = $1",
          [e.id, JSON.stringify(h.hr), h.max, h.avg, ctx.now().toISOString()]);
        out.hr++; works = true;
        continue;
      }
      const a = (await ctx.q.query(
        `SELECT a.started_at, a.ended_at, a.source, a.steps, a.steps_source, a.steps_app, coalesce(t.has_steps, a.type IN ('walk', 'run', 'hike')) AS counts
         FROM activities a LEFT JOIN activity_types t ON t.slug = a.type WHERE a.id = $1`, [e.id])).rows[0];
      if (!a?.ended_at) continue;
      // never over a count the person typed: changed by hand later ('manual'), or typed when the walk was logged by hand
      const typed = a.steps_source === "manual" || (a.steps_source == null && a.source === "manual" && a.steps != null);
      // the app's own count: kept aside once the band's replaced it
      const app: number | null = a.steps_source === "band" ? a.steps_app : (a.steps_app ?? a.steps);
      if (e.covered === true && steps != null && steps > 0 && a.counts && !typed && !(a.steps_source === "band" && a.steps === steps) && plausibleSteps(steps, app)) {
        await ctx.q.query("UPDATE activities SET steps_app = $2, steps = $3, steps_source = 'band' WHERE id = $1", [e.id, app, steps]);
        out.steps++; acts = true;
      }
      const h = heartRate(e.hr, new Date(a.started_at).getTime() / 1000, new Date(a.ended_at).getTime() / 1000);
      if (h) {
        await ctx.q.query("UPDATE activities SET hr = $2, max_hr = $3, avg_hr = coalesce(avg_hr, $4) WHERE id = $1", [e.id, JSON.stringify(h.hr), h.max, h.avg]);
        out.hr++; acts = true;
      }
    }
    if (acts || works) ctx.changed("health", ...(acts ? ["activity"] as const : []), ...(works ? ["workout"] as const : []));
    return out;
  });

  // Nights of sleep, newest first. Shown only while the day's sleep is there: not once its import is deleted, nor when
  // the day's sleep was cleared elsewhere (the next sync notes that as a deletion). edited/sleepH: the day's own number.
  const nights = async (ctx: Ctx, where: string, args: unknown[], withHr: boolean) => (await ctx.q.query(
    `SELECT to_char(n.date, 'YYYY-MM-DD') AS date, n.start_at, n.end_at, n.asleep_min, n.awake_min, n.light_min, n.deep_min, n.rem_min,
       n.avg_hr, n.min_hr, n.avg_spo2, n.min_spo2, n.resp_rate, d.value AS sleep_h, d.source AS d_source ${withHr ? ", n.hr" : ""}
     FROM sleep_nights n JOIN daily_logs d ON d.user_id = n.user_id AND d.date = n.date AND d.kind = 'sleep_h'
     WHERE ${where} AND NOT EXISTS (SELECT 1 FROM health_imports h WHERE h.key = 'sleep:' || to_char(n.date, 'YYYY-MM-DD') AND h.deleted_at IS NOT NULL)
     ORDER BY n.date DESC LIMIT 400`, args)).rows.map((x: any) => {
    const num = (v: unknown) => (v == null ? null : Number(v));
    return {
      date: x.date as string, startAt: new Date(x.start_at).toISOString(), endAt: new Date(x.end_at).toISOString(),
      asleepMin: x.asleep_min as number, awakeMin: x.awake_min as number, lightMin: x.light_min as number | null, deepMin: x.deep_min as number | null, remMin: x.rem_min as number | null,
      avgHr: x.avg_hr as number | null, minHr: x.min_hr as number | null, avgSpo2: num(x.avg_spo2), minSpo2: num(x.min_spo2), respRate: num(x.resp_rate),
      edited: x.d_source !== HEALTH_SOURCE, sleepH: Number(x.sleep_h),
      ...(withHr ? { hr: (x.hr ?? null) as [number, number][] | null } : {}),
    };
  });
  r.get("/health/sleep", async (ctx, _p, _b, qs) => {
    const from = dateStr(qs.from) ?? "1970-01-01", to = dateStr(qs.to);
    return { nights: await nights(ctx, to ? "n.date >= $1::date AND n.date < $2::date" : "n.date >= $1::date", to ? [from, to] : [from], false) };
  });
  r.get("/health/sleep/:date", async (ctx, p) => {
    const night = (await nights(ctx, "n.date = $1::date", [dateStr(p.date)], true))[0];
    if (!night) throw notFound("No night for this day");
    return night;
  });

  // Which kinds of band data this person has at all, so screens only offer what there is to show
  r.get("/health/available", async (ctx) => {
    const { rows } = await ctx.q.query(`SELECT
      EXISTS (SELECT 1 FROM sleep_nights) OR EXISTS (SELECT 1 FROM daily_logs WHERE kind = 'sleep_h' AND source = $1) AS sleep,
      EXISTS (SELECT 1 FROM daily_logs WHERE kind IN ('resting_hr', 'spo2', 'hrv'))
        OR EXISTS (SELECT 1 FROM activities WHERE hr IS NOT NULL OR (source = $1 AND avg_hr IS NOT NULL))
        OR EXISTS (SELECT 1 FROM workouts WHERE hr IS NOT NULL) OR EXISTS (SELECT 1 FROM hr_days) AS heart,
      EXISTS (SELECT 1 FROM daily_logs WHERE kind = 'distance_m') AS distance,
      EXISTS (SELECT 1 FROM daily_logs WHERE kind = 'active_kcal') AS calories,
      EXISTS (SELECT 1 FROM daily_logs WHERE kind = 'vo2max') AS vo2max,
      EXISTS (SELECT 1 FROM hr_days) AS hr_day,
      EXISTS (SELECT 1 FROM health_imports h JOIN body_metrics b ON b.id::text = h.ref WHERE h.kind = 'body_fat' AND h.deleted_at IS NULL) AS body_fat,
      EXISTS (SELECT 1 FROM daily_logs WHERE kind = 'water_ml' AND source = $1) AS hydration`, [HEALTH_SOURCE]);
    const x = rows[0] as any;
    return {
      sleep: !!x.sleep, heart: !!x.heart, distance: !!x.distance, calories: !!x.calories,
      vo2max: !!x.vo2max, hrDay: !!x.hr_day, bodyFat: !!x.body_fat, hydration: !!x.hydration,
    };
  });

  // Everything the band had for one day, for Home, the calendar and a day's view. null where there is nothing.
  // tz: the app's calendar, for the day's steps (recorded activities count in, as on Home)
  r.get("/health/day/:date", async (ctx, p, _b, qs) => {
    const d = dateStr(p.date);
    if (!d) throw bad("Pick a day");
    const sleep = (await nights(ctx, "n.date = $1::date", [d], false))[0] ?? null;
    const h = (await ctx.q.query("SELECT min_hr, max_hr, avg_hr, hr FROM hr_days WHERE date = $1::date", [d])).rows[0] as any;
    const vals = new Map<string, number>((await ctx.q.query("SELECT kind, value FROM daily_logs WHERE date = $1::date AND kind <> 'steps'", [d])).rows
      .map((x: any) => [x.kind, Number(x.value)]));
    const next = new Date(Date.parse(d + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
    const steps = (await stepsByDay(ctx.q, d, next, tzOf(qs)))[0]?.value ?? null;
    const v = (k: string) => vals.get(k) ?? null;
    return {
      date: d, sleep,
      hr: h ? { min: h.min_hr as number | null, max: h.max_hr as number | null, avg: h.avg_hr as number | null, series: (h.hr ?? null) as [number, number][] | null } : null,
      restingHr: v("resting_hr"), hrv: v("hrv"), spo2: v("spo2"), vo2max: v("vo2max"), steps,
      distanceM: v("distance_m"), activeKcal: v("active_kcal"), waterMl: v("water_ml"),
    };
  });

  // Today's readiness (readiness() says how it is worked out). Each part is today's value, else yesterday's (a band that
  // hasn't synced today yet), against the 28 days before it. tz: the app's calendar
  r.get("/health/readiness", async (ctx, _p, _b, qs) => {
    const today = dayIn(ctx.now(), tzOf(qs));
    const shift = (day: string, n: number) => new Date(Date.parse(day + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
    const { rows } = await ctx.q.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, kind, value FROM daily_logs
       WHERE kind IN ('sleep_h', 'resting_hr', 'hrv') AND date >= $1::date AND date <= $2::date`, [shift(today, -BASELINE_DAYS - 1), today]);
    const parts = ([["sleep", "sleep_h"], ["restingHr", "resting_hr"], ["hrv", "hrv"]] as const).flatMap(([key, kind]) => {
      const mine = rows.filter((x: any) => x.kind === kind).map((x: any) => ({ date: x.date as string, value: Number(x.value) }));
      const now = mine.find((x) => x.date === today) ?? mine.find((x) => x.date === shift(today, -1));
      if (!now || !(now.value > 0)) return [];
      const from = shift(now.date, -BASELINE_DAYS);
      return [{ key, value: now.value, history: mine.filter((x) => x.date >= from && x.date < now.date && x.value > 0).map((x) => x.value) }];
    });
    return { ...readiness(parts), date: today };
  });

  // The import log, newest first. A day's numbers (steps, sleep, resting heart rate, SpO2, HRV, distance, active calories) sort at the end of their day, above that day's readings.
  r.get("/health/imports", async (ctx, _p, _b, qs) => {
    const limit = intOrNull(qs.limit, 1, 200) ?? 50;
    const tz = tzOf(qs);
    // the cursor is the last entry shown: its sort time (as the database wrote it) and its key
    const before = str(qs.before, 300), cut = before.indexOf("|");
    const cAt = cut > 0 ? before.slice(0, cut) : "", cKey = cut > 0 ? before.slice(cut + 1) : "";
    const after = /^\d{4}-\d\d-\d\d[ T][\d:.]+(Z|[+-]\d\d(:?\d\d)?)?$/.test(cAt) && !!cKey;
    const { rows } = await ctx.q.query(`
      SELECT *, sort_at::text AS sort_text FROM (
        SELECT h.key, h.kind, h.ref, h.imported_at,
          d.value AS d_value, d.source AS d_source, bm.value AS w_value, bm.measured_at,
          a.id AS a_id, a.type AS a_type, a.name AS a_name, a.started_at, a.duration_s, a.distance_m, a.steps AS a_steps, a.avg_hr,
          to_char(coalesce(h.date, (coalesce(bm.measured_at, a.started_at) AT TIME ZONE 'UTC' - $1::float8 * interval '1 minute')::date), 'YYYY-MM-DD') AS day,
          coalesce(bm.measured_at, a.started_at, ((h.date + 1)::timestamp AT TIME ZONE 'UTC') + $1::float8 * interval '1 minute' - interval '1 millisecond') AS sort_at
        FROM health_imports h
        LEFT JOIN daily_logs d ON h.kind NOT IN ('weight', 'body_fat', 'activity') AND d.user_id = h.user_id AND d.date = h.date
          AND d.kind = ${DAILY_CASE}
        LEFT JOIN body_metrics bm ON h.kind IN ('weight', 'body_fat') AND bm.id::text = h.ref
        LEFT JOIN activities a ON h.kind = 'activity' AND a.id::text = h.ref
        WHERE h.deleted_at IS NULL AND (d.date IS NOT NULL OR bm.id IS NOT NULL OR a.id IS NOT NULL)
      ) x ${after ? "WHERE (sort_at, key) < ($2::timestamptz, $3::text)" : ""}
      ORDER BY sort_at DESC, key DESC LIMIT ${limit + 1}`, after ? [tz, cAt, cKey] : [tz]);
    const page = rows.slice(0, limit);
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    const num = (v: unknown) => (v == null ? null : Number(v));
    const items = page.map((x: any) => ({
      key: x.key as string, kind: x.kind as Kind, date: x.day as string,
      at: iso(x.measured_at ?? x.started_at),
      value: x.kind === "activity" ? null : num(isBody(x.kind) ? x.w_value : x.d_value),
      activity: x.a_id ? { id: x.a_id, type: x.a_type, name: x.a_name ?? "", startedAt: iso(x.started_at), durationS: num(x.duration_s), distanceM: num(x.distance_m), steps: num(x.a_steps), avgHr: num(x.avg_hr) } : null,
      ref: x.ref as string | null,
      // a day's number changed by hand since (it then stays as typed); a reading or session can't tell
      edited: isDaily(x.kind) ? x.d_source !== HEALTH_SOURCE : false,
      importedAt: iso(x.imported_at),
    }));
    const last: any = rows.length > limit ? page.at(-1) : null;
    return { items, cursor: last ? `${last.sort_text}|${last.key}` : null };
  });

  // a day's number (steps, sleep, resting heart rate, SpO2, HRV, water, VO2 max...) set by hand from the log is typed
  // ("manual"): later syncs keep it; a weight or body fat reading is corrected in place
  r.put("/health/imports/:key", async (ctx, p, b) => {
    const h = await entry(ctx, p.key!);
    if (!h || !h.there) throw notFound("This import is gone");
    if (h.kind === "activity") throw bad("Edit the activity itself");
    if (isDaily(h.kind)) {
      const v = dailyValue(h.kind, b.value);
      if (v == null) throw bad("Enter a value");
      await ctx.q.query(
        `INSERT INTO daily_logs (user_id, date, kind, value, source) VALUES ($1,$2,$3,$4,'manual') ON CONFLICT (user_id, date, kind) DO UPDATE SET value = $4, source = 'manual'`,
        [ctx.userId, h.date, DAILY_KIND[h.kind], v]);
    } else {
      const v = bodyValue(h.kind as Body, b.value);
      if (v == null) throw bad("Enter a value");
      await ctx.q.query("UPDATE body_metrics SET value = $2 WHERE id::text = $1", [h.ref, v]);
    }
    ctx.changed("health");
    return { ok: true };
  });

  // deletes what it became and keeps the key, marked deleted, so the next sync doesn't bring it back
  r.del("/health/imports/:key", async (ctx, p) => {
    const h = await entry(ctx, p.key!);
    if (!h) throw notFound("This import is gone");
    if (isDaily(h.kind)) await ctx.q.query("DELETE FROM daily_logs WHERE date = $1 AND kind = $2", [h.date, DAILY_KIND[h.kind]]);
    // a day's sleep takes its night's detail with it
    if (h.kind === "sleep") await ctx.q.query("DELETE FROM sleep_nights WHERE date = $1", [h.date]);
    else if (!isDaily(h.kind)) await ctx.q.query(`DELETE FROM ${isBody(h.kind) ? "body_metrics" : "activities"} WHERE id::text = $1`, [h.ref]);
    await forget(ctx, p.key!);
    ctx.changed("health");
    return { ok: true };
  });
}
