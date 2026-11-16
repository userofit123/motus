// A band session that is a workout or activity recorded in Motus (the band, or its app, saw the same exercise) is linked
// to that record, never a second activity beside it (M-250): its import log entry points at the Motus record (ref) and
// says which kind it is (linked, 046), so its time, steps and load count once in Stats, the scores and a day's steps.
// It is the session when at least 80% of it falls inside the record's time: a band session usually starts a little
// later and ends a little earlier than the workout timer, and a long workout may hold a short band session. Not both
// ways: a 20-minute walk logged in Motus inside a band's 2-hour hike is the hike's part, still the same exercise. A
// session of no length matches nothing (it has no time to fall inside anything).
// Both arrival orders: the import links a new session at once (health.ts), and this pass takes in sessions already
// brought in as activities when the Motus record came later (a workout finished, an activity saved or synced from
// another copy), deleting that imported activity.
// The person can unlink one (Imported data → Unlink, apart): it then comes in as its own activity and stays apart.
// The duplicates from before linking are cleaned up once over the whole history (linkHistory, 048), a batch per import
// or save, then each import or save links over its own time as before.
// Letting go (fix round 3): Unlink, deleting the Motus record (047's trigger) or changing its time so it no longer holds
// 80% of the session (releaseOutside) make the session its own activity again with the next read (restored_at), and
// the figures copied from it (copied) are taken back, so its steps don't count twice.
import type { Ctx } from "../router";
import { lockRecords } from "./healthDerive";

const HC = "health_connect";

/** The band's numbers for a session, already checked (bandNum); null where it had none. */
export interface BandFigures { steps: number | null; distanceM: number | null; calories: number | null; avgHr: number | null }

/**
 * The Motus workout or activity a band session falls inside (80% of the session), the one sharing the most time with it;
 * null when none, or the session has no length. s, e: ISO times.
 */
export async function motusRecordFor(ctx: Ctx, s: string, e: string): Promise<{ kind: "activity" | "workout"; id: string } | null> {
  const row = (await ctx.q.query<{ kind: "activity" | "workout"; id: string }>(
    `SELECT kind, id FROM (
       SELECT 'activity' AS kind, id::text AS id, started_at, ended_at FROM activities WHERE source <> $3 AND ended_at > started_at
       UNION ALL SELECT 'workout', id::text, started_at, ended_at FROM workouts WHERE status = 'completed' AND ended_at > started_at) m
     WHERE $2::timestamptz > $1::timestamptz AND started_at < $2::timestamptz AND ended_at > $1::timestamptz
       AND extract(epoch FROM least(ended_at, $2::timestamptz) - greatest(started_at, $1::timestamptz)) >= 0.8 * extract(epoch FROM $2::timestamptz - $1::timestamptz)
     ORDER BY least(ended_at, $2::timestamptz) - greatest(started_at, $1::timestamptz) DESC, kind, id LIMIT 1`, [s, e, HC])).rows[0];
  return row ?? null;
}

/** Which of the band's figures an entry filled in on a Motus activity, as stored (text), to take back on letting go. */
export type Copied = Partial<Record<"steps" | "distance_m" | "calories" | "avg_hr", string>>;
const FIELDS = ["steps", "distance_m", "calories", "avg_hr"] as const;

/**
 * What the band had and the Motus activity lacks (steps, distance, calories, heart rate) goes into it; a typed or
 * recorded number stays. A workout has no such columns: its heart rate comes from the band's readings (/health/ranges).
 * Returns what it filled in (for the entry's copied), null when nothing.
 */
export async function copyFigures(ctx: Ctx, kind: "activity" | "workout", id: string, f: BandFigures): Promise<Copied | null> {
  if (kind !== "activity") return null;
  type Row = Record<(typeof FIELDS)[number], string | number | null>;
  const before = (await ctx.q.query<Row>("SELECT steps, distance_m, calories, avg_hr FROM activities WHERE id::text = $1", [id])).rows[0];
  if (!before) return null;
  const after = (await ctx.q.query<Row>(
    `UPDATE activities SET steps_source = CASE WHEN steps IS NULL AND $2::int IS NOT NULL THEN 'band' ELSE steps_source END,
       steps = coalesce(steps, $2::int), distance_m = coalesce(distance_m, $3::numeric), calories = coalesce(calories, $4::int),
       avg_hr = coalesce(avg_hr, $5::int)
     WHERE id::text = $1 AND (steps IS NULL AND $2::int IS NOT NULL OR distance_m IS NULL AND $3::numeric IS NOT NULL
       OR calories IS NULL AND $4::int IS NOT NULL OR avg_hr IS NULL AND $5::int IS NOT NULL)
     RETURNING steps, distance_m, calories, avg_hr`,
    [id, f.steps == null ? null : Math.round(f.steps), f.distanceM, f.calories == null ? null : Math.round(f.calories), f.avgHr == null ? null : Math.round(f.avgHr)])).rows[0];
  if (!after) return null;
  const copied: Copied = {};
  for (const k of FIELDS) if (before[k] == null && after[k] != null) copied[k] = String(after[k]);
  return Object.keys(copied).length ? copied : null;
}

/** Takes back the figures an entry filled in on a Motus activity (copied), each only while it is still the same number. */
async function takeBack(ctx: Ctx, activityId: string, c: Copied) {
  await ctx.q.query(
    // as numbers, not text: "5000.0" and 5000 are the same distance
    `UPDATE activities SET steps_source = CASE WHEN steps = $2::int AND steps_source = 'band' THEN NULL ELSE steps_source END,
       steps = CASE WHEN steps = $2::int THEN NULL ELSE steps END, distance_m = CASE WHEN distance_m = $3::numeric THEN NULL ELSE distance_m END,
       calories = CASE WHEN calories = $4::int THEN NULL ELSE calories END, avg_hr = CASE WHEN avg_hr = $5::int THEN NULL ELSE avg_hr END
     WHERE id::text = $1`, [activityId, c.steps ?? null, c.distance_m ?? null, c.calories ?? null, c.avg_hr ?? null]);
}

/**
 * Lets go of a linked entry: the session becomes its own activity again with the phone's next read (restored_at, so
 * it is listed as coming until then), and the figures it filled in are taken back. apart: the person unlinked it, so
 * it is never matched again. remove: the person removed the band's entry (deleted, never comes back).
 */
export async function release(ctx: Ctx, key: string, o: { apart?: boolean; remove?: boolean } = {}) {
  const h = (await ctx.q.query<{ ref: string; linked: string; copied: Copied | null }>(
    "SELECT ref, linked, copied FROM health_imports WHERE key = $1 AND linked IS NOT NULL AND deleted_at IS NULL", [key])).rows[0];
  if (!h) return false;
  if (h.linked === "activity" && h.copied) {
    // a second app's copy of the same session still linked to the record: the figures stay while one is, and go with
    // it (its copied), so they are taken back only when the last linked copy lets go (fix round 4)
    const heir = (await ctx.q.query<{ key: string; copied: Copied | null }>(
      "SELECT key, copied FROM health_imports WHERE ref = $1 AND linked = $2 AND key <> $3 AND deleted_at IS NULL ORDER BY key LIMIT 1",
      [h.ref, h.linked, key])).rows[0];
    if (heir) await ctx.q.query("UPDATE health_imports SET copied = $2::jsonb WHERE key = $1", [heir.key, JSON.stringify({ ...h.copied, ...heir.copied })]);
    else await takeBack(ctx, h.ref, h.copied);
  }
  if (o.remove) await ctx.q.query("UPDATE health_imports SET copied = NULL, deleted_at = now() WHERE key = $1", [key]);
  else await ctx.q.query("UPDATE health_imports SET ref = NULL, linked = NULL, copied = NULL, restored_at = now(), apart = apart OR $2 WHERE key = $1", [key, !!o.apart]);
  return true;
}

/**
 * Lets go of linked entries whose Motus record is gone: deleted on another copy, where 047's trigger is skipped (sync),
 * so nothing let go of them there. key: only that entry; none: every one (the full-history pass). Returns how many.
 */
export async function releaseDangling(ctx: Ctx, key?: string): Promise<number> {
  const { rows } = await ctx.q.query<{ key: string }>(
    `SELECT h.key FROM health_imports h WHERE h.linked IS NOT NULL AND h.deleted_at IS NULL AND ($1::text IS NULL OR h.key = $1)
       AND NOT EXISTS (SELECT 1 FROM activities a WHERE h.linked = 'activity' AND a.id::text = h.ref)
       AND NOT EXISTS (SELECT 1 FROM workouts w WHERE h.linked = 'workout' AND w.id::text = h.ref)
     ORDER BY h.key`, [key ?? null]);
  for (const x of rows) await release(ctx, x.key);
  if (rows.length) ctx.changed("health");
  return rows.length;
}

/**
 * After a Motus record's time changed: the band sessions linked to it that it no longer holds 80% of are let go
 * (release). A session whose time isn't known stays. Returns how many.
 */
export async function releaseOutside(ctx: Ctx, kind: "activity" | "workout", id: string): Promise<number> {
  const rec = kind === "workout"
    ? "SELECT started_at, ended_at FROM workouts WHERE id::text = $1 AND status = 'completed'"
    : "SELECT started_at, ended_at FROM activities WHERE id::text = $1";
  const { rows } = await ctx.q.query<{ key: string }>(
    `SELECT h.key FROM health_imports h WHERE h.ref = $1 AND h.linked = $2 AND h.deleted_at IS NULL AND h.span_end > h.span_start
       AND NOT EXISTS (SELECT 1 FROM (${rec}) m WHERE m.ended_at > m.started_at
         AND extract(epoch FROM least(m.ended_at, h.span_end) - greatest(m.started_at, h.span_start)) >= 0.8 * extract(epoch FROM h.span_end - h.span_start))
     ORDER BY h.key`, [id, kind]);
  for (const x of rows) await release(ctx, x.key);
  if (rows.length) ctx.changed("health");
  return rows.length;
}

/**
 * Takes in band sessions already brought in as activities that fall inside a Motus workout or activity: their import log
 * entries now point at the Motus record, the record gets the numbers it lacked, and the imported activity is deleted.
 * The entries are moved first, so deleting the row doesn't mark them deleted (034's trigger goes by ref). Only sessions
 * overlapping from..to (the time just saved or imported), not the whole history on every save. An imported activity the
 * person edited (edited_at, 047) or unlinked (apart) stays their own. Returns how many.
 */
export async function linkBandSessions(ctx: Ctx, from: string, to: string): Promise<number> {
  // the records lock first, as a health read and a restore take it, so the pass's row and the trigger's lock (on the
  // imported activity's delete) are always taken in the same order and the two can't wait on each other
  await lockRecords(ctx.q, ctx.userId);
  const before = await linkHistory(ctx);
  return before + await linkRange(ctx, from, to);
}

/** Imported activities the full-history pass looks at per call: a few hundred, so one import or save stays quick. */
export const HISTORY_BATCH = 300;

/**
 * The one pass over the whole history (048): the duplicates from before linking, wherever they are, not only in the
 * time a read or save looks at. Each call (from linkBandSessions, so on every import and every save of a record) takes
 * the next HISTORY_BATCH imported activities by start time and links what falls inside a Motus record, until through
 * (done_at). Returns how many it linked.
 */
export async function linkHistory(ctx: Ctx): Promise<number> {
  // the place it got to as text, so the cursor keeps the microseconds a Date would drop
  const p = (await ctx.q.query<{ after_at: string | null; after_id: string | null; done: boolean }>(
    "SELECT after_at::text AS after_at, after_id, done_at IS NOT NULL AS done FROM band_link_pass")).rows[0];
  if (p?.done) return 0;
  const afterAt = p?.after_at ?? null;
  // at its start, the links left pointing at a record deleted on another copy (releaseDangling) let go too
  let n = afterAt == null ? await releaseDangling(ctx) : 0;
  const { rows } = await ctx.q.query<{ id: string; at: string; s: Date | string; e: Date | string }>(
    `SELECT id::text AS id, started_at::text AS at, started_at AS s, ended_at AS e FROM activities
     WHERE source = $1 AND ended_at > started_at AND ($2::timestamptz IS NULL OR (started_at, id::text) > ($2::timestamptz, $3::text))
     ORDER BY started_at, id::text LIMIT ${HISTORY_BATCH}`, [HC, afterAt, p?.after_id ?? ""]);
  if (rows.length) {
    const ends = rows.map((r) => Date.parse(new Date(r.e).toISOString()));
    n += await linkRange(ctx, new Date(rows[0]!.s).toISOString(), new Date(Math.max(...ends)).toISOString());
  }
  const last = rows[rows.length - 1];
  await ctx.q.query(
    `INSERT INTO band_link_pass (user_id, after_at, after_id, done_at) VALUES ($1, $2::timestamptz, $3, $4::timestamptz)
     ON CONFLICT (user_id) DO UPDATE SET after_at = coalesce($2::timestamptz, band_link_pass.after_at),
       after_id = coalesce($3, band_link_pass.after_id), done_at = $4::timestamptz`,
    [ctx.userId, last?.at ?? null, last?.id ?? null, rows.length < HISTORY_BATCH ? new Date().toISOString() : null]);
  return n;
}

/** linkBandSessions over from..to only (no history batch). */
async function linkRange(ctx: Ctx, from: string, to: string): Promise<number> {
  if (!(Date.parse(to) >= Date.parse(from))) return 0;
  const { rows } = await ctx.q.query<{ id: string; kind: "activity" | "workout"; mid: string; s: string; e: string; steps: number | null; distance_m: string | null; calories: number | null; avg_hr: number | null }>(
    `SELECT DISTINCT ON (a.id) a.id::text AS id, m.kind, m.id::text AS mid, a.started_at AS s, a.ended_at AS e, a.steps, a.distance_m, a.calories, a.avg_hr
     FROM activities a JOIN (
       SELECT 'activity' AS kind, id, started_at, ended_at FROM activities WHERE source <> $1 AND ended_at > started_at AND started_at < $3::timestamptz AND ended_at > $2::timestamptz
       UNION ALL SELECT 'workout', id, started_at, ended_at FROM workouts
         WHERE status = 'completed' AND ended_at > started_at AND started_at < $3::timestamptz AND ended_at > $2::timestamptz) m
       ON m.started_at < a.ended_at AND m.ended_at > a.started_at
       AND extract(epoch FROM least(a.ended_at, m.ended_at) - greatest(a.started_at, m.started_at)) >= 0.8 * extract(epoch FROM a.ended_at - a.started_at)
     WHERE a.source = $1 AND a.ended_at > a.started_at AND a.started_at < $3::timestamptz AND a.ended_at > $2::timestamptz
       AND a.edited_at IS NULL
       -- unlinked by the person: its own activity for good
       AND NOT EXISTS (SELECT 1 FROM health_imports h WHERE h.ref = a.id::text AND h.apart)
     ORDER BY a.id, least(a.ended_at, m.ended_at) - greatest(a.started_at, m.started_at) DESC, m.kind, m.id`, [HC, from, to]);
  for (const x of rows) {
    const copied = await copyFigures(ctx, x.kind, x.mid, { steps: x.steps, distanceM: x.distance_m == null ? null : Number(x.distance_m), calories: x.calories, avgHr: x.avg_hr });
    // linked: no longer waiting for the next read (restored_at), so it isn't listed as a restore still to come
    await ctx.q.query(
      `UPDATE health_imports SET ref = $2, linked = $3, span_start = coalesce(span_start, $4::timestamptz), span_end = coalesce(span_end, $5::timestamptz),
         copied = $6::jsonb, restored_at = NULL
       WHERE ref = $1`, [x.id, x.mid, x.kind, x.s, x.e, copied ? JSON.stringify(copied) : null]);
    await ctx.q.query("DELETE FROM activities WHERE id::text = $1", [x.id]);
  }
  if (rows.length) ctx.changed("health");
  return rows.length;
}

/** linkBandSessions over one Motus record's time (after it was saved). */
export async function linkFor(ctx: Ctx, kind: "activity" | "workout", id: string) {
  const r = (await ctx.q.query<{ s: Date | string; e: Date | string | null }>(
    `SELECT started_at AS s, ended_at AS e FROM ${kind === "workout" ? "workouts" : "activities"} WHERE id::text = $1`, [id])).rows[0];
  if (!r?.e) return 0;
  return linkBandSessions(ctx, new Date(r.s).toISOString(), new Date(r.e).toISOString());
}
