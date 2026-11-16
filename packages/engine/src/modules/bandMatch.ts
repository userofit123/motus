// A band session that is a workout or activity recorded in Motus (the band, or its app, saw the same exercise) is linked
// to that record, never a second activity beside it (M-250): its import log entry points at the Motus record (ref) and
// says which kind it is (linked, 046), so its time, steps and load count once in Stats, the scores and a day's steps.
// It is the session when at least 80% of it falls inside the record's time: a band session usually starts a little
// later and ends a little earlier than the workout timer, and a long workout may hold a short band session. Not both
// ways: a 20-minute walk logged in Motus inside a band's 2-hour hike is the hike's part, still the same exercise. A
// session of no length matches nothing (it has no time to fall inside anything).
// Both arrival orders: the import links a new session at once (health.ts), and this pass takes in sessions already
// brought in as activities when the Motus record came later (a workout finished, an activity saved or synced from
// another copy), deleting that imported activity. It also cleans up the duplicates from before (run on every import).
// The person can unlink one (Imported data → Unlink, apart): it then comes in as its own activity and stays apart.
import type { Ctx } from "../router";

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
     ORDER BY least(ended_at, $2::timestamptz) - greatest(started_at, $1::timestamptz) DESC LIMIT 1`, [s, e, HC])).rows[0];
  return row ?? null;
}

/**
 * What the band had and the Motus activity lacks (steps, distance, calories, heart rate) goes into it; a typed or
 * recorded number stays. A workout has no such columns: its heart rate comes from the band's readings (/health/ranges).
 */
export async function copyFigures(ctx: Ctx, kind: "activity" | "workout", id: string, f: BandFigures) {
  if (kind !== "activity") return;
  await ctx.q.query(
    `UPDATE activities SET steps_source = CASE WHEN steps IS NULL AND $2::int IS NOT NULL THEN 'band' ELSE steps_source END,
       steps = coalesce(steps, $2::int), distance_m = coalesce(distance_m, $3::numeric), calories = coalesce(calories, $4::int),
       avg_hr = coalesce(avg_hr, $5::int)
     WHERE id::text = $1 AND (steps IS NULL AND $2::int IS NOT NULL OR distance_m IS NULL AND $3::numeric IS NOT NULL
       OR calories IS NULL AND $4::int IS NOT NULL OR avg_hr IS NULL AND $5::int IS NOT NULL)`,
    [id, f.steps == null ? null : Math.round(f.steps), f.distanceM, f.calories == null ? null : Math.round(f.calories), f.avgHr == null ? null : Math.round(f.avgHr)]);
}

/**
 * Takes in band sessions already brought in as activities that fall inside a Motus workout or activity: their import log
 * entries now point at the Motus record, the record gets the numbers it lacked, and the imported activity is deleted.
 * The entries are moved first, so deleting the row doesn't mark them deleted (034's trigger goes by ref). Returns how many.
 */
export async function linkBandSessions(ctx: Ctx): Promise<number> {
  const { rows } = await ctx.q.query<{ id: string; kind: "activity" | "workout"; mid: string; s: string; e: string; steps: number | null; distance_m: string | null; calories: number | null; avg_hr: number | null }>(
    `SELECT DISTINCT ON (a.id) a.id::text AS id, m.kind, m.id::text AS mid, a.started_at AS s, a.ended_at AS e, a.steps, a.distance_m, a.calories, a.avg_hr
     FROM activities a JOIN (
       SELECT 'activity' AS kind, id, started_at, ended_at FROM activities WHERE source <> $1 AND ended_at > started_at
       UNION ALL SELECT 'workout', id, started_at, ended_at FROM workouts WHERE status = 'completed' AND ended_at > started_at) m
       ON m.started_at < a.ended_at AND m.ended_at > a.started_at
       AND extract(epoch FROM least(a.ended_at, m.ended_at) - greatest(a.started_at, m.started_at)) >= 0.8 * extract(epoch FROM a.ended_at - a.started_at)
     WHERE a.source = $1 AND a.ended_at > a.started_at
       -- unlinked by the person: its own activity for good
       AND NOT EXISTS (SELECT 1 FROM health_imports h WHERE h.ref = a.id::text AND h.apart)
     ORDER BY a.id, least(a.ended_at, m.ended_at) - greatest(a.started_at, m.started_at) DESC`, [HC]);
  for (const x of rows) {
    await ctx.q.query(
      `UPDATE health_imports SET ref = $2, linked = $3, span_start = coalesce(span_start, $4::timestamptz), span_end = coalesce(span_end, $5::timestamptz)
       WHERE ref = $1`, [x.id, x.mid, x.kind, x.s, x.e]);
    await copyFigures(ctx, x.kind, x.mid, { steps: x.steps, distanceM: x.distance_m == null ? null : Number(x.distance_m), calories: x.calories, avgHr: x.avg_hr });
    await ctx.q.query("DELETE FROM activities WHERE id::text = $1", [x.id]);
  }
  if (rows.length) ctx.changed("health");
  return rows.length;
}
