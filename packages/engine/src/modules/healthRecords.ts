// Every Health Connect record as Health Connect has it (M-238; storage and why in migration 040). The phone reads a
// stretch of time and sends every record of every kind it may read; this keeps them, by Health Connect's id, so a read
// again updates instead of duplicating, and a record no longer there (or reported deleted) is deleted here.
// The daily log, nights and activities stay what they are (modules/health.ts); these are the readings behind them, for
// a day's records and an hourly rollup on the Sleep, Steps and Heart pages.
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { bad } from "../errors";
import { dateStr, tzOf } from "../util";
import { RECORD_TYPES } from "../migrations/040_health_records";

export type RecordType = (typeof RECORD_TYPES)[number];
const isType = (t: unknown): t is RecordType => typeof t === "string" && (RECORD_TYPES as readonly string[]).includes(t);
/** What a record of each type holds besides its times: an amount over its time, heart rate samples, sleep stages, a session, or one reading. */
const SHAPE: Record<RecordType, "sum" | "series" | "sleep" | "session" | "instant"> = {
  steps: "sum", distance: "sum", active_kcal: "sum", floors: "sum", elevation: "sum", hydration: "sum",
  heart_rate: "series", sleep: "sleep", exercise: "session",
  resting_hr: "instant", spo2: "instant", hrv: "instant", resp_rate: "instant", vo2max: "instant", weight: "instant", body_fat: "instant",
};
/**
 * The import log's key that covers a record (027): a day's number for kinds the daily log has, the record itself for
 * readings and sessions. A deleted key keeps the record out (migration 040 deletes what was there); none: no key.
 */
const LOG_KIND: Partial<Record<RecordType, string>> = {
  steps: "steps", distance: "distance", active_kcal: "active_kcal", sleep: "sleep", resting_hr: "resting_hr", spo2: "spo2", hrv: "hrv",
  hydration: "water", vo2max: "vo2max", weight: "weight", body_fat: "body_fat", exercise: "activity",
};
const BY_ID = new Set<RecordType>(["weight", "body_fat", "exercise"]);
const logKey = (t: RecordType, id: string, day: string) => (LOG_KIND[t] ? `${LOG_KIND[t]}:${BY_ID.has(t) ? id : day}` : null);

/**
 * A record as stored (the block's value under its id), as the phone sends it: s start or the reading's time and e end
 * (unix seconds), z the zone offset it was written with (seconds), o the app that wrote it, dv the device (type as
 * Health Connect numbers it, maker, model), m last modified (unix ms), and by shape: v the amount or reading (steps,
 * metres, kcal, floors, metres climbed, ml, bpm, %, ms, breaths a minute, VO2 max, kg, %), p heart rate samples
 * [[unix seconds, bpm]], st sleep stages [[start, end, stage]] (stage as Health Connect numbers it), x the exercise
 * type (Health Connect's number), t a title. src: the phone (an id it made when Motus was installed) that last sent it:
 * only that phone may take it out for no longer being in its reads (saveRecords).
 */
export interface Rec {
  s: number; e?: number; z: number; o: string; dv?: { type?: number; maker?: string; model?: string }; m: number;
  v?: number; p?: [number, number][]; st?: [number, number, number][]; x?: number; t?: string; src?: string;
}
type Raw = Record<string, unknown>;
// MAX_SAMPLES: one a second over the longest record taken (7 days), so a heart rate record is kept as it is; one with
// more can't be a real one and is left out whole rather than cut short
const MAX_PER_TYPE = 20000, MAX_SAMPLES = 7 * 86400, MAX_STAGES = 500;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const nums = (q: unknown, n: number): q is number[] => Array.isArray(q) && q.length >= n && q.slice(0, n).every(fin);
const text = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : undefined);
// a time Motus could have: from 1990 to a day from now
const okTime = (t: number) => t > 631152000 && t < Date.now() / 1000 + 86400;

/** A record as the phone sent it, checked and kept as it is; null when it can't be one (no id, no time, end before start). */
export function cleanRecord(type: RecordType, x: unknown, zone: number): { id: string; rec: Rec } | null {
  if (!isObj(x)) return null;
  const id = text(x.id, 100);
  if (!id || !fin(x.s) || !okTime(x.s)) return null;
  const shape = SHAPE[type];
  const rec: Rec = { s: Math.round(x.s), z: fin(x.z) && Math.abs(x.z) <= 18 * 3600 ? Math.round(x.z) : zone, o: text(x.o, 200) ?? "", m: fin(x.m) ? Math.round(x.m) : 0 };
  if (shape !== "instant") {
    if (!fin(x.e) || x.e < x.s || x.e - x.s > 7 * 86400) return null;
    rec.e = Math.round(x.e);
  }
  if (isObj(x.dv)) {
    const dv = { type: fin(x.dv.type) ? x.dv.type : undefined, maker: text(x.dv.maker, 100), model: text(x.dv.model, 100) };
    if (dv.type != null || dv.maker || dv.model) rec.dv = JSON.parse(JSON.stringify(dv));
  }
  if (shape === "sum" || shape === "instant") {
    if (!fin(x.v)) return null;
    rec.v = x.v;
  } else if (shape === "series") {
    if (!Array.isArray(x.p) || x.p.length > MAX_SAMPLES) return null;
    rec.p = (x.p as unknown[]).filter((q) => nums(q, 2)).map((q) => { const [t, b] = q as number[]; return [Math.round(t!), Math.round(b!)] as [number, number]; });
  } else if (shape === "sleep") {
    rec.st = (Array.isArray(x.st) ? (x.st as unknown[]) : []).slice(0, MAX_STAGES)
      .filter((q) => nums(q, 3) && q[1]! >= q[0]!).map((q) => { const [a, b, k] = q as number[]; return [Math.round(a!), Math.round(b!), Math.round(k!)] as [number, number, number]; });
  }
  if (shape === "session" && fin(x.x)) rec.x = Math.round(x.x);
  const t = text(x.t, 200);
  if (t && (shape === "sleep" || shape === "session")) rec.t = t;
  return { id, rec };
}

/** The record's own calendar day (YYYY-MM-DD): of its start in its own zone, or of its end for sleep (the wake-up day). */
export const recordDay = (type: RecordType, r: Rec) => new Date(((type === "sleep" ? r.e ?? r.s : r.s) + r.z) * 1000).toISOString().slice(0, 10);
const shiftDay = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
// the same record with its keys in one order, to tell a changed one from one sent again (jsonb keeps its own key order)
const stable = (v: unknown): string => (Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : isObj(v) ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
  : JSON.stringify(v));
// what Health Connect holds, without who sent it: the same record from another phone is not a change
const same = (a: Rec, b: Rec) => stable({ ...a, src: undefined }) === stable({ ...b, src: undefined });
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as Record<string, Rec>;
const secs = (v: unknown, what: string) => {
  const t = Date.parse(String(v ?? ""));
  if (!Number.isFinite(t)) throw bad(`Invalid ${what}`);
  return t / 1000;
};

/**
 * One person's records are changed one save at a time (a transaction lock, also taken by migration 041's trigger when
 * an import log key is deleted): saveRecords reads blocks, merges and writes them back, so two at once would lose one's
 * records, or bring back what a deletion took meanwhile.
 */
export const lockRecords = (q: Sql, userId: string) => q.query("SELECT pg_advisory_xact_lock(hashtext('health_records:' || $1::uuid::text))", [userId]);

interface BlockRow { day: string; recs: unknown }
/**
 * The blocks of one type that may hold records of [fromS, toS) (a zone up to 14 hours away, a night ending the next day),
 * and those elsewhere holding any of alsoIds (a record moved to another day), looked up only for ids not found here.
 */
async function blocks(ctx: Ctx, type: RecordType, fromS: number, toS: number, alsoIds: string[] = []) {
  const a = shiftDay(new Date(fromS * 1000).toISOString().slice(0, 10), -2), b = shiftDay(new Date(toS * 1000).toISOString().slice(0, 10), 1);
  const { rows } = await ctx.q.query<BlockRow>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, recs FROM health_records WHERE type = $1 AND day >= $2::date AND day <= $3::date", [type, a, b]);
  const out = new Map<string, Record<string, Rec>>(rows.map((x) => [x.day, parse(x.recs)]));
  const found = new Set<string>();
  for (const recs of out.values()) for (const id of Object.keys(recs)) found.add(id);
  const missing = alsoIds.filter((id) => !found.has(id));
  if (missing.length)
    for (const x of (await ctx.q.query<BlockRow>(
      "SELECT to_char(day, 'YYYY-MM-DD') AS day, recs FROM health_records WHERE type = $1 AND ids && $2::text[] AND NOT (day >= $3::date AND day <= $4::date)",
      [type, missing, a, b])).rows) out.set(x.day, parse(x.recs));
  return out;
}
const writeBlock = (ctx: Ctx, type: RecordType, day: string, recs: Record<string, Rec>) => Object.keys(recs).length
  ? ctx.q.query(
    `INSERT INTO health_records (user_id, type, day, recs, ids, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id, type, day) DO UPDATE SET recs = EXCLUDED.recs, ids = EXCLUDED.ids, updated_at = now()`,
    [ctx.userId, type, day, JSON.stringify(recs), Object.keys(recs)])
  : ctx.q.query("DELETE FROM health_records WHERE type = $1 AND day = $2::date", [type, day]);

/**
 * Saves what the phone read of one type over [fromS, toS): new and changed records go in, by id (a record moved to
 * another day leaves its old one); complete: the phone read every record of the stretch, so one it sent before (source,
 * the same phone) and no longer has was deleted in Health Connect and goes here too. Another phone's records stay: it
 * may hold what this one never had (a phone without past data allowed, a new one, Motus installed again); a deletion
 * there reaches here through its own changes list (POST deleted). A record whose import log key is deleted stays out.
 * Runs under lockRecords.
 */
export async function saveRecords(ctx: Ctx, type: RecordType, fromS: number, toS: number, sent: { id: string; rec: Rec }[], complete: boolean, deletedKeys: Set<string>, source?: string) {
  const out = { saved: 0, removed: 0 };
  if (source) for (const x of sent) x.rec.src = source;
  const keep = sent.filter((x) => { const k = logKey(type, x.id, recordDay(type, x.rec)); return !k || !deletedKeys.has(k); });
  const have = await blocks(ctx, type, fromS, toS, keep.map((x) => x.id));
  const where = new Map<string, string>();
  for (const [day, recs] of have) for (const id of Object.keys(recs)) where.set(id, day);
  const dirty = new Set<string>();
  const incoming = new Set(sent.map((x) => x.id));
  if (complete && source)
    for (const [day, recs] of have) for (const [id, r] of Object.entries(recs))
      if (r.src === source && r.s >= fromS && r.s < toS && !incoming.has(id)) { delete recs[id]; where.delete(id); dirty.add(day); out.removed++; }
  for (const { id, rec } of keep) {
    const day = recordDay(type, rec), was = where.get(id), old = was ? have.get(was)![id] : undefined;
    if (old && (same(old, rec) || (old.m && rec.m && old.m > rec.m))) continue;
    if (was && was !== day) { delete have.get(was)![id]; dirty.add(was); }
    (have.get(day) ?? have.set(day, {}).get(day)!)[id] = rec;
    where.set(id, day); dirty.add(day); out.saved++;
  }
  for (const day of dirty) await writeBlock(ctx, type, day, have.get(day)!);
  return out;
}

/** A record as the API hands it out. */
const view = (type: RecordType, id: string, r: Rec, fromS = -Infinity, toS = Infinity) => ({
  id, type, start: new Date(r.s * 1000).toISOString(), ...(r.e != null ? { end: new Date(r.e * 1000).toISOString() } : {}),
  ...(r.v != null ? { value: r.v } : {}),
  // a heart rate record's samples inside the asked time only (a record can run for hours on either side)
  ...(r.p ? { samples: r.p.filter((q) => q[0] >= fromS && q[0] < toS) } : {}),
  ...(r.st ? { stages: r.st } : {}), ...(r.x != null ? { exerciseType: r.x } : {}), ...(r.t ? { title: r.t } : {}),
  origin: r.o, ...(r.dv ? { device: r.dv } : {}), zoneOffset: r.z, modified: r.m ? new Date(r.m).toISOString() : null,
});
const overlaps = (r: Rec, fromS: number, toS: number) => r.s < toS && (r.e ?? r.s) >= fromS && (r.e == null || r.e > fromS || r.e === r.s);

export interface Hour { at: string; n: number; sum?: number; min?: number; max?: number; avg?: number; stages?: Record<string, number> }
/**
 * The offset from UTC (seconds) at a time: of a fixed one (minutes behind UTC, as getTimezoneOffset), or of an IANA zone
 * ("Europe/Berlin"), which changes over the year (daylight saving time), looked up per quarter hour (zones change on one).
 */
export function offsetFn(zone: string | number): (t: number) => number {
  if (typeof zone === "number") return () => -zone * 60;
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const seen = new Map<number, number>();
  return (t) => {
    const q = Math.floor(t / 900) * 900, got = seen.get(q);
    if (got != null) return got;
    const p: Record<string, number> = {};
    for (const x of f.formatToParts(new Date(q * 1000))) if (x.type !== "literal") p[x.type] = Number(x.value);
    const off = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) / 1000 - q;
    seen.set(q, off);
    return off;
  };
}
const isZone = (z: unknown): z is string => {
  if (typeof z !== "string" || !z || z.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; }
};

/**
 * One type's records over [fromS, toS) by hour of the app's calendar (zone: an IANA zone, so a day with a clock change
 * is right, or minutes behind UTC as getTimezoneOffset):
 * amounts (steps, distance, calories, floors, climb, water) shared out over the hours by how much of each record's time
 * falls in them; heart rate samples and readings as lowest, highest and average; sleep as minutes of each stage
 * (a night without stages as "2", asleep, as Health Connect numbers it); sessions as minutes. Hours without data are left out.
 */
export function hourly(type: RecordType, recs: Rec[], fromS: number, toS: number, zone: string | number): Hour[] {
  const offAt = offsetFn(zone), hourOf = (t: number) => { const off = offAt(t); return Math.floor((t + off) / 3600) * 3600 - off; };
  const hours = new Map<number, Hour & { total?: number }>();
  const at = (h: number) => hours.get(h) ?? hours.set(h, { at: new Date(h * 1000).toISOString(), n: 0 }).get(h)!;
  const spread = (a: number, b: number, f: (h: Hour, secsIn: number) => void) => {
    a = Math.max(a, fromS); b = Math.min(b, toS);
    // a quarter hour at a time (every zone's hours start on one), each in the hour of the calendar it falls in, so a
    // clock change of half an hour is right too; then once per hour
    const secsIn = new Map<number, number>();
    for (let q = a; q < b;) { const n = Math.min(b, Math.floor(q / 900) * 900 + 900), h = hourOf(q); secsIn.set(h, (secsIn.get(h) ?? 0) + n - q); q = n; }
    for (const [h, s] of secsIn) if (s > 0) f(at(h), s);
  };
  const point = (t: number, v: number) => {
    if (t < fromS || t >= toS) return;
    const h = at(hourOf(t));
    h.min = Math.min(h.min ?? v, v); h.max = Math.max(h.max ?? v, v); h.total = (h.total ?? 0) + v; h.n++;
  };
  const shape = SHAPE[type];
  for (const r of recs) {
    if (shape === "sum") {
      const e = r.e ?? r.s;
      if (e <= r.s) { if (r.s >= fromS && r.s < toS) { const h = at(hourOf(r.s)); h.sum = (h.sum ?? 0) + r.v!; h.n++; } continue; }
      spread(r.s, e, (h, s) => { h.sum = (h.sum ?? 0) + (r.v! * s) / (e - r.s); h.n++; });
    } else if (shape === "series") for (const [t, v] of r.p ?? []) point(t, v);
    else if (shape === "instant") point(r.s, r.v!);
    else if (shape === "sleep") {
      const st = r.st?.length ? r.st : [[r.s, r.e ?? r.s, 2] as [number, number, number]];
      for (const [a, b, k] of st) spread(a, b, (h, s) => { h.stages ??= {}; h.stages[k] = (h.stages[k] ?? 0) + s / 60; h.n++; });
    } else spread(r.s, r.e ?? r.s, (h, s) => { h.sum = (h.sum ?? 0) + s / 60; h.n++; });
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([, h]) => {
    const { total, ...x } = h;
    if (total != null) x.avg = round(total / x.n);
    if (x.sum != null) x.sum = round(x.sum);
    if (x.stages) for (const k of Object.keys(x.stages)) x.stages[k] = round(x.stages[k]!);
    return x;
  });
}

const typesOf = (v: unknown): RecordType[] => {
  const ts = String(v ?? "").split(",").filter(Boolean);
  if (!ts.length || !ts.every(isType)) throw bad("Pick a record type");
  return ts as RecordType[];
};
// at most this long a stretch per request: 40 days of minute heart rate is ~60k samples
const MAX_SPAN_S = 40 * 86400;
const span = (qs: Record<string, string>) => {
  const fromS = secs(qs.from, "start"), toS = secs(qs.to, "end");
  if (toS <= fromS || toS - fromS > MAX_SPAN_S) throw bad("Pick a shorter time");
  return { fromS, toS };
};

/** The kinds of the import log that hold records, and the record type of each (LOG_KIND the other way), in SQL (h: health_imports). */
const RECORD_KIND = `CASE h.kind ${Object.entries(LOG_KIND).map(([t, k]) => `WHEN '${k}' THEN '${t}'`).join(" ")} END`;
const KINDS_SQL = Object.values(LOG_KIND).map((k) => `'${k}'`).join(", ");

/**
 * A backup's block merged into one already here (a merge restore, modules/data.ts): records are added by id, one kept
 * here wins over the file's copy, and one kept here on another day stays there. 1 when it added any.
 */
export async function mergeBlock(q: Sql, userId: string, row: Raw): Promise<number> {
  if (!isType(row.type) || row.day == null) return 0;
  await lockRecords(q, userId);
  const recs = { ...parse(row.recs ?? {}) };
  const ids = Object.keys(recs);
  if (!ids.length) return 0;
  const { rows } = await q.query<{ i: string }>(
    "SELECT DISTINCT i FROM health_records, unnest(ids) i WHERE type = $1 AND ids && $2::text[] AND i = ANY($2::text[])",
    [row.type, ids]);
  for (const x of rows) delete recs[x.i];
  const add = Object.keys(recs);
  if (!add.length) return 0;
  await q.query(
    `INSERT INTO health_records (user_id, type, day, recs, ids, updated_at) VALUES ($1, $2, $3::date, $4::jsonb, $5::text[], coalesce($6::timestamptz, now()))
     ON CONFLICT (user_id, type, day) DO UPDATE SET recs = health_records.recs || EXCLUDED.recs, ids = health_records.ids || EXCLUDED.ids, updated_at = now()`,
    [userId, row.type, row.day, JSON.stringify(recs), add, row.updated_at ?? null]);
  return 1;
}

interface Sent { complete?: unknown; records?: unknown }
export function healthRecordRoutes(r: Router) {
  // { from, to: ISO times the phone read; tz?: minutes behind UTC (records without their own zone); source?: the
  //   phone's own id (saveRecords: only its own records are taken out for being missing from its reads);
  //   types: { [type]: { complete?: boolean, records: [...] } }; deleted?: Health Connect ids deleted there }
  r.post("/health/records", async (ctx, _p, b) => {
    const fromS = secs(b.from, "start"), toS = secs(b.to, "end");
    if (toS < fromS) throw bad("Invalid time");
    const zone = -tzOf({ tz: b.tz == null ? "" : String(b.tz) }) * 60;
    const source = text(b.source, 100);
    await lockRecords(ctx.q, ctx.userId);
    // read under the lock: a key deleted meanwhile has taken its records (the trigger waits for the lock) and is seen here
    const deletedKeys = new Set((await ctx.q.query<{ key: string }>("SELECT key FROM health_imports WHERE deleted_at IS NOT NULL")).rows.map((x) => x.key));
    const out = { saved: 0, removed: 0 };
    for (const [type, v] of Object.entries(isObj(b.types) ? (b.types as Record<string, Sent>) : {})) {
      if (!isType(type) || !isObj(v) || !Array.isArray(v.records)) continue;
      const list = v.records as unknown[];
      const sent = list.slice(0, MAX_PER_TYPE).map((x) => cleanRecord(type, x, zone)).filter((x): x is { id: string; rec: Rec } => !!x);
      // a list cut short (over the most per request) can't say what is missing
      const n = await saveRecords(ctx, type, fromS, toS, sent, v.complete === true && list.length <= MAX_PER_TYPE, deletedKeys, source);
      out.saved += n.saved; out.removed += n.removed;
    }
    const gone = (Array.isArray(b.deleted) ? (b.deleted as unknown[]) : []).filter((x): x is string => typeof x === "string" && !!x).slice(0, 10000);
    if (gone.length) {
      const n = Number((await ctx.q.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM health_records h, unnest(h.ids) i WHERE h.ids && $1::text[] AND i = ANY($1::text[])", [gone])).rows[0]!.n);
      if (n) {
        // blocks left with nothing go; only those holding the ids are touched (the ids index)
        await ctx.q.query("DELETE FROM health_records WHERE ids && $1::text[] AND ids <@ $1::text[]", [gone]);
        await ctx.q.query(
          `UPDATE health_records SET recs = recs - $1::text[], ids = ARRAY(SELECT unnest(ids) EXCEPT SELECT unnest($1::text[])), updated_at = now()
           WHERE ids && $1::text[]`, [gone]);
        out.removed += n;
      }
    }
    if (out.saved || out.removed) ctx.changed("readings");
    return out;
  });

  // What was taken back from the import log (restore, in the last 60 days) whose records aren't here: the phone reads
  // that stretch of Health Connect again (native/health.ts), once per restore (restoredAt). A day's number: the day
  // and the ones around it (any zone, the night before); a reading or session: once the import made its row again, the
  // day around its time. { items: [{ key, restoredAt, from, to }] }
  r.get("/health/records/waiting", async (ctx) => {
    const { rows } = await ctx.q.query<{ key: string; restored_at: Date | string; date: string | null; at: Date | string | null }>(
      `SELECT h.key, h.restored_at, to_char(h.date, 'YYYY-MM-DD') AS date, coalesce(bm.measured_at, a.started_at) AS at
       FROM health_imports h
       LEFT JOIN body_metrics bm ON h.kind IN ('weight', 'body_fat') AND bm.id::text = h.ref
       LEFT JOIN activities a ON h.kind = 'activity' AND a.id::text = h.ref
       WHERE h.deleted_at IS NULL AND h.restored_at > now() - interval '60 days' AND h.kind IN (${KINDS_SQL})
         AND (h.date IS NOT NULL OR bm.id IS NOT NULL OR a.id IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM health_records r WHERE r.type = ${RECORD_KIND} AND CASE WHEN h.kind IN ('weight', 'body_fat', 'activity')
           THEN r.ids @> ARRAY[substr(h.key, length(h.kind) + 2)] ELSE r.day = h.date END)
       ORDER BY h.restored_at DESC LIMIT 100`);
    const iso = (t: number) => new Date(t * 1000).toISOString();
    return { items: rows.map((x) => {
      const t = x.date ? Date.parse(x.date + "T00:00:00Z") / 1000 : new Date(x.at!).getTime() / 1000;
      return x.date ? { key: x.key, restoredAt: new Date(x.restored_at).toISOString(), from: iso(t - 86400), to: iso(t + 2 * 86400) }
        : { key: x.key, restoredAt: new Date(x.restored_at).toISOString(), from: iso(t - 86400), to: iso(t + 86400) };
    }) };
  });

  // The records of one or more types (type=heart_rate or type=steps,distance) overlapping [from, to) (ISO times; at
  // most 40 days), oldest first. A day's records on a page: from and to are its midnights.
  r.get("/health/records", async (ctx, _p, _b, qs) => {
    const { fromS, toS } = span(qs);
    const out: ReturnType<typeof view>[] = [];
    for (const type of typesOf(qs.type))
      for (const recs of (await blocks(ctx, type, fromS, toS)).values())
        for (const [id, rec] of Object.entries(recs)) if (overlaps(rec, fromS, toS)) out.push(view(type, id, rec, fromS, toS));
    return { records: out.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)) };
  });

  // One type's records over [from, to) by hour (hourly() says how); zone: the app's IANA zone (else tz: minutes behind UTC)
  r.get("/health/records/hourly", async (ctx, _p, _b, qs) => {
    const { fromS, toS } = span(qs);
    const [type] = typesOf(qs.type);
    const recs = [...(await blocks(ctx, type!, fromS, toS)).values()].flatMap((x) => Object.values(x)).filter((x) => overlaps(x, fromS, toS));
    return { type, hours: hourly(type!, recs, fromS, toS, isZone(qs.zone) ? qs.zone : tzOf(qs)) };
  });

  // Which days have records of which types, and how many (from, to: days, to not included), so screens offer only what
  // there is. Read from the blocks' id lists, not their records.
  r.get("/health/records/days", async (ctx, _p, _b, qs) => {
    const from = dateStr(qs.from) ?? "1970-01-01", to = dateStr(qs.to) ?? "9999-01-01";
    const { rows } = await ctx.q.query<{ day: string; type: string; n: number | string }>(
      "SELECT to_char(day, 'YYYY-MM-DD') AS day, type, cardinality(ids) AS n FROM health_records WHERE day >= $1::date AND day < $2::date ORDER BY day, type",
      [from, to]);
    const days = new Map<string, Record<string, number>>();
    for (const x of rows) (days.get(x.day) ?? days.set(x.day, {}).get(x.day)!)[x.type] = Number(x.n);
    return { days: [...days].map(([date, types]) => ({ date, types })) };
  });
}
