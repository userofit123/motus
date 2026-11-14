// Health Connect (Android): what other apps on the phone recorded (a band through Gadgetbridge, a scale, a watch) comes
// in here. The Android app reads Health Connect and sends one batch; the engine decides what to keep, so the rules hold
// for a local account and for a server account's copy on the phone alike.
// - Daily steps and sleep go into the daily log as source "health_connect". A value typed in by hand stays: the person's
//   own number wins over a device's (as for steps, PLAN.md decision M-155).
// - Weight goes into the body log once: by its Health Connect id, or (from an app that doesn't send one) a reading
//   already logged at the same minute is the same reading.
// - Exercise sessions become activities keyed by their Health Connect id, so a second sync never adds them twice and an
//   activity edited in Motus keeps the edits.
// Everything brought in is noted in health_imports (027), the import log the person can edit and delete from. A deletion
// sticks: from the log, or of the data itself anywhere else in the app, the key is never imported again.
import type { Router, Ctx } from "../router";
import { dateStr, isoTime, numOrNull, intOrNull, str, tzOf } from "../util";
import { uuidv7 } from "../ids";
import { bad, notFound } from "../errors";
import { ensureTypes, saveActivity } from "./activities";

export const HEALTH_SOURCE = "health_connect";
type Kind = "steps" | "sleep" | "weight" | "activity";
const DAILY_KIND: Record<"steps" | "sleep", string> = { steps: "steps", sleep: "sleep_h" };
const isDaily = (k: string): k is "steps" | "sleep" => k === "steps" || k === "sleep";
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
    : (await ctx.q.query(`SELECT 1 FROM ${h.kind === "weight" ? "body_metrics" : "activities"} WHERE id::text = $1`, [h.ref])).rows.length > 0;
  return { ...h, there };
}

export function healthRoutes(r: Router) {
  r.post("/health/import", async (ctx, _p, b) => {
    const list = (v: unknown, max: number): any[] => (Array.isArray(v) ? v.slice(0, max) : []);
    const out = { steps: 0, sleep: 0, weight: 0, activities: 0 };
    let touched = false; // the log changed (a row noted or marked deleted), even when no number did

    const imps = new Map<string, Imp>((await ctx.q.query("SELECT key, kind, to_char(date, 'YYYY-MM-DD') AS date, ref, deleted_at IS NOT NULL AS deleted FROM health_imports")).rows
      .map((x: any) => [x.key, { kind: x.kind, date: x.date, ref: x.ref, deleted: x.deleted }]));
    // what the log's rows became, as it is now (missing: the person deleted it elsewhere in the app)
    const daily = new Map<string, string>((await ctx.q.query("SELECT kind || ':' || to_char(date, 'YYYY-MM-DD') AS k, source FROM daily_logs WHERE kind IN ('steps', 'sleep_h')")).rows
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
    const day = async (kind: "steps" | "sleep", date: unknown, value: number | null) => {
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

    for (const e of list(b.weight, 1000)) {
      const kg = numOrNull(e?.kg, 1, 700);
      if (kg == null || !e?.at) continue;
      const at = isoTime(e.at);
      const id = e.id != null ? str(String(e.id), 100) : "";
      // an app without record ids keys a reading by its time; with ids, that older key still counts as the same reading
      const key = id ? `weight:${id}` : `weight:${at}`, legacy = imps.get(`weight:${at}`);
      const h = imps.get(key);
      if (!(await open(key, !!h?.ref && alive.has(h.ref))) || h) continue;
      if (id && legacy?.deleted) continue;
      const same = (await ctx.q.query("SELECT id::text AS id FROM body_metrics WHERE kind = 'weight' AND measured_at BETWEEN $1::timestamptz - interval '1 minute' AND $1::timestamptz + interval '1 minute' LIMIT 1", [at])).rows[0];
      let ref: string | null = same?.id ?? null;
      if (ref) {
        // already in the log under another key (sent without an id before): one entry per reading
        if ([...imps.values()].some((x) => x.ref === ref && !x.deleted)) continue;
      } else {
        ref = uuidv7();
        await ctx.q.query("INSERT INTO body_metrics (id, user_id, kind, value, measured_at) VALUES ($1,$2,'weight',$3,$4)", [ref, ctx.userId, Math.round(kg * 100) / 100, at]);
        out.weight++;
      }
      await remember(ctx, key, "weight", null, ref);
      imps.set(key, { kind: "weight", date: null, ref, deleted: false });
      alive.add(ref);
      touched = true;
    }

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

    if (touched || out.steps || out.sleep || out.weight || out.activities) ctx.changed("health");
    return out;
  });

  // The import log, newest first. A day's steps and sleep sort at the end of their day, above that day's readings.
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
        LEFT JOIN daily_logs d ON h.kind IN ('steps', 'sleep') AND d.user_id = h.user_id AND d.date = h.date
          AND d.kind = CASE h.kind WHEN 'steps' THEN 'steps' ELSE 'sleep_h' END
        LEFT JOIN body_metrics bm ON h.kind = 'weight' AND bm.id::text = h.ref
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
      value: x.kind === "activity" ? null : num(x.kind === "weight" ? x.w_value : x.d_value),
      activity: x.a_id ? { id: x.a_id, type: x.a_type, name: x.a_name ?? "", startedAt: iso(x.started_at), durationS: num(x.duration_s), distanceM: num(x.distance_m), steps: num(x.a_steps), avgHr: num(x.avg_hr) } : null,
      ref: x.ref as string | null,
      // a day's number changed by hand since (it then stays as typed); a reading or session can't tell
      edited: isDaily(x.kind) ? x.d_source !== HEALTH_SOURCE : false,
      importedAt: iso(x.imported_at),
    }));
    const last: any = rows.length > limit ? page.at(-1) : null;
    return { items, cursor: last ? `${last.sort_text}|${last.key}` : null };
  });

  // a day's steps or sleep set by hand from the log is typed ("manual"): later syncs keep it; a weight is corrected in place
  r.put("/health/imports/:key", async (ctx, p, b) => {
    const h = await entry(ctx, p.key!);
    if (!h || !h.there) throw notFound("This import is gone");
    if (h.kind === "activity") throw bad("Edit the activity itself");
    if (isDaily(h.kind)) {
      const v = h.kind === "steps" ? intOrNull(b.value, 0, 1e6) : numOrNull(b.value, 0, 24);
      if (v == null) throw bad("Enter a value");
      await ctx.q.query(
        `INSERT INTO daily_logs (user_id, date, kind, value, source) VALUES ($1,$2,$3,$4,'manual') ON CONFLICT (user_id, date, kind) DO UPDATE SET value = $4, source = 'manual'`,
        [ctx.userId, h.date, DAILY_KIND[h.kind], h.kind === "sleep" ? Math.round(v * 10) / 10 : v]);
    } else {
      const kg = numOrNull(b.value, 1, 700);
      if (kg == null) throw bad("Enter a value");
      await ctx.q.query("UPDATE body_metrics SET value = $2 WHERE id::text = $1", [h.ref, Math.round(kg * 100) / 100]);
    }
    ctx.changed("health");
    return { ok: true };
  });

  // deletes what it became and keeps the key, marked deleted, so the next sync doesn't bring it back
  r.del("/health/imports/:key", async (ctx, p) => {
    const h = await entry(ctx, p.key!);
    if (!h) throw notFound("This import is gone");
    if (isDaily(h.kind)) await ctx.q.query("DELETE FROM daily_logs WHERE date = $1 AND kind = $2", [h.date, DAILY_KIND[h.kind]]);
    else await ctx.q.query(`DELETE FROM ${h.kind === "weight" ? "body_metrics" : "activities"} WHERE id::text = $1`, [h.ref]);
    await forget(ctx, p.key!);
    ctx.changed("health");
    return { ok: true };
  });
}
