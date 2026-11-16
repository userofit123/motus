// Health Connect (Android): what other apps on the phone recorded (a band through Gadgetbridge, a scale, a watch) comes
// in here. The Android app reads Health Connect and sends one batch; the engine decides what to keep, so the rules hold
// for a local account and for a server account's copy on the phone alike.
// - Daily steps and sleep go into the daily log as the day's synced value (039), always, also beside a value typed in by
//   hand, which the day keeps using until the person chooses the synced one: the person's own number wins over a
//   device's by default (as for steps, PLAN.md decision M-155). The same for a band's daily resting heart rate, SpO2 and
//   HRV (028), daily distance (metres) and active calories (029), water (ml) and VO2 max (030).
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
// sticks: from the log, or of the data itself anywhere else in the app (marked at that moment, 034), the key is never
// imported again, and the database never keeps a day's number from Health Connect or a night under a deleted key (031),
// also when a copy that hadn't heard of the deletion syncs it back.
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { dateStr, isoTime, numOrNull, intOrNull, str, tzOf } from "../util";
import { uuidv7, isUuid } from "../ids";
import { bad, notFound } from "../errors";
import { ensureTypes, saveActivity, stepsByDay, setTyped } from "./activities";
import { dayIn } from "./achievements";
import { isSum, DERIVED_DAYS, shift, lockRecords, loadReads, loadBlocks, appKinds, dayBlocks, derivedDays, sleepBlocks, sleepFrom, spanBlocks, spanFrom,
  type DerivedType, type SpanBand, type SumType } from "./healthDerive";
import { isNight, cleanWornDevice, plausibleSteps, stepsTyped, appSteps, bandStepsVerdict, daySteps, type WornDevice } from "@motus/shared";
import { maxHeartRate, sessionLoad, loadTrend, CHRONIC_DAYS, exercisePeaks, type LoadTrend, type HrTick } from "@motus/shared";
import { SCORE_DAYS, ageOf, scoresFor, effortMinutes, sleepScore, activityScore, strengthScore, muscleSets } from "@motus/shared";
import { getSettings } from "./settings";
import { motusRecordFor, copyFigures, linkBandSessions, linkHistory, release, releaseDangling, type Copied } from "./bandMatch";
import { SET_COUNT_SQL, VOLUME_SQL } from "./workouts";

export const HEALTH_SOURCE = "health_connect";
// a band's number for an activity's time: a measure that can't be (below 0, absurdly large, not a number) is left out
// rather than failing the whole read
const bandNum = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
// an activity's band data has settled: it has synced by then, or never will (the app uses the same 3 days)
const SETTLED_MS = 3 * 86400000;

// The average to keep when new band readings come in: one typed in stays; the band's own (the one its earlier readings
// gave, within rounding of the thinned series) follows as more of them arrive
function bandAvg(stored: unknown, avg: unknown, next: number): number {
  const had = Array.isArray(stored) && stored.length ? stored.reduce((t: number, p: [number, number]) => t + Number(p[1]), 0) / stored.length : null;
  return avg != null && !(had != null && Math.abs(Number(avg) - had) <= 1) ? Number(avg) : next;
}
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
/** The daily log's kind for an import log row's kind, in SQL (h: health_imports). */
const DAILY_CASE = `CASE h.kind ${Object.entries(DAILY_KIND).map(([i, d]) => `WHEN '${i}' THEN '${d}'`).join(" ")} END`;
interface Imp { kind: Kind; date: string | null; ref: string | null; deleted: boolean; apart?: boolean; linked?: string | null }

/**
 * Notes a key in the import log. A session's entry also keeps its time (span, 046: kept after a deletion, so the same
 * session from a second app stays out too) and, when it is a workout or activity recorded in Motus, which (linked, bandMatch).
 * deleted: noted as deleted at once (the same session as one the person deleted).
 */
const remember = (ctx: Ctx, key: string, kind: Kind, date: string | null, ref: string | null,
  o: { linked?: "activity" | "workout" | null; span?: [string, string]; deleted?: boolean; copied?: Copied | null } = {}) => ctx.q.query(
  `INSERT INTO health_imports (user_id, key, kind, date, ref, linked, span_start, span_end, deleted_at, copied)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $9::boolean THEN now() END,$10::jsonb)
   ON CONFLICT (user_id, key) DO UPDATE SET imported_at = now(), ref = EXCLUDED.ref, linked = EXCLUDED.linked, copied = EXCLUDED.copied,
     span_start = coalesce(EXCLUDED.span_start, health_imports.span_start), span_end = coalesce(EXCLUDED.span_end, health_imports.span_end),
     -- linked: in, so no longer a restore waiting for the next read (the deleted list checks the activity, not a workout)
     restored_at = CASE WHEN EXCLUDED.linked IS NOT NULL THEN NULL ELSE health_imports.restored_at END
   WHERE health_imports.deleted_at IS NULL`,
  [ctx.userId, key, kind, date, ref, o.linked ?? null, o.span?.[0] ?? null, o.span?.[1] ?? null, !!o.deleted, o.copied ? JSON.stringify(o.copied) : null]);
const forget = (ctx: Ctx, key: string) => ctx.q.query("UPDATE health_imports SET deleted_at = now() WHERE key = $1 AND deleted_at IS NULL", [key]);

/** One entry of the log with what it is now: null when it is deleted, or its data was deleted elsewhere. */
async function entry(ctx: Ctx, key: string) {
  const h = (await ctx.q.query("SELECT kind, to_char(date, 'YYYY-MM-DD') AS date, ref, linked FROM health_imports WHERE key = $1 AND deleted_at IS NULL", [key])).rows[0] as
    { kind: Kind; date: string | null; ref: string | null; linked: "activity" | "workout" | null } | undefined;
  if (!h) return null;
  const there = isDaily(h.kind)
    ? (await ctx.q.query("SELECT 1 FROM daily_logs WHERE date = $1 AND kind = $2", [h.date, DAILY_KIND[h.kind]])).rows.length > 0
    : (await ctx.q.query(`SELECT 1 FROM ${isBody(h.kind) ? "body_metrics" : h.linked === "workout" ? "workouts" : "activities"} WHERE id::text = $1`, [h.ref])).rows.length > 0;
  return { ...h, there };
}

/** The most heart rate points kept per activity or workout: enough for a chart, small enough to sync. */
const HR_POINTS = 600;
/**
 * A band's heart rate for one activity or workout: [unix seconds, bpm] pairs inside its time (a minute either side, for
 * clocks a little apart), sorted, at most HR_POINTS (averaged in even runs, so a long session keeps its shape).
 * Average and max come from every reading, before thinning. Readings out of 25-250 bpm are glitches and left out.
 * least: the fewest readings that count; an activity takes one (a band may measure only every 10 minutes, so a short walk
 * can hold a single reading, and it is still the heart rate then).
 */
export function heartRate(v: unknown, startS: number, endS: number, points = HR_POINTS, least = 2): { hr: [number, number][]; avg: number; max: number; min: number } | null {
  if (!Array.isArray(v)) return null;
  const pts = new Map<number, number>();
  for (const p of v.slice(0, 100000)) {
    if (!Array.isArray(p)) continue;
    const t = Number(p[0]), b = Number(p[1]);
    if (!Number.isFinite(t) || !Number.isFinite(b) || b < 25 || b > 250 || t < startS - 60 || t > endS + 60) continue;
    pts.set(Math.round(t), Math.round(b));
  }
  const all = [...pts].sort((a, b) => a[0] - b[0]);
  if (all.length < Math.max(1, least)) return null;
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
export type HrSet = HrTick;
/** Heart rate per exercise of a workout, from the workout's series: shared exercisePeaks (the workout's page counts the same way). */
export function exerciseHr(hr: unknown, startS: number, sets: HrSet[], spans: Map<string, [number, number]> = new Map()): { workoutExerciseId: string; avgHr: number; maxHr: number }[] {
  if (!Array.isArray(hr) || !hr.length) return [];
  const pts = (hr as [number, number][]).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  return [...exercisePeaks(pts, sets, startS, spans)].map(([workoutExerciseId, x]) => ({ workoutExerciseId, ...x }));
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

export interface LoadSession { kind: "workout" | "activity"; id: string; name: string | null; type: string | null; date: string; load: number; hr: boolean }
/**
 * Training load (@motus/shared sessionLoad, loadTrend) of every finished workout and activity on the days [from, to],
 * plus the 28 days before `from` so the last day's 4-week comparison is whole. Off (null) while the Training load
 * feature is. hr: whether the session's heart rate counted (a band was worn and a max heart rate is known).
 */
export async function trainingLoad(ctx: Ctx, from: string, to: string, tz: number): Promise<{ sessions: LoadSession[]; trend: LoadTrend; maxHr: boolean } | null> {
  const st = await getSettings(ctx.q, ctx.userId);
  if (!st.features.trainingLoad) return null;
  const max = maxHeartRate(st.profile ?? {}, ctx.now())?.bpm ?? null;
  // a day either side of the range: the app's calendar day of a session can fall on the UTC day before or after
  const lo = shift(from, -CHRONIC_DAYS - 1), hi = shift(to, 2);
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as [number, number][] | null;
  const ws = (await ctx.q.query<{ id: string; name: string | null; started_at: string; hr: unknown; sets: number }>(
    `SELECT w.id, w.name, w.started_at, w.hr, (SELECT count(*) FROM workout_exercises we JOIN workout_sets s ON s.workout_exercise_id = we.id
       AND s.done AND s.kind <> 'warmup' WHERE we.workout_id = w.id)::int AS sets
     FROM workouts w WHERE w.status = 'completed' AND w.started_at >= $1::date AND w.started_at < $2::date`, [lo, hi])).rows;
  const as = (await ctx.q.query<{ id: string; type: string; name: string | null; started_at: string; duration_s: number | string | null; hr: unknown }>(
    "SELECT id, type, name, started_at, duration_s, hr FROM activities WHERE started_at >= $1::date AND started_at < $2::date", [lo, hi])).rows;
  const all: LoadSession[] = [];
  for (const w of ws) {
    const hr = parse(w.hr), load = sessionLoad({ hr, maxHr: max, sets: w.sets });
    all.push({ kind: "workout", id: w.id, name: w.name ?? null, type: null, date: dayIn(w.started_at, tz), load, hr: !!(hr?.length && max) });
  }
  for (const a of as) {
    const hr = parse(a.hr), load = sessionLoad({ hr, maxHr: max, minutes: (Number(a.duration_s) || 0) / 60 });
    all.push({ kind: "activity", id: a.id, name: a.name ?? null, type: a.type, date: dayIn(a.started_at, tz), load, hr: !!(hr?.length && max) });
  }
  // the 4 weeks need 3 weeks since the first session ever (not just the first loaded) before they say what's usual
  // (the first instant, then its day on the app's calendar like the sessions' days, not the UTC day)
  const firstAt = (await ctx.q.query<{ at: string | Date | null }>(
    `SELECT min(at) AS at FROM (SELECT min(started_at) AS at FROM workouts WHERE status = 'completed'
     UNION ALL SELECT min(started_at) FROM activities) x`)).rows[0]?.at ?? null;
  const first = firstAt ? dayIn(firstAt, tz) : null;
  const sessions = all.filter((x) => x.date >= shift(from, -CHRONIC_DAYS) && x.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  return { sessions, trend: loadTrend(sessions, to, first), maxHr: max != null };
}

/** The median of some numbers, null for none. */
const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const BASELINE_DAYS = 28, MIN_BASELINE = 7;
type Effect = "up" | "down" | "flat";
export interface ReadinessPart { key: "sleep" | "restingHr" | "hrv" | "load"; value: number; baseline: number; change: number; effect: Effect; ago?: 1 }
type BodyKey = Exclude<ReadinessPart["key"], "load">;
// the one line that says why, cause then advice: what each part that raised or lowered the score did, then what the
// label advises. Short enough for two lines on a phone (about 110 characters): no "than usual", which the block's
// "Vs your usual" already says. Each cause says its own time where the line mixes periods: sleep names its night
// ("last night", or "the night before last" when that is the newest night the score used), the load its 7 days; the
// resting heart rate and HRV are the day's, which their rows below give ("today", or "yesterday").
const WHY: Record<ReadinessPart["key"], { up: string; down: string }> = {
  sleep: { up: "you slept more last night", down: "you slept less last night" },
  // the heart's parts by what they mean, not which way the number went: a lower resting heart rate is the good one and
  // a higher HRV is, which a non-expert can't tell from "down"/"up"; the same two words for both so "but" reads plainly
  restingHr: { up: "your resting heart rate looks rested", down: "your resting heart rate looks tired" },
  hrv: { up: "your HRV looks rested", down: "your HRV looks tired" },
  load: { up: "you trained less in the last 7 days", down: "you trained more in the last 7 days" },
};
// the parts a calm day names, so the line never claims a part the score left out (e.g. a night too short to count)
const NAME: Record<ReadinessPart["key"], string> = { sleep: "sleep", restingHr: "resting heart rate", hrv: "HRV", load: "training" };
const ADVICE = { Ready: "a good day to train hard", Normal: "train as planned", "Take it easy": "train lightly today" } as const;
// Normal when everything named pulled the score down: "train as planned" would contradict the reasons before it
const NORMAL_DOWN = "train moderately today";
export interface ReadinessBuilding { key: BodyKey; value: number; days: number; ago?: 1 }
/**
 * How ready for training the body looks today, from last night's sleep, today's resting heart rate and HRV, each against
 * the person's own usual (the median of the 28 days before, with at least 7 of them). Kept simple so it can be explained:
 *   start at 70;
 *   sleep: +10 per hour more than usual, -10 per hour less, within -20..+10;
 *   resting heart rate: -2 per % above usual, +2 per % below, within -20..+10 (a raised resting rate: tired, ill, stressed);
 *   HRV: +0.5 per % above usual, -0.5 per % below, within -20..+10 (HRV swings a lot from day to day, so it counts less);
 *   training load (only with the Training load feature on, and 3 weeks of sessions): the last 7 days' load against the
 *   weekly average of the last 28 (acute:chronic, @motus/shared loadTrend): steady from 0.8 to 1.3 times the usual (no
 *   points, as Stats → Heart's card calls it); above, -1 per 2 % beyond 1.3 (within -15); below, +1 per 4 % under 0.8 (within +5);
 *   clamped to 0-100. Ready from 75, Normal from 50, else Take it easy. No score with fewer than 2 body parts (sleep,
 *   resting heart rate, HRV): the load alone says nothing about how the body has recovered.
 * why: one line from the (at most two) parts that moved the score most, then what the label advises ("You slept less
 * last night and your resting heart rate looks tired: train lightly today"; a Normal day whose named
 * parts all lowered it: "train moderately today"); sleep names its night, the load its 7 days, so the line says
 * which time each cause covers.
 * M-247's Recovery score reuses this rather than working out its own. ago: a part's value is yesterday's (absent: today's).
 * change: sleep in minutes, resting heart rate and HRV in % (signed). effect: which way the part moves the score; flat
 * within a small margin (15 min of sleep, 3 % resting heart rate, 5 % HRV) that is everyday noise.
 * building: the parts with today's value but too few days for a usual yet (days of the `need`), so Home can show the
 * baseline filling up instead of nothing while a new band's first weeks come in.
 */
export function readiness(parts: { key: BodyKey; value: number; history: number[]; ago?: 1 }[], load: LoadTrend | null = null): {
  score: number | null; label: "Ready" | "Normal" | "Take it easy" | null; why: string | null; parts: ReadinessPart[]; building: ReadinessBuilding[]; need: number;
} {
  const moved = new Map<ReadinessPart["key"], number>();
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  const out: ReadinessPart[] = [], building: ReadinessBuilding[] = [];
  let score = 70;
  for (const p of parts) {
    const enough = p.history.length >= MIN_BASELINE;
    const base = enough ? median(p.history)! : 0;
    // a full history with a zero usual is unusable, not still filling up: skip it rather than promise "usual in 1 day" forever
    if (!base && enough) continue;
    if (!base) { building.push({ key: p.key, value: p.value, days: Math.min(p.history.length, MIN_BASELINE - 1), ...(p.ago ? { ago: p.ago } : {}) }); continue; }
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
    if (!flat) moved.set(p.key, pts);
    out.push({ key: p.key, value: p.value, baseline: Math.round(base * 10) / 10, change, effect: flat ? "flat" : pts > 0 ? "up" : "down", ...(p.ago ? { ago: p.ago } : {}) });
  }
  const body = out.length;
  if (load?.ratio != null) {
    // value and baseline as weeks' loads; change in % (signed); the steady range (loadTrend's) is an ordinary week
    const change = Math.round((load.ratio - 1) * 100), r = load.ratio;
    const pts = r > 1.3 ? clamp(-(r - 1.3) * 50, -15, 0) : r < 0.8 ? clamp((0.8 - r) * 25, 0, 5) : 0, flat = pts === 0;
    score += pts;
    if (!flat) moved.set("load", pts);
    out.push({ key: "load", value: load.week, baseline: load.usual, change, effect: flat ? "flat" : pts > 0 ? "up" : "down" });
  }
  if (body < 2) return { score: null, label: null, why: null, parts: out, building, need: MIN_BASELINE };
  const s = Math.round(clamp(score, 0, 100));
  const label = s >= 75 ? "Ready" : s >= 50 ? "Normal" : "Take it easy";
  return { score: s, label, why: whyLine(moved, out.map((p) => p.key), label, out.some((p) => p.key === "sleep" && p.ago)), parts: out, building, need: MIN_BASELINE };
}
/** The readiness line: the one or two parts that moved the score most ("and" when they agree, "but" when not, the one
 *  that agrees with the advice last), then the advice: "You slept less last night and your resting heart rate looks
 *  tired: train lightly today." With none moved, the parts the score used: "Your resting heart rate and
 *  HRV are close to your usual: train as planned." sleepAgo: the night the score used is the one before last (last
 *  night's has not synced yet). */
function whyLine(moved: Map<ReadinessPart["key"], number>, used: ReadinessPart["key"][], label: keyof typeof ADVICE, sleepAgo = false): string {
  const top = [...moved].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2);
  // in "A but B" B reads as the point, so it is the cause that agrees with the advice (Ready: the one that raised the
  // score, Take it easy: the one that lowered it); Normal keeps the bigger cause first
  if (top.length === 2 && (top[0]![1] > 0) !== (top[1]![1] > 0) && label !== "Normal" && (top[1]![1] > 0) !== (label === "Ready")) top.reverse();
  if (!top.length) {
    const names = used.map((k) => NAME[k]).join(", ").replace(/, ([^,]*)$/, " and $1");
    return `Your ${names} are close to your usual: ${ADVICE[label]}.`;
  }
  const word = ([k, p]: [ReadinessPart["key"], number]) => {
    const w = WHY[k][p > 0 ? "up" : "down"];
    return k === "sleep" && sleepAgo ? w.replace("last night", "the night before last") : w;
  };
  // the second "you" goes when both start with it: "you trained ... and slept ..."
  const second = top[1] ? word(top[1]).replace(/^you (?=\S+ )/, word(top[0]!).startsWith("you ") ? "" : "you ") : "";
  const two = top[1] ? `${word(top[0]!)} ${(top[0]![1] > 0) === (top[1][1] > 0) ? "and" : "but"} ${second}` : word(top[0]!);
  // Ready can have only lowering causes named (unnamed flat parts added the points): "a good day to train hard" would contradict them
  const down = top.every(([, p]) => p < 0);
  const advice = down && label === "Normal" ? NORMAL_DOWN : down && label === "Ready" ? ADVICE.Normal : ADVICE[label];
  return `${two[0]!.toUpperCase()}${two.slice(1)}: ${advice}.`;
}

// one rule with the activity's Step sources sheet (@motus/shared); re-exported for the tests
export { plausibleSteps };

/**
 * A day's number from Health Connect kept as the day's synced value (039; the import's rules, see there): beside a typed
 * one, which the day keeps using until the person chooses the synced one; worn and the device's kind recorded beside it
 * (a null kind never clears a known one). known: the import log already lists the day (else it is noted now).
 * changed: the value or worn changed; touched: anything in the log did; noted: the log got the day.
 */
export async function putSynced(ctx: Ctx, kind: Daily, d: string, value: number, worn: boolean, device: WornDevice | null, known: boolean) {
  const { rows } = await ctx.q.query(
    `INSERT INTO daily_logs (user_id, date, kind, value, source, worn, synced) VALUES ($1,$2,$3,$4,$5,$6,$4)
     ON CONFLICT (user_id, date, kind) DO UPDATE SET synced = $4, worn = $6
     WHERE daily_logs.synced IS DISTINCT FROM $4 OR daily_logs.worn <> $6 RETURNING 1`, [ctx.userId, d, DAILY_KIND[kind], value, HEALTH_SOURCE, worn]);
  let touched = false, noted = false;
  if (device && worn && (await ctx.q.query(
    "UPDATE daily_logs SET device = $3 WHERE date = $1::date AND kind = $2 AND synced IS NOT NULL AND worn AND device IS DISTINCT FROM $3 RETURNING 1",
    [d, DAILY_KIND[kind], device])).rows.length) touched = true;
  if (rows.length || !known) {
    await remember(ctx, `${kind}:${d}`, kind, d, null);
    touched = noted = true;
  }
  return { changed: rows.length > 0, touched, noted };
}

/** One result of POST /health/ranges as the phone sends it (applyRange checks each field), or one worked out here (withStored). */
interface RangeIn {
  kind: "activity" | "workout"; id: string;
  steps?: unknown; covered?: unknown; bandOnly?: unknown; hr?: unknown;
  bandFields?: unknown; bandCovered?: unknown; distanceM?: unknown; activeKcal?: unknown; elevationM?: unknown; floors?: unknown;
}

/**
 * What the band had for one activity or workout (POST /health/ranges, one result; afterRecords): its steps when it
 * covered the time, heart rate, and the band's distance, calories and climb (bandFields). span: what the saved records
 * have for its time (spanFrom), which stands for the band's steps and heart rate when they cover it (withStored).
 * Writes only what changed.
 */
async function applyRange(ctx: Ctx, e: RangeIn, recheck: boolean, span: SpanBand | null) {
  const res = { steps: 0, hr: 0, band: 0, acts: false, works: false };
  e = withStored(e, span);
  if (e.kind === "workout") {
    const w = (await ctx.q.query("SELECT started_at, ended_at, hr, max_hr, avg_hr FROM workouts WHERE id = $1 AND status = 'completed'", [e.id])).rows[0];
    const h = w?.ended_at ? heartRate(e.hr, new Date(w.started_at).getTime() / 1000, new Date(w.ended_at).getTime() / 1000, HR_POINTS, 1) : null;
    // listed until settled, so it comes back on every read: the same readings again change nothing
    if (!h || (w.max_hr === h.max && JSON.stringify(w.hr) === JSON.stringify(h.hr))) return res;
    // an average typed in stays; the band's own follows as more readings arrive (as for activities, below)
    await ctx.q.query("UPDATE workouts SET hr = $2, max_hr = $3, avg_hr = $4, updated_at = $5 WHERE id = $1",
      [e.id, JSON.stringify(h.hr), h.max, bandAvg(w.hr, w.avg_hr, h.avg), ctx.now().toISOString()]);
    res.hr++; res.works = true;
    return res;
  }
  const a = (await ctx.q.query(
    `SELECT a.started_at, a.ended_at, a.source, a.steps, a.steps_source, a.steps_app, coalesce(t.has_steps, a.type IN ('walk', 'run', 'hike')) AS counts,
       a.band_distance_m, a.band_kcal, a.band_elevation_m, a.band_floors, a.band_at, a.hr, a.max_hr, a.avg_hr
     FROM activities a LEFT JOIN activity_types t ON t.slug = a.type WHERE a.id = $1`, [e.id])).rows[0];
  if (!a?.ended_at) return res;
  const steps = e.steps == null ? null : intOrNull(e.steps, 0, 1e7);
  // never over a count the person typed: changed by hand later ('manual'), or typed when the walk was logged by hand
  const fig = { steps: a.steps, stepsSource: a.steps_source, stepsApp: a.steps_app, source: a.source };
  const typed = stepsTyped(fig);
  // the app's own count: kept aside once the band's replaced it
  const app = appSteps(fig);
  // a count equal to the app's own is the phone's step counter (the sensor Motus counted with), not the band: an
  // older app build took it for the band's
  const phone = steps != null && app != null && steps === app;
  if (a.steps_source === "band" && !typed && (phone || (e.bandOnly === true && (steps == null || steps === 0 || (recheck && e.covered !== true && a.steps !== steps))))) {
    // the band's count was wrong (the phone's, or no band counted then, or, on the one-time recheck only, the band didn't
    // cover the activity and its count isn't the one saved, which an older build took from some other app: on any
    // later sync a partial count may just be band data since deleted, so a saved band count stays): back to the app's own count
    await ctx.q.query("UPDATE activities SET steps = $2, steps_app = NULL, steps_source = NULL WHERE id = $1", [e.id, app]);
    res.steps++; res.acts = true;
  } else if (bandStepsVerdict({ steps, covered: e.covered === true, app, counts: a.counts, typed }) === "use" && !(a.steps_source === "band" && a.steps === steps)) {
    await ctx.q.query("UPDATE activities SET steps_app = $2, steps = $3, steps_source = 'band' WHERE id = $1", [e.id, app, steps]);
    res.steps++; res.acts = true;
  }
  // taken whether or not the band covered the whole time (that rule is for its steps and totals): any reading inside
  // is the heart rate then
  const h = heartRate(e.hr, new Date(a.started_at).getTime() / 1000, new Date(a.ended_at).getTime() / 1000, HR_POINTS, 1);
  // an activity still listed for its band numbers comes back on every read: the same readings again change nothing
  if (h && !(a.max_hr === h.max && JSON.stringify(a.hr) === JSON.stringify(h.hr))) {
    await ctx.q.query("UPDATE activities SET hr = $2, max_hr = $3, avg_hr = $4 WHERE id = $1", [e.id, JSON.stringify(h.hr), h.max, bandAvg(a.hr, a.avg_hr, h.avg)]);
    res.hr++; res.acts = true;
  }
  if (e.bandFields === true) {
    if ((e.bandCovered ?? e.covered) === true) {
      const v = [bandNum(e.distanceM, 1e6), bandNum(e.activeKcal, 1e5), bandNum(e.elevationM, 1e5), bandNum(e.floors, 1e4)];
      const kcal = v[1] == null ? null : Math.round(v[1]);
      const had = [a.band_distance_m, a.band_kcal, a.band_elevation_m, a.band_floors].map((x) => (x == null ? null : Number(x)));
      const differs = had[0] !== v[0] || had[1] !== kcal || had[2] !== v[2] || had[3] !== v[3];
      // an activity still listed for its heart rate comes back on every read: the same numbers again change nothing
      // (no new band_at, no row to sync)
      if (differs || a.band_at == null)
        await ctx.q.query("UPDATE activities SET band_distance_m = $2, band_kcal = $3, band_elevation_m = $4, band_floors = $5, band_at = $6 WHERE id = $1",
          [e.id, v[0], kcal, v[2], v[3], ctx.now().toISOString()]);
      if (differs) { res.band++; res.acts = true; }
    } else if (ctx.now().getTime() - new Date(a.ended_at).getTime() > SETTLED_MS)
      await ctx.q.query("UPDATE activities SET band_at = $2 WHERE id = $1 AND band_at IS NULL", [e.id, ctx.now().toISOString()]);
  }
  return res;
}

/**
 * A result with the band's steps and heart rate from the saved records when they cover its time (the band's step
 * records reach past both ends, spanBand: everything the band had then is here); else as it came (the phone's read, or
 * nothing for afterRecords, which then changes nothing: the one rule for both, so they never take turns). Distance,
 * calories and climb stay the phone's (bandFields), with the phone's covered for them (bandCovered).
 */
function withStored(e: RangeIn, d: SpanBand | null): RangeIn {
  if (!d?.covered) return e;
  return { ...e, bandCovered: e.covered === true, steps: d.steps, covered: true, bandOnly: true, ...(d.hr ? { hr: d.hr } : {}) };
}

/** The saved records' span for each activity or workout (one load of the blocks they need; spanFrom). */
async function spansOf(q: Sql, items: { key: string; startS: number; endS: number }[]) {
  const wanted = new Map<string, Set<string>>();
  for (const x of items) if (x.endS > x.startS) spanBlocks(x.startS, x.endS, wanted);
  const blocks = await loadBlocks(q, wanted);
  return new Map(items.map((x) => [x.key, x.endS > x.startS ? spanFrom(blocks, x.startS, x.endS) : null]));
}
const secsOf = (t: unknown) => new Date(t as string).getTime() / 1000;

// the order a day's numbers are written in, by the import and afterRecords alike (both under the records lock)
const DAY_ORDER = ["steps", "sleep", "resting_hr", "spo2", "hrv", "distance", "active_kcal", "vo2max"] as const;
// activities and workouts worked out again per load of their blocks
const SPAN_BATCH = 100;

/**
 * After records were saved or deleted (POST /health/records, M-238; runs under its records lock): the numbers that come
 * from them worked out again, so they trace back to the readings. changed: per record type, the days whose blocks
 * changed or were read whole. A day's steps, distance and active calories where a band counted, and its resting heart
 * rate, SpO2, HRV and VO2 max (derivedDays; only days read whole, a day without stays the phone's), on those days and,
 * for amounts, the day after (a record across midnight); a night's sleep and its detail (sleepFrom) when its sessions or
 * readings during it changed; and the steps and heart rate of every activity and workout recorded in Motus around
 * changed step or heart rate records whose time the records cover (applyRange, as /health/ranges would give them). A day
 * under a deleted import log key stays out; typed values and a day's chosen value are never touched (putSynced sets the
 * synced value only). Only what changed is written and announced.
 */
export async function afterRecords(ctx: Ctx, changed: Map<string, Set<string>>) {
  let health = false, acts = false, works = false;
  const dayWant = new Map<DerivedType, Set<string>>();
  for (const kind of DERIVED_DAYS) {
    const days = new Set<string>();
    for (const d of changed.get(kind) ?? []) { days.add(d); if (isSum(kind)) days.add(shift(d, 1)); }
    if (days.size) dayWant.set(kind, days);
  }
  // a night: its own records changed, or readings during it (filed under the day they began: the night may end the next day)
  const sleepSet = new Set(changed.get("sleep") ?? []);
  for (const t of ["heart_rate", "spo2", "resp_rate"]) for (const d of changed.get(t) ?? []) { sleepSet.add(d); sleepSet.add(shift(d, 1)); }
  if (dayWant.size || sleepSet.size) {
    const reads = await loadReads(ctx.q, [...dayWant.keys(), "sleep", "heart_rate"]);
    const wanted = new Map<string, Set<string>>();
    for (const [kind, days] of dayWant) dayBlocks(kind, days, reads, wanted);
    sleepBlocks(sleepSet, reads, wanted);
    const blocks = await loadBlocks(ctx.q, wanted), kinds = await appKinds(ctx.q, [...dayWant.keys()].filter(isSum));
    const got = new Map([...dayWant].map(([kind, days]) => [kind as string, derivedDays(kind, blocks, days, reads, isSum(kind) ? kinds.get(kind) : undefined)]));
    const slept = sleepFrom(blocks, sleepSet, reads);
    const keys = [...[...got].flatMap(([kind, m]) => [...m.keys()].map((d) => `${kind}:${d}`)), ...[...slept.keys()].map((d) => `sleep:${d}`)];
    const imp = new Map((await ctx.q.query<{ key: string; deleted: boolean }>(
      "SELECT key, deleted_at IS NOT NULL AS deleted FROM health_imports WHERE key = ANY($1::text[])", [keys])).rows.map((x) => [x.key, x.deleted]));
    for (const kind of DAY_ORDER) {
      if (kind === "sleep") {
        for (const d of [...slept.keys()].sort()) {
          const v = slept.get(d)!, key = `sleep:${d}`;
          if (imp.get(key) === true) continue;
          // as the import: the day's hours, else the night's time asleep
          const hours = v.hours != null ? Math.round(Math.min(v.hours, 24) * 10) / 10 : v.night ? Math.round(v.night.asleepMin / 6) / 10 : null;
          let known = imp.has(key);
          if (hours != null) {
            const r = await putSynced(ctx, "sleep", d, hours, true, null, known);
            if (r.changed || r.touched) health = true;
            known = true;
          }
          const n = v.night && readNight(v.night);
          if (!n || !known) continue;
          const { rows } = await ctx.q.query(UPSERT_NIGHT, [ctx.userId, n.date, n.start, n.end, n.asleep, n.awake, n.light, n.deep, n.rem,
            n.avgHr, n.minHr, n.hr && JSON.stringify(n.hr), n.avgSpo2, n.minSpo2, n.respRate, HEALTH_SOURCE]);
          if (rows.length) health = true;
        }
        continue;
      }
      const m = got.get(kind);
      if (!m) continue;
      for (const d of [...m.keys()].sort()) {
        const v = m.get(d)!, deleted = imp.get(`${kind}:${d}`), value = kind === "steps" ? Math.min(v.value, 1e6) : lenient(kind, v.value);
        if (deleted === true || value == null) continue;
        const r = await putSynced(ctx, kind, d, value, true, v.device, deleted === false);
        if (r.changed || r.touched) health = true;
      }
    }
  }
  const spanDays = [...new Set([...(changed.get("steps") ?? []), ...(changed.get("heart_rate") ?? [])])];
  if (spanDays.length) {
    // every activity and workout whose time (30 minutes either side) the changed blocks' records may reach: a day's
    // blocks hold records begun that day in any zone (14 hours either way), up to a week long. The range of all the days
    // first, on started_at (each table's (user_id, started_at) index; a session over a month long is no real one), so
    // the per-day test only looks at the sessions near them, not every one the account has
    const lo = spanDays.reduce((a, b) => (a < b ? a : b)), hi = spanDays.reduce((a, b) => (a > b ? a : b));
    const near = "started_at > $3::date - interval '32 days' AND started_at < $4::date + interval '9 days' AND ended_at > $3::date - interval '1 day'";
    const { rows } = await ctx.q.query<{ kind: "activity" | "workout"; id: string; started_at: unknown; ended_at: unknown }>(
      `SELECT * FROM (
         SELECT 'activity' AS kind, id::text AS id, started_at, ended_at FROM activities WHERE source <> $2 AND ended_at IS NOT NULL AND ${near}
         UNION ALL
         SELECT 'workout', id::text, started_at, ended_at FROM workouts WHERE status = 'completed' AND ended_at IS NOT NULL AND ${near}
       ) x WHERE EXISTS (SELECT 1 FROM unnest($1::date[]) d WHERE x.ended_at > d - interval '1 day' AND x.started_at < d + interval '9 days')
       ORDER BY started_at, id`, [spanDays, HEALTH_SOURCE, lo, hi]);
    for (let i = 0; i < rows.length; i += SPAN_BATCH) {
      const batch = rows.slice(i, i + SPAN_BATCH);
      const spans = await spansOf(ctx.q, batch.map((x) => ({ key: x.id, startS: secsOf(x.started_at), endS: secsOf(x.ended_at) })));
      for (const x of batch) {
        const d = spans.get(x.id) ?? null;
        // records that don't cover its time leave the phone's numbers as they are (withStored)
        if (!d?.covered) continue;
        const n = await applyRange(ctx, { kind: x.kind, id: x.id }, false, d);
        acts ||= n.acts; works ||= n.works;
      }
    }
  }
  if (health || acts || works) ctx.changed("health", ...(acts ? ["activity"] as const : []), ...(works ? ["workout"] as const : []));
}

// the payload's fields of numbers worked out from the records, in the order a day's numbers are written (DAY_ORDER)
const DERIVED_FIELDS = [["steps", "steps"], ["restingHr", "resting_hr"], ["spo2", "spo2"], ["hrv", "hrv"], ["distance", "distance"],
  ["activeKcal", "active_kcal"], ["vo2max", "vo2max"]] as const;

export function healthRoutes(r: Router) {
  r.post("/health/import", async (ctx, _p, b) => {
    // first, before any row: what it writes is also worked out from the records (afterRecords, under the same lock), so
    // the two never interleave, and every path takes this lock before row locks (lockRecords)
    await lockRecords(ctx.q, ctx.userId);
    const list = (v: unknown, max: number): any[] => (Array.isArray(v) ? v.slice(0, max) : []);
    const out = { steps: 0, sleep: 0, sleepNights: 0, restingHr: 0, spo2: 0, hrv: 0, distance: 0, activeKcal: 0, hydration: 0, vo2max: 0, weight: 0, bodyFat: 0, activities: 0, hrDays: 0 };
    let touched = false; // the log changed (a row noted), even when no number did

    const imps = new Map<string, Imp>((await ctx.q.query<Imp & { key: string }>(
      "SELECT key, kind, to_char(date, 'YYYY-MM-DD') AS date, ref, deleted_at IS NOT NULL AS deleted, apart, linked FROM health_imports")).rows
      .map((x) => [x.key, { kind: x.kind, date: x.date, ref: x.ref, deleted: x.deleted, apart: x.apart, linked: x.linked }]));
    /**
     * Whether to bring this key in: not when deleted, from the log or by deleting its data elsewhere in the app (034
     * marks it then). Data missing here is not taken as deleted: a copy may have the log entry before the day's number
     * (sync sends rows a page at a time), and a number typed over the band's and then cleared was the person's own.
     */
    const open = (key: string) => !imps.get(key)?.deleted;

    // Every value is kept (039): as the day's synced value, beside a typed one if there is one, which the day keeps using
    // (the person's own number wins over a device's by default, PLAN.md decision M-155) until the person chooses the
    // synced one. worn: a band, watch or ring counted the day (036); the phone says so for steps, distance and active
    // calories, and one that doesn't (an older app) is taken as worn, as before
    // device: the kind of worn device whose count the day is (038), from the phone per day; recorded beside the value and
    // never cleared by a read that doesn't know it (null), so a gadget that sometimes says its kind and sometimes not, or
    // a second phone that can't tell, doesn't take a known kind away. Not counted as a new day: only the wording follows it.
    // Every day is noted in the import log, typed or not, so Imported data lists it.
    const day = async (kind: Daily, date: unknown, value: number | null, worn = true, device: WornDevice | null = null) => {
      const d = dateStr(date);
      if (!d || value == null) return false;
      const key = `${kind}:${d}`;
      if (!open(key)) return false;
      const r = await putSynced(ctx, kind, d, value, worn, device, imps.has(key));
      if (r.noted) imps.set(key, { kind, date: d, ref: null, deleted: false });
      if (r.touched) touched = true;
      return r.changed;
    };
    // a day the records saved here have whole (M-238; a band's count, a reading; readDay): worked out from them
    // (derivedDays), so the number traces back to its readings; the phone's stays for days without (Health Connect's own
    // total when no band counted, a day not read whole). Both give the same number for the same data: the day is set,
    // never added to. One load of only the blocks the payload's days need, and the days in date order (as afterRecords).
    const byDate = (v: unknown) => list(v, 400).sort((x, y) => String(dateStr(x?.date) ?? "").localeCompare(String(dateStr(y?.date) ?? "")));
    const asked = (field: string) => list(b[field], 400).map((e) => dateStr(e?.date)).filter((d): d is string => !!d);
    const sleepAsked = [...new Set([...asked("sleep"), ...asked("sleepNights")])];
    const reads = await loadReads(ctx.q, [...DERIVED_DAYS, "sleep", "heart_rate"]);
    const wanted = new Map<string, Set<string>>();
    for (const [field, kind] of DERIVED_FIELDS) dayBlocks(kind, asked(field), reads, wanted);
    sleepBlocks(sleepAsked, reads, wanted);
    const blocks = await loadBlocks(ctx.q, wanted);
    const kinds = await appKinds(ctx.q, DERIVED_FIELDS.map((x) => x[1]).filter((k) => isSum(k) && wanted.has(k)) as SumType[]);
    const derived = (kind: DerivedType, field: string) => {
      const got = derivedDays(kind, blocks, asked(field), reads, isSum(kind) ? kinds.get(kind) : undefined);
      return byDate(b[field]).map((e) => ({ e, rec: got.get(dateStr(e?.date) ?? "") }));
    };
    for (const { e, rec } of derived("steps", "steps"))
      if (rec ? await day("steps", e?.date, Math.min(rec.value, 1e6), true, rec.device)
        : await day("steps", e?.date, intOrNull(e?.value, 0, 1e6), e?.worn !== false, cleanWornDevice(e?.device))) out.steps++;
    // a night the records saved here have whole (M-238): its hours and detail worked out from them (sleepFrom), else the phone's
    const slept = sleepFrom(blocks, sleepAsked, reads);
    for (const e of byDate(b.sleep)) {
      const got = slept.get(dateStr(e?.date) ?? "")?.hours;
      const h = got != null ? Math.min(got, 24) : numOrNull(e?.hours, 0, 24);
      if (await day("sleep", e?.date, h == null ? null : Math.round(h * 10) / 10)) out.sleep++;
    }
    for (const [field, kind] of DERIVED_FIELDS.slice(1))
      for (const { e, rec } of derived(kind, field))
        if (rec ? await day(kind, e?.date, lenient(kind, rec.value), true, rec.device)
          : await day(kind, e?.date, lenient(kind, e?.value), e?.worn !== false, cleanWornDevice(e?.device))) out[field]++;
    for (const e of list(b.hydration, 400)) if (await day("water", e?.date, lenient("water", e?.ml))) out.hydration++;

    // nights: after the daily sleep, whose key they share
    const sleepDays = new Set(list(b.sleep, 400).map((e) => e?.date));
    for (const n of list(b.sleepNights, 400).map((e) => readNight(slept.get(dateStr(e?.date) ?? "")?.night ?? e))) {
      if (!n) continue;
      const key = `sleep:${n.date}`;
      // a night without the day's hours alongside: its asleep time is the day's sleep (a typed day stays as it is)
      if (!sleepDays.has(n.date)) await day("sleep", n.date, Math.round(n.asleep / 6) / 10);
      if (imps.get(key)?.deleted) continue;
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

    // weight and body fat readings, each into the body log once
    const reading = async (kind: Body, e: any, value: number | null) => {
      if (value == null || !e?.at) return false;
      const at = isoTime(e.at);
      const id = e.id != null ? str(String(e.id), 100) : "";
      // an app without record ids keys a reading by its time; with ids, that older key still counts as the same reading
      const key = id ? `${kind}:${id}` : `${kind}:${at}`, legacy = imps.get(`${kind}:${at}`);
      // an entry without its row (ref null): a deletion taken back (restore), so the reading comes in again
      const h = imps.get(key);
      if (!open(key) || h?.ref) return false;
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
      touched = true;
      return added;
    };
    for (const e of list(b.weight, 1000)) if (await reading("weight", e, lenientBody("weight", e?.kg))) out.weight++;
    for (const e of list(b.bodyFat, 1000)) if (await reading("body_fat", e, lenientBody("body_fat", e?.pct))) out.bodyFat++;

    const sessions = list(b.sessions, 500).filter((s) => s?.id && s?.start && s?.end);
    if (sessions.length) await ensureTypes(ctx);
    for (const s of sessions) {
      const hcId = str(String(s.id), 70), key = `activity:${hcId}`, clientId = `hc:${hcId}`;
      // an entry without its activity (ref null): a deletion taken back (restore), so the session comes in again
      let h = imps.get(key);
      // linked to a Motus record that is gone (deleted on another copy, where 047's trigger is skipped): let go, as the
      // trigger would have, so the session comes in as its own activity
      if (h?.ref && h.linked && open(key) && await releaseDangling(ctx, key)) {
        h = { ...h, ref: null, linked: null };
        imps.set(key, h);
        touched = true;
      }
      if (!open(key) || h?.ref) continue;
      const start = isoTime(s.start), end = isoTime(s.end), span: [string, string] = [start, end];
      // the same session as one the person deleted (its time kept, 046), from a second app arriving after the deletion:
      // noted as deleted too, so deleting keeps both out whichever order they come in
      // (only for a key not in the log yet: one the person restored comes in)
      const gone = !h && (await ctx.q.query(
        `SELECT 1 FROM health_imports WHERE kind = 'activity' AND deleted_at IS NOT NULL AND key <> $3 AND $2::timestamptz > $1::timestamptz
           AND span_end > span_start AND span_start < $2::timestamptz AND span_end > $1::timestamptz
           AND extract(epoch FROM least(span_end, $2::timestamptz) - greatest(span_start, $1::timestamptz))
             >= 0.8 * greatest(extract(epoch FROM span_end - span_start), extract(epoch FROM $2::timestamptz - $1::timestamptz)) LIMIT 1`,
        [start, end, key])).rows.length > 0;
      if (gone) {
        // marking a key deleted takes the records lock (041's trigger): taken here first, as every path does
        await lockRecords(ctx.q, ctx.userId);
        await remember(ctx, key, "activity", null, null, { span, deleted: true });
        imps.set(key, { kind: "activity", date: null, ref: null, deleted: true });
        touched = true;
        continue;
      }
      // a workout or activity recorded in Motus over the same time (the band saw it too): linked to it, not a second
      // activity, and it gets the band's numbers it lacks (bandMatch). Not one the person unlinked (apart).
      // the same session already brought in as an activity the person made their own (edited, or unlinked: apart on
      // its key), from a second app: this key is a copy of that activity, never linked to a Motus record beside it
      // (its numbers would count twice)
      const own = (await ctx.q.query<{ id: string }>(
        `SELECT a.id::text AS id FROM activities a WHERE a.source = $3 AND $2::timestamptz > $1::timestamptz AND a.ended_at > a.started_at
           AND (a.edited_at IS NOT NULL OR EXISTS (SELECT 1 FROM health_imports o WHERE o.ref = a.id::text AND o.apart AND o.linked IS NULL))
           AND a.started_at < $2::timestamptz AND a.ended_at > $1::timestamptz
           AND extract(epoch FROM least(a.ended_at, $2::timestamptz) - greatest(a.started_at, $1::timestamptz))
             >= 0.8 * greatest(extract(epoch FROM a.ended_at - a.started_at), extract(epoch FROM $2::timestamptz - $1::timestamptz))
         ORDER BY abs(extract(epoch FROM a.started_at - $1::timestamptz)) LIMIT 1`, [start, end, HEALTH_SOURCE])).rows[0]?.id ?? null;
      if (own) {
        await remember(ctx, key, "activity", null, own, { span });
        imps.set(key, { kind: "activity", date: null, ref: own, deleted: false });
        touched = true;
        continue;
      }
      const motus = h?.apart ? null : await motusRecordFor(ctx, start, end);
      if (motus) {
        const copied = await copyFigures(ctx, motus.kind, motus.id, { steps: bandNum(s.steps, 1e6), distanceM: bandNum(s.distanceM, 1e7), calories: bandNum(s.calories, 20000), avgHr: bandNum(s.avgHr, 250) });
        await remember(ctx, key, "activity", null, motus.id, { linked: motus.kind, span, copied });
        imps.set(key, { kind: "activity", date: null, ref: motus.id, deleted: false });
        touched = true;
        continue;
      }
      // brought in before the log existed: noted, not added again
      let ref: string | null = (await ctx.q.query("SELECT id::text AS id FROM activities WHERE client_id = $1", [clientId])).rows[0]?.id ?? null;
      // the same session under another Health Connect id: written by a second app (the band's own app and Gadgetbridge,
      // a fitness app copying it) or read on a second phone. One already brought in over nearly the same time (each
      // overlapping the other by 80%) is that session: noted for it, not added again, so its time, steps and distance
      // count once (Stats, scores, a day's steps with the walks). Only sessions brought in from Health Connect: one
      // recorded in Motus is the person's own and stays apart from the import log. Deleting it marks both keys (034).
      if (!ref) ref = (await ctx.q.query(
        `SELECT id::text AS id FROM activities WHERE source = $3 AND $2::timestamptz > $1::timestamptz AND ended_at > started_at
           AND started_at < $2::timestamptz AND ended_at > $1::timestamptz
           AND extract(epoch FROM least(ended_at, $2::timestamptz) - greatest(started_at, $1::timestamptz))
             >= 0.8 * greatest(extract(epoch FROM ended_at - started_at), extract(epoch FROM $2::timestamptz - $1::timestamptz))
         ORDER BY abs(extract(epoch FROM started_at - $1::timestamptz)) LIMIT 1`, [start, end, HEALTH_SOURCE])).rows[0]?.id ?? null;
      if (!ref) {
        const type = str(s.type, 40) || "other";
        const known = (await ctx.q.query("SELECT 1 FROM activity_types WHERE slug = $1", [type])).rows.length > 0;
        ref = await saveActivity(ctx, {
          type: known ? type : "other", name: str(s.title, 120), startedAt: s.start, endedAt: s.end,
          distanceM: s.distanceM, steps: s.steps, avgHr: s.avgHr, calories: s.calories, source: HEALTH_SOURCE, clientId,
        });
        out.activities++;
      }
      await remember(ctx, key, "activity", null, ref, { span });
      imps.set(key, { kind: "activity", date: null, ref, deleted: false });
      touched = true;
    }
    // sessions brought in before their workout or activity was in Motus (finished later, or synced from another copy),
    // and duplicates from before linking: taken into the Motus record now (over this read's sessions' time only)
    const times = sessions.flatMap((s) => { try { return [Date.parse(isoTime(s.start)), Date.parse(isoTime(s.end))]; } catch { return []; } });
    // (with no sessions in this read, only the next batch of the one full-history pass, linkHistory)
    if (times.length ? await linkBandSessions(ctx, new Date(Math.min(...times)).toISOString(), new Date(Math.max(...times)).toISOString())
      : await linkHistory(ctx)) touched = true;

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

    // b.device (the kind behind the newest worn day, which the release before saved in settings) is not used: each
    // day carries its own kind now (above), and the kind screens use is worked out from those days (GET /health/device)

    if (touched || Object.values(out).some((n) => n > 0)) ctx.changed("health");
    return out;
  });

  // Activities recorded and workouts done in Motus that the band may have more for: its steps (a type that counts steps,
  // not yet from the band nor typed later) or heart rate. The phone reads Health Connect for each time and answers below.
  // Sessions that came from Health Connect itself already have what the band had.
  // recheck: also activities that already have the band's steps, once after the app changed how it reads them (an
  // older build took the phone's own step counter for the band), so a wrong count goes back to the app's own (below).
  // band: the app also reads the band's distance, active calories and climb for an activity (037), so every activity
  // whose band numbers aren't in yet is asked about too; an older app doesn't say so and is asked what it always was.
  r.get("/health/ranges", async (ctx, _p, _b, qs) => {
    const from = isoTime(qs.from, new Date(ctx.now().getTime() - 30 * 86400000).toISOString());
    const recheck = qs.recheck === "1" || qs.recheck === "true";
    const band = qs.band === "1" || qs.band === "true";
    const { rows } = await ctx.q.query(
      `SELECT * FROM (
         SELECT 'activity' AS kind, a.id, a.started_at, a.ended_at FROM activities a LEFT JOIN activity_types t ON t.slug = a.type
          WHERE a.source <> $2 AND a.ended_at IS NOT NULL AND a.started_at >= $1
            AND (a.hr IS NULL OR ($3::boolean AND a.steps_source = 'band') OR ($4::boolean AND a.band_at IS NULL) OR (a.steps_source IS NULL AND coalesce(t.has_steps, a.type IN ('walk', 'run', 'hike'))
              -- a count typed when the walk was logged by hand is the person's: the band's never replaces it
              AND NOT (a.source = 'manual' AND a.steps IS NOT NULL)))
         UNION ALL
         SELECT 'workout', w.id, w.started_at, w.ended_at FROM workouts w
          -- listed until settled, not only while it has none: the read right after it ended may have had one reading
          WHERE w.status = 'completed' AND w.ended_at IS NOT NULL AND w.started_at >= $1 AND (w.hr IS NULL OR w.ended_at > $5)
       ) x ORDER BY started_at DESC LIMIT 200`, [from, HEALTH_SOURCE, recheck, band, new Date(ctx.now().getTime() - SETTLED_MS).toISOString()]);
    const iso = (v: unknown) => new Date(v as string).toISOString();
    return { ranges: rows.map((x: any) => ({ kind: x.kind as "activity" | "workout", id: x.id as string, start: iso(x.started_at), end: iso(x.ended_at) })) };
  });

  // What the band had for those times. steps only counts when covered: the band's data spans the whole activity, so its
  // count is for exactly that time (a band that synced half of it would undercount).
  // distanceM, activeKcal, elevationM, floors: the band's for the activity's time (bandFields: an app that reads them),
  // kept in their own columns (037) and never over the activity's own distance or climb; taken only when covered, as
  // steps, so a band that synced half the time doesn't stand for the whole activity. An activity the band never covered
  // is asked about until it settled (3 days, as the app's own list of sessions without band data).
  r.post("/health/ranges", async (ctx, _p, b) => {
    const out = { steps: 0, hr: 0, band: 0 };
    let acts = false, works = false;
    const results = (Array.isArray(b.results) ? b.results : []).slice(0, 200) as RangeIn[];
    for (const e of results) if (!e || (e.kind !== "activity" && e.kind !== "workout") || !isUuid(e.id)) throw bad("Invalid result");
    // the saved records for all of them, loaded once (spansOf)
    const ids = results.map((e) => e.id);
    const { rows: times } = await ctx.q.query<{ kind: string; id: string; started_at: unknown; ended_at: unknown }>(
      `SELECT 'activity' AS kind, id::text AS id, started_at, ended_at FROM activities WHERE id = ANY($1::uuid[]) AND ended_at IS NOT NULL
       UNION ALL SELECT 'workout', id::text, started_at, ended_at FROM workouts WHERE id = ANY($1::uuid[]) AND status = 'completed' AND ended_at IS NOT NULL`, [ids]);
    const spans = await spansOf(ctx.q, times.map((x) => ({ key: `${x.kind}:${x.id}`, startS: secsOf(x.started_at), endS: secsOf(x.ended_at) })));
    for (const e of results) {
      const n = await applyRange(ctx, e, b.recheck === true, spans.get(`${e.kind}:${e.id}`) ?? null);
      out.steps += n.steps; out.hr += n.hr; out.band += n.band; acts ||= n.acts; works ||= n.works;
    }
    if (acts || works) ctx.changed("health", ...(acts ? ["activity"] as const : []), ...(works ? ["workout"] as const : []));
    return out;
  });

  // Nights of sleep, newest first. Shown only while the day's sleep is there: not when the day's sleep was cleared
  // elsewhere (the band's cleared marks its import deleted, 034, and a deleted import has no night, 031; a typed one
  // cleared leaves the night for the next import). edited/sleepH: the day's own number.
  const nights = async (ctx: Ctx, where: string, args: unknown[], withHr: boolean) => (await ctx.q.query(
    `SELECT to_char(n.date, 'YYYY-MM-DD') AS date, n.start_at, n.end_at, n.asleep_min, n.awake_min, n.light_min, n.deep_min, n.rem_min,
       n.avg_hr, n.min_hr, n.avg_spo2, n.min_spo2, n.resp_rate, d.value AS sleep_h, d.source AS d_source ${withHr ? ", n.hr" : ""}
     FROM sleep_nights n JOIN daily_logs d ON d.user_id = n.user_id AND d.date = n.date AND d.kind = 'sleep_h'
     WHERE ${where}
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
    // one pass over the three heart kinds and one check of sleep_nights, shared by the flags that need them
    const { rows } = await ctx.q.query(`WITH hk AS (
        SELECT COALESCE(array_agg(DISTINCT kind::text), '{}'::text[]) AS kinds FROM daily_logs WHERE kind IN ('resting_hr', 'spo2', 'hrv')
      ), sn AS (SELECT EXISTS (SELECT 1 FROM sleep_nights) AS any)
      SELECT
      sn.any OR EXISTS (SELECT 1 FROM daily_logs WHERE kind = 'sleep_h' AND synced IS NOT NULL) AS sleep,
      cardinality(hk.kinds) > 0
        OR EXISTS (SELECT 1 FROM activities WHERE hr IS NOT NULL OR (source = $1 AND avg_hr IS NOT NULL))
        OR EXISTS (SELECT 1 FROM workouts WHERE hr IS NOT NULL) OR EXISTS (SELECT 1 FROM hr_days) AS heart,
      EXISTS (SELECT 1 FROM daily_logs WHERE kind = 'distance_m') AS distance,
      EXISTS (SELECT 1 FROM daily_logs WHERE kind = 'active_kcal') AS calories,
      EXISTS (SELECT 1 FROM daily_logs WHERE kind = 'vo2max') AS vo2max,
      EXISTS (SELECT 1 FROM hr_days) AS hr_day,
      EXISTS (SELECT 1 FROM health_imports h JOIN body_metrics b ON b.id::text = h.ref WHERE h.kind = 'body_fat' AND h.deleted_at IS NULL) AS body_fat,
      EXISTS (SELECT 1 FROM daily_logs WHERE kind = 'water_ml' AND synced IS NOT NULL) AS hydration,
      sn.any AS nights,
      'resting_hr' = ANY (hk.kinds) AS resting_hr,
      'hrv' = ANY (hk.kinds) AS hrv,
      'spo2' = ANY (hk.kinds) AS spo2,
      EXISTS (SELECT 1 FROM health_imports WHERE deleted_at IS NULL) AS imports,
      EXISTS (SELECT 1 FROM daily_logs WHERE kind = 'steps' AND value > 0) OR EXISTS (SELECT 1 FROM activities WHERE steps > 0) AS steps
      FROM hk, sn`, [HEALTH_SOURCE]);
    const x = rows[0] as any;
    return {
      sleep: !!x.sleep, heart: !!x.heart, distance: !!x.distance, calories: !!x.calories,
      vo2max: !!x.vo2max, hrDay: !!x.hr_day, bodyFat: !!x.body_fat, hydration: !!x.hydration,
      nights: !!x.nights, restingHr: !!x.resting_hr, hrv: !!x.hrv, spo2: !!x.spo2, imports: !!x.imports,
      // steps: any day's steps, typed, from a band or from recorded walks (Stats → Steps shows them all)
      steps: !!x.steps,
    };
  });

  // Everything the band had for one day, for Home, the calendar and a day's view. null where there is nothing.
  // sleepH: the day's sleep hours, there also for a day without a night's detail (typed, or synced before nights were)
  // tz: the app's calendar, for the day's steps (recorded activities count in, as on Home)
  // The kind of the person's worn device, so screens say "your watch" or "your ring": the kind most of the newest days
  // with a known kind came from (about ten days of steps, distance and active calories), the newer one on a tie. Worked
  // out from the days, never saved: one odd day, a gadget that only sometimes says its kind, or two devices worn by turns
  // don't flip the wording; a new device takes over once it has counted most of those days. null: none known.
  r.get("/health/device", async (ctx) => {
    const { rows } = await ctx.q.query(
      `SELECT device FROM (SELECT date, device FROM daily_logs WHERE kind IN ('steps', 'distance_m', 'active_kcal') AND synced IS NOT NULL AND worn
         AND device IS NOT NULL ORDER BY date DESC LIMIT 30) t GROUP BY device ORDER BY count(*) DESC, max(date) DESC LIMIT 1`);
    return { kind: cleanWornDevice(rows[0]?.device) };
  });

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
    // worn: false when any of the day's steps, distance and active calories from Health Connect came without a band (036)
    const worn = !(await ctx.q.query("SELECT 1 FROM daily_logs WHERE date = $1::date AND kind IN ('steps', 'distance_m', 'active_kcal') AND source = $2 AND NOT worn LIMIT 1",
      [d, HEALTH_SOURCE])).rows.length;
    return {
      date: d, sleep, sleepH: v("sleep_h"),
      hr: h ? { min: h.min_hr as number | null, max: h.max_hr as number | null, avg: h.avg_hr as number | null, series: (h.hr ?? null) as [number, number][] | null } : null,
      restingHr: v("resting_hr"), hrv: v("hrv"), spo2: v("spo2"), vo2max: v("vo2max"), steps,
      distanceM: v("distance_m"), activeKcal: v("active_kcal"), waterMl: v("water_ml"), worn,
    };
  });

  // Today's readiness (readiness() says how it is worked out). Each part is today's value, else yesterday's (a band that
  // hasn't synced today yet), against the 28 days before it. tz: the app's calendar
  r.get("/health/readiness", async (ctx, _p, _b, qs) => {
    const today = dayIn(ctx.now(), tzOf(qs));
    const { rows } = await ctx.q.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, kind, value FROM daily_logs
       WHERE kind IN ('sleep_h', 'resting_hr', 'hrv') AND date >= $1::date AND date <= $2::date`, [shift(today, -BASELINE_DAYS - 1), today]);
    const parts = ([["sleep", "sleep_h"], ["restingHr", "resting_hr"], ["hrv", "hrv"]] as const).flatMap(([key, kind]) => {
      const mine = rows.filter((x: any) => x.kind === kind).map((x: any) => ({ date: x.date as string, value: Number(x.value) }));
      const now = mine.find((x) => x.date === today) ?? mine.find((x) => x.date === shift(today, -1));
      if (!now || !(now.value > 0)) return [];
      // sleep: a nap or partial record (under MIN_NIGHT_H) is no night, neither today's value nor in the usual; a short
      // one today leaves sleep out of the score rather than reading as a terrible night (or falling back to yesterday's)
      const counts = (v: number) => v > 0 && (key !== "sleep" || isNight(v));
      if (!counts(now.value)) return [];
      const from = shift(now.date, -BASELINE_DAYS);
      return [{ key, value: now.value, history: mine.filter((x) => x.date >= from && x.date < now.date && counts(x.value)).map((x) => x.value),
        ...(now.date === today ? {} : { ago: 1 as const }) }];
    });
    const load = await trainingLoad(ctx, today, today, tzOf(qs));
    return { ...readiness(parts, load?.trend ?? null), date: today };
  });

  // Health scores (the Health scores feature, M-247; @motus/shared scores.ts says how each is worked out and from which
  // guideline): sleep, activity and strength over the last 7 days, today in them, each null without the data it needs.
  // Recovery is Readiness (/health/readiness), not a score of its own. null while the feature is off. tz: the app's calendar
  r.get("/health/scores", async (ctx, _p, _b, qs) => {
    const st = await getSettings(ctx.q, ctx.userId);
    if (!st.features.scores) return { scores: null };
    const tz = tzOf(qs), today = dayIn(ctx.now(), tz), from = shift(today, -(SCORE_DAYS - 1));
    const age = ageOf(st.profile?.birthYear, ctx.now()), max = maxHeartRate(st.profile ?? {}, ctx.now())?.bpm ?? null;
    // the guidelines scored are the adult ones: under 18 no scores, and Stats → Scores says why (minor)
    if (!scoresFor(age)) return { scores: { from, to: today, age, minor: true, sleep: null, activity: null, strength: null } };
    const inWeek = (at: string | Date) => { const d = dayIn(at, tz); return d >= from && d <= today; };
    // the app's minute of the day of an instant, counted from noon so a night's times don't wrap at midnight
    const fromNoon = (iso: string) => { const d = new Date(Date.parse(iso) - tz * 60000); return (d.getUTCHours() * 60 + d.getUTCMinutes() + 720) % 1440; };

    // sleep: the week's full nights (a nap or part of a night is no night, as everywhere); time asleep is the person's own
    // when they changed it, as the night's page shows it
    const ns = (await nights(ctx, "n.date >= $1::date AND n.date <= $2::date", [from, today], false)).map((n) => {
      const asleep = n.edited && n.sleepH ? Math.round(n.sleepH * 60) : n.asleepMin;
      const bedAt = fromNoon(n.startAt), inBedMin = Math.max(0, Math.round((Date.parse(n.endAt) - Date.parse(n.startAt)) / 60000));
      return { asleepMin: asleep, inBedMin, bedAt, wakeAt: bedAt + inBedMin };
    }).filter((n) => isNight(n.asleepMin / 60));

    // activity: minutes of effort from each day's heart rate (with a max heart rate to place it); recorded activities of a
    // moving type (one that covers distance: walk, run, hike, cycle, swim, row...; not yoga, stretching or other) count
    // as moderate, as WHO's examples are, on days without heart rate, or for the whole week when heart rate covers too
    // few days (activityScore picks)
    const hrDays = max ? (await ctx.q.query<{ date: string; hr: unknown }>(
      "SELECT to_char(date, 'YYYY-MM-DD') AS date, hr FROM hr_days WHERE date >= $1::date AND date <= $2::date", [from, today])).rows : [];
    let moderate = 0, vigorous = 0;
    const hrDates = new Set<string>();
    for (const d of hrDays) {
      const hr = (typeof d.hr === "string" ? JSON.parse(d.hr) : d.hr) as [number, number][] | null;
      if (!hr || hr.length < 2) continue;
      const m = effortMinutes(hr, max!);
      moderate += m.moderate; vigorous += m.vigorous; hrDates.add(d.date);
    }
    const lo = shift(from, -1), hi = shift(today, 2);
    await ensureTypes(ctx);
    const acts = (await ctx.q.query<{ started_at: string; duration_s: number | string | null }>(
      `SELECT a.started_at, a.duration_s FROM activities a JOIN activity_types t ON t.user_id = a.user_id AND t.slug = a.type
       WHERE t.has_distance AND a.started_at >= $1::date AND a.started_at < $2::date`, [lo, hi])).rows;
    let activityMin = 0, activityMinOffHr = 0;
    for (const a of acts) {
      if (!inWeek(a.started_at)) continue;
      const m = (Number(a.duration_s) || 0) / 60;
      activityMin += m;
      if (!hrDates.has(dayIn(a.started_at, tz))) activityMinOffHr += m;
    }
    const steps = (await stepsByDay(ctx.q, from, shift(today, 1), tz)).map((x) => Number(x.value) || 0);

    // strength: only for someone who trains (a finished workout in the last 4 weeks); the week's days with a finished hard
    // set, and hard sets per muscle as Stats → Muscles counts them
    const sets = (await ctx.q.query<{ workout_id: string; started_at: string; primary_muscles: string[]; secondary_muscles: string[]; n: string | number }>(
      `SELECT w.id AS workout_id, w.started_at, e.primary_muscles, e.secondary_muscles, count(s.id) AS n
       FROM workouts w LEFT JOIN workout_exercises we ON we.workout_id = w.id LEFT JOIN exercises e ON e.id = we.exercise_id
       LEFT JOIN workout_sets s ON s.workout_exercise_id = we.id AND s.done AND s.kind <> 'warmup'
       WHERE w.status = 'completed' AND w.started_at >= $1::date AND w.started_at < $2::date GROUP BY w.id, e.id`, [shift(today, -29), hi])).rows;
    const week = sets.filter((x) => inWeek(x.started_at));
    const trains = sets.some((x) => dayIn(x.started_at, tz) <= today);
    const strength = trains ? strengthScore({
      days: new Set(week.filter((x) => Number(x.n) > 0).map((x) => dayIn(x.started_at, tz))).size,
      sets: muscleSets(week.filter((x) => x.primary_muscles).map((x) => ({ primary: x.primary_muscles, secondary: x.secondary_muscles ?? [], sets: Number(x.n) }))),
    }) : null;

    return { scores: {
      from, to: today, age,
      sleep: sleepScore(ns, age),
      activity: activityScore({ moderate, vigorous, minutesDays: hrDates.size, activityMin, activityMinOffHr, stepDays: steps }, age),
      strength,
    } };
  });

  // Training load over the days [from, to] (YYYY-MM-DD) for Stats: each session's load from the 28 days before `from`
  // on, and the 4-week comparison as of `to`. null while the Training load feature is off. tz: the app's calendar
  r.get("/health/load", async (ctx, _p, _b, qs) => {
    const from = dateStr(qs.from), to = dateStr(qs.to);
    if (!from || !to || to < from) throw bad("Pick a range");
    return { load: await trainingLoad(ctx, from, to, tzOf(qs)) };
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
          d.value AS d_value, d.source AS d_source, d.typed AS d_typed, d.synced AS d_synced, d.worn AS d_worn, bm.value AS w_value, bm.measured_at,
          a.id AS a_id, a.type AS a_type, a.name AS a_name, coalesce(a.started_at, w.started_at) AS started_at, a.duration_s, a.distance_m, a.steps AS a_steps, a.avg_hr, a.route IS NOT NULL AS a_has_route,
          h.linked, w.id AS w_id, w.name AS w_name, w.ended_at AS w_ended_at, w.paused_s AS w_paused_s, a.source AS a_source,
          -- a linked workout's sets and volume, as History shows them
          CASE WHEN w.id IS NOT NULL THEN ${SET_COUNT_SQL} END AS w_sets, CASE WHEN w.id IS NOT NULL THEN ${VOLUME_SQL} END AS w_volume,
          to_char(coalesce(h.date, (coalesce(bm.measured_at, a.started_at, w.started_at) AT TIME ZONE 'UTC' - $1::float8 * interval '1 minute')::date), 'YYYY-MM-DD') AS day,
          coalesce(bm.measured_at, a.started_at, w.started_at, ((h.date + 1)::timestamp AT TIME ZONE 'UTC') + $1::float8 * interval '1 minute' - interval '1 millisecond') AS sort_at
        FROM health_imports h
        LEFT JOIN daily_logs d ON h.kind NOT IN ('weight', 'body_fat', 'activity') AND d.user_id = h.user_id AND d.date = h.date
          AND d.kind = ${DAILY_CASE}
        LEFT JOIN body_metrics bm ON h.kind IN ('weight', 'body_fat') AND bm.id::text = h.ref
        LEFT JOIN activities a ON h.kind = 'activity' AND h.linked IS DISTINCT FROM 'workout' AND a.id::text = h.ref
        -- a session linked to a workout done in Motus (bandMatch): listed as matched to it
        LEFT JOIN workouts w ON h.kind = 'activity' AND h.linked = 'workout' AND w.id::text = h.ref
        WHERE h.deleted_at IS NULL AND (d.date IS NOT NULL OR bm.id IS NOT NULL OR a.id IS NOT NULL OR w.id IS NOT NULL)
          -- one session brought in by two apps is one activity, listed once (the first key); a session linked to a
          -- Motus record is its own row (each can be unlinked on its own), never merged with another linked to it
          AND NOT (h.kind = 'activity' AND h.linked IS NULL AND EXISTS (SELECT 1 FROM health_imports o
            WHERE o.kind = 'activity' AND o.ref = h.ref AND o.linked IS NULL AND o.deleted_at IS NULL AND o.key < h.key))
      ) x ${after ? "WHERE (sort_at, key) < ($2::timestamptz, $3::text)" : ""}
      ORDER BY sort_at DESC, key DESC LIMIT ${limit + 1}`, after ? [tz, cAt, cKey] : [tz]);
    const page = rows.slice(0, limit);
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    const num = (v: unknown) => (v == null ? null : Number(v));
    // the walks' steps on the page's steps days: a synced count less than them doesn't count (daySteps), as in the daily log
    const stepDays = page.filter((x: any) => x.kind === "steps" && x.d_synced != null).map((x: any) => x.day as string).sort();
    const walked = new Map<string, number>();
    if (stepDays.length) {
      const next = new Date(Date.parse(stepDays.at(-1)! + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
      for (const d of await stepsByDay(ctx.q, stepDays[0]!, next, tz)) walked.set(d.date, d.walked);
    }
    const items = page.map((x: any) => ({
      key: x.key as string, kind: x.kind as Kind, date: x.day as string,
      at: iso(x.measured_at ?? x.started_at),
      // a day's number: the synced one (also when the day uses a typed one), else (typed over before 039 kept both) the day's
      value: x.kind === "activity" ? null : num(isBody(x.kind) ? x.w_value : x.d_synced ?? x.d_value),
      // a day's synced value that the day doesn't use: the typed one it uses instead, for "Typed … used"
      typed: isDaily(x.kind) && x.d_source !== HEALTH_SOURCE && x.d_synced != null ? num(x.d_typed) : null,
      // steps whose synced count is less than the day's walks in Motus: the walks' total, which counts instead (daySteps);
      // using the synced count then changes nothing, so it isn't offered
      walks: x.kind === "steps" && x.d_synced != null && daySteps(num(x.d_synced), false, walked.get(x.day) ?? 0).from === "walks" ? walked.get(x.day)! : null,
      // a session linked to a workout or activity recorded in Motus ("Matched to your workout"): opens that record, Unlink undoes it
      linked: (x.linked ?? null) as "activity" | "workout" | null,
      workout: x.w_id ? { id: x.w_id as string, name: (x.w_name ?? "") as string, startedAt: iso(x.started_at), setCount: Number(x.w_sets ?? 0), volumeKg: Number(x.w_volume ?? 0),
        durationS: x.w_ended_at ? Math.max(0, Math.round((Date.parse(iso(x.w_ended_at)!) - Date.parse(iso(x.started_at)!)) / 1000) - Number(x.w_paused_s ?? 0)) : 0 } : null,
      activity: x.a_id ? { id: x.a_id, type: x.a_type, name: x.a_name ?? "", startedAt: iso(x.started_at), durationS: num(x.duration_s), distanceM: num(x.distance_m), steps: num(x.a_steps), avgHr: num(x.avg_hr), source: (x.a_source ?? null) as string | null, hasRoute: !!x.a_has_route } : null,
      ref: x.ref as string | null,
      // a day's number typed over before 039 kept both (its synced value isn't known); a reading or session can't tell
      edited: isDaily(x.kind) ? x.d_source !== HEALTH_SOURCE && x.d_synced == null : false,
      importedAt: iso(x.imported_at),
      // a day's number: false when no band, watch or ring counted it (036), so it is named as from Health Connect
      worn: isDaily(x.kind) ? x.d_worn !== false : null,
    }));
    const last: any = rows.length > limit ? page.at(-1) : null;
    return { items, cursor: last ? `${last.sort_text}|${last.key}` : null };
  });

  // a day's number (steps, sleep, resting heart rate, SpO2, HRV, water, VO2 max...) set by hand from the log is typed
  // ("manual"): the day uses it, and later syncs keep the synced one beside it; a weight or body fat reading is corrected in place
  r.put("/health/imports/:key", async (ctx, p, b) => {
    const h = await entry(ctx, p.key!);
    if (!h || !h.there) throw notFound("This import is gone");
    if (h.kind === "activity") throw bad("Edit the activity itself");
    if (isDaily(h.kind)) {
      const v = dailyValue(h.kind, b.value);
      if (v == null) throw bad("Enter a value");
      await setTyped(ctx, h.date!, DAILY_KIND[h.kind], v);
    } else {
      const v = bodyValue(h.kind as Body, b.value);
      if (v == null) throw bad("Enter a value");
      await ctx.q.query("UPDATE body_metrics SET value = $2 WHERE id::text = $1", [h.ref, v]);
    }
    ctx.changed("health");
    return { ok: true };
  });

  // deletes what it became and keeps the key, marked deleted, so the next sync doesn't bring it back. A day's number:
  // marking it takes the synced value out (and the night's detail with a day's sleep), a typed one stays (039)
  r.del("/health/imports/:key", async (ctx, p) => {
    // first, before any row: marking the key deleted takes the records lock (041's trigger), and afterRecords holds that
    // lock while writing these rows, so taking it after them could wait on each other in opposite orders
    await lockRecords(ctx.q, ctx.userId);
    const h = await entry(ctx, p.key!);
    if (!h) throw notFound("This import is gone");
    // a session linked to a workout or activity recorded in Motus (Remove band entry): only the band's entry goes, with
    // the figures it filled in, never the person's record
    if (h.linked) await release(ctx, p.key!, { remove: true });
    else {
      if (!isDaily(h.kind)) await ctx.q.query(`DELETE FROM ${isBody(h.kind) ? "body_metrics" : "activities"} WHERE id::text = $1`, [h.ref]);
      await forget(ctx, p.key!);
    }
    ctx.changed("health");
    return { ok: true };
  });

  // a session linked to a workout or activity recorded in Motus becomes its own activity again (Imported data → Unlink):
  // this key lets go of it (another app's copy of the session, or another session, linked to the same record stays) and
  // stays apart from matching, the figures it filled in are taken back, and the phone's next read brings the session in
  // as an activity (as a restore: restored_at, so it is listed as coming with the next sync until then)
  r.post("/health/imports/:key/unlink", async (ctx, p) => {
    const h = await entry(ctx, p.key!);
    if (!h || !h.linked) throw notFound("This import is gone");
    await release(ctx, p.key!, { apart: true });
    ctx.changed("health");
    return { ok: true };
  });

  // the day's synced value is the one it uses (Imported data → Use this value)
  r.post("/health/imports/:key/use", async (ctx, p) => {
    const h = await entry(ctx, p.key!);
    if (!h || !h.there || !isDaily(h.kind)) throw notFound("This import is gone");
    await ctx.q.query("UPDATE daily_logs SET chosen = 'synced' WHERE date = $1 AND kind = $2", [h.date, DAILY_KIND[h.kind]]);
    ctx.changed("health");
    return { ok: true };
  });

  // What the person deleted from the import log (or deleted elsewhere), newest first, so a deletion can be taken back. A
  // day keeps its day; a reading or session its kind only (its data is gone). Also what was restored and isn't back yet
  // (restored: true, with no deletedAt), so it doesn't vanish from both lists until the phone's next read brings it.
  r.get("/health/imports/deleted", async (ctx, _p, _b, qs) => {
    const limit = intOrNull(qs.limit, 1, 500) ?? 200;
    const { rows } = await ctx.q.query(
      `SELECT key, kind, to_char(date, 'YYYY-MM-DD') AS date, deleted_at FROM health_imports h
       WHERE deleted_at IS NOT NULL OR (restored_at IS NOT NULL AND NOT CASE
         WHEN h.kind IN ('weight', 'body_fat') THEN EXISTS (SELECT 1 FROM body_metrics bm WHERE bm.id::text = h.ref)
         WHEN h.kind = 'activity' AND h.linked = 'workout' THEN EXISTS (SELECT 1 FROM workouts w WHERE w.id::text = h.ref)
         WHEN h.kind = 'activity' THEN EXISTS (SELECT 1 FROM activities a WHERE a.id::text = h.ref)
         ELSE EXISTS (SELECT 1 FROM daily_logs d WHERE d.date = h.date AND d.kind = ${DAILY_CASE} AND d.synced IS NOT NULL) END)
       ORDER BY coalesce(deleted_at, restored_at) DESC, key LIMIT ${limit}`);
    return { items: rows.map((x: any) => ({ key: x.key as string, kind: x.kind as Kind, date: x.date as string | null,
      deletedAt: x.deleted_at == null ? null : new Date(x.deleted_at).toISOString(), restored: x.deleted_at == null })) };
  });
  // takes a deletion back: the next read of Health Connect imports it again (restored_at wins over a copy still holding the
  // deletion, sync/core overrule). A reading's or session's row is gone, so its entry lets go of it (ref): that read makes
  // a new one, instead of taking the entry as already in.
  r.post("/health/imports/:key/restore", async (ctx, p) => {
    const { rows } = await ctx.q.query(
      "UPDATE health_imports SET deleted_at = NULL, restored_at = now(), ref = NULL, linked = NULL WHERE key = $1 AND deleted_at IS NOT NULL RETURNING 1", [p.key]);
    if (!rows.length) throw notFound("Nothing to restore");
    ctx.changed("health");
    return { ok: true };
  });
}
