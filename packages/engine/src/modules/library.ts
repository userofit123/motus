// The exercise library: the shared catalog plus each person's own exercises, their per-exercise settings,
// and every exercise's history, charts and records.
import { e1rm, liftedKg, type Exercise, type Tracking } from "@motus/shared";
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { camel, id, str, numOrNull, intOrNull, bool, oneOf } from "../util";
import { uuidv7 } from "../ids";
import { notFound, bad } from "../errors";

const TRACKING: Tracking[] = ["weight_reps", "bodyweight_reps", "assisted", "reps_only", "duration", "weight_duration", "distance_duration", "distance_weight"];

const EX_COLS = `e.id, e.owner_id, e.source, e.name, e.aliases, e.category, e.equipment, e.mechanic, e.force, e.level, e.tracking, e.unilateral,
  e.primary_muscles, e.secondary_muscles, e.instructions, e.images, e.video_url, e.license, e.author, e.archived`;

const exerciseFromRow = (r: any): Exercise => {
  const e = camel<Exercise>(r);
  e.favourite = !!r.favourite;
  e.hidden = !!r.hidden;
  e.timesDone = Number(r.times_done ?? 0);
  e.lastDoneAt = r.last_done_at ?? null;
  return e;
};

export async function getExercises(q: Sql, ids: string[]): Promise<Map<string, Exercise>> {
  if (!ids.length) return new Map();
  const { rows } = await q.query(
    `SELECT ${EX_COLS}, p.favourite, p.hidden, p.rest_s, p.rest_after_s FROM exercises e
     LEFT JOIN exercise_prefs p ON p.exercise_id = e.id WHERE e.id = ANY($1::uuid[])`, [ids]);
  return new Map(rows.map((r: any) => [r.id, exerciseFromRow(r)]));
}

/** Per completed workout: the working sets of one exercise, newest first. */
export async function exerciseSessions(q: Sql, exerciseId: string, limit = 200, routineId?: string | null) {
  const { rows } = await q.query(
    `SELECT w.id AS workout_id, w.name AS workout_name, w.routine_id, w.started_at, we.id AS we_id, we.position, we.status,
       (SELECT tracking FROM exercises e WHERE e.id = we.exercise_id) AS tracking,
       (SELECT count(*) FROM workout_exercises x WHERE x.workout_id = w.id) AS of_n,
       coalesce(json_agg(json_build_object('id', s.id, 'position', s.position, 'kind', s.kind, 'weightKg', s.weight_kg, 'reps', s.reps,
         'durationS', s.duration_s, 'distanceM', s.distance_m, 'rpe', s.rpe, 'rir', s.rir, 'side', s.side, 'doneAt', s.done_at, 'restActualS', s.rest_actual_s)
         ORDER BY s.position) FILTER (WHERE s.id IS NOT NULL AND s.done), '[]') AS sets
     FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
     LEFT JOIN workout_sets s ON s.workout_exercise_id = we.id
     WHERE we.exercise_id = $1 AND w.status = 'completed' ${routineId ? "AND w.routine_id = $3" : ""}
     GROUP BY w.id, we.id ORDER BY w.started_at DESC LIMIT $2`,
    routineId ? [exerciseId, limit, routineId] : [exerciseId, limit]);
  return rows.map((r: any) => {
    const sets = (r.sets as any[]).map((s) => ({ ...s, weightKg: s.weightKg == null ? null : Number(s.weightKg), distanceM: s.distanceM == null ? null : Number(s.distanceM) }));
    const work = sets.filter((s) => s.kind !== "warmup");
    const best = work.reduce<any>((b, s) => ((e1rm(s.weightKg, s.reps) ?? 0) > (e1rm(b?.weightKg, b?.reps) ?? -1) ? s : b), null);
    return {
      workoutId: r.workout_id, workoutName: r.workout_name, routineId: r.routine_id, tracking: r.tracking as Tracking, startedAt: r.started_at, position: r.position + 1, ofN: Number(r.of_n), status: r.status,
      sets, bestSet: best, volumeKg: work.reduce((a, s) => a + liftedKg(s.weightKg, s.reps, r.tracking), 0),
      maxWeightKg: work.reduce((a, s) => Math.max(a, s.weightKg ?? 0), 0) || null,
      e1rm: work.reduce((a, s) => Math.max(a, e1rm(s.weightKg, s.reps) ?? 0), 0) || null,
      reps: work.reduce((a, s) => a + (s.reps ?? 0), 0),
      durationS: work.reduce((a, s) => Math.max(a, s.durationS ?? 0), 0) || null,
      distanceM: work.reduce((a, s) => a + (s.distanceM ?? 0), 0) || null,
    };
  });
}

/** Records from a list of sessions (oldest to newest), with the date each was set. */
function recordsOf(sessions: Awaited<ReturnType<typeof exerciseSessions>>) {
  const best: Record<string, { value: number; at: string; workoutId: string; detail?: string }> = {};
  const repMax: Record<number, { weightKg: number; at: string }> = {};
  const put = (k: string, v: number | null | undefined, s: any, detail?: string) => { if (v && (!best[k] || v > best[k]!.value)) best[k] = { value: v, at: s.startedAt, workoutId: s.workoutId, detail }; };
  for (const s of [...sessions].reverse()) {
    for (const x of s.sets) {
      if (x.kind === "warmup") continue;
      put("maxWeight", x.weightKg, s, x.reps ? `× ${x.reps}` : undefined);
      put("e1rm", e1rm(x.weightKg, x.reps), s, x.weightKg ? `${x.weightKg} × ${x.reps}` : undefined);
      put("maxReps", x.reps, s, x.weightKg ? `@ ${x.weightKg} kg` : undefined);
      put("setVolume", liftedKg(x.weightKg, x.reps, s.tracking), s);
      put("maxDuration", x.durationS, s);
      put("maxDistance", x.distanceM, s);
      if (x.weightKg && x.reps && x.reps <= 12) for (let r = 1; r <= x.reps; r++) if (!repMax[r] || x.weightKg > repMax[r]!.weightKg) repMax[r] = { weightKg: x.weightKg, at: s.startedAt };
    }
    put("sessionVolume", s.volumeKg, s);
  }
  return { best, repMax };
}

export function libraryRoutes(r: Router) {
  r.get("/exercises", async ({ q }) => {
    const { rows } = await q.query(
      `SELECT ${EX_COLS}, p.favourite, p.hidden, u.times_done, u.last_done_at FROM exercises e
       LEFT JOIN exercise_prefs p ON p.exercise_id = e.id
       LEFT JOIN (SELECT we.exercise_id, count(DISTINCT w.id) AS times_done, max(w.started_at) AS last_done_at
                  FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
                  WHERE w.status = 'completed' AND we.status <> 'skipped' GROUP BY we.exercise_id) u ON u.exercise_id = e.id
       WHERE NOT e.archived ORDER BY e.name`);
    return rows.map(exerciseFromRow);
  });

  r.get("/exercises/:id", async ({ q }, p) => {
    const ex = (await getExercises(q, [id(p.id)])).get(p.id!);
    if (!ex) throw notFound("Exercise not found");
    const pref = (await q.query("SELECT * FROM exercise_prefs WHERE exercise_id = $1", [p.id])).rows[0];
    const routines = (await q.query(
      `SELECT DISTINCT r.id, r.name FROM routine_exercises re JOIN routines r ON r.id = re.routine_id
       WHERE re.exercise_id = $1 AND r.deleted_at IS NULL AND NOT r.archived ORDER BY r.name`, [p.id])).rows;
    return { ...ex, prefs: pref ? camel(pref) : null, routines };
  });

  r.get("/exercises/:id/history", async ({ q }, p, _b, qs) => {
    const sessions = await exerciseSessions(q, id(p.id), Math.min(500, Number(qs.limit) || 200));
    const { best, repMax } = recordsOf(sessions);
    const positions = sessions.map((s) => s.position);
    const hours = sessions.map((s) => new Date(s.startedAt).getHours());
    const mode = (a: number[]) => { const m = new Map<number, number>(); a.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1)); return [...m].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null; };
    return {
      sessions, records: best, repMax,
      summary: {
        timesDone: sessions.length, firstAt: sessions.at(-1)?.startedAt ?? null, lastAt: sessions[0]?.startedAt ?? null,
        usualPosition: mode(positions), usualHour: mode(hours),
        firstPositionShare: sessions.length ? sessions.filter((s) => s.position === 1).length / sessions.length : 0,
      },
    };
  });

  r.post("/exercises", async (ctx, _p, b) => {
    const exId = uuidv7();
    await saveCustom(ctx, exId, b, true);
    ctx.changed("exercise");
    return { id: exId };
  });
  r.put("/exercises/:id", async (ctx, p, b) => {
    await saveCustom(ctx, id(p.id), b, false);
    ctx.changed("exercise");
    return { ok: true };
  });
  r.del("/exercises/:id", async (ctx, p) => {
    const used = (await ctx.q.query("SELECT 1 FROM workout_exercises WHERE exercise_id = $1 UNION ALL SELECT 1 FROM routine_exercises WHERE exercise_id = $1 LIMIT 1", [id(p.id)])).rows.length;
    // an exercise with history is archived, so the history keeps its name
    if (used) await ctx.q.query("UPDATE exercises SET archived = true WHERE id = $1 AND owner_id = $2", [p.id, ctx.userId]);
    else await ctx.q.query("DELETE FROM exercises WHERE id = $1 AND owner_id = $2", [p.id, ctx.userId]);
    ctx.changed("exercise");
    return { ok: true, archived: !!used };
  });
  r.put("/exercises/:id/prefs", async (ctx, p, b) => {
    const exId = id(p.id);
    await ctx.q.query(
      `INSERT INTO exercise_prefs (user_id, exercise_id, rest_s, rest_after_s, favourite, hidden, bar_kg, increment_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, exercise_id) DO UPDATE SET rest_s = $3, rest_after_s = $4, favourite = $5, hidden = $6, bar_kg = $7, increment_kg = $8`,
      [ctx.userId, exId, intOrNull(b.restS, 0, 3600), intOrNull(b.restAfterS, 0, 3600), bool(b.favourite), bool(b.hidden), numOrNull(b.barKg, 0, 100), numOrNull(b.incrementKg, 0, 50)]);
    ctx.changed("exercise");
    return { ok: true };
  });
  // merge: move all of one exercise's history and routines onto another (only your own exercise can be merged away)
  r.post("/exercises/:id/merge", async (ctx, p, b) => {
    const from = id(p.id), into = id(b.into, "exercise");
    if (from === into) throw bad("Pick a different exercise");
    const own = (await ctx.q.query("SELECT 1 FROM exercises WHERE id = $1 AND owner_id = $2", [from, ctx.userId])).rows.length;
    if (!own) throw bad("Only your own exercises can be merged into another");
    for (const t of ["workout_exercises", "routine_exercises"]) await ctx.q.query(`UPDATE ${t} SET exercise_id = $2 WHERE exercise_id = $1`, [from, into]);
    await ctx.q.query("UPDATE notes SET target_id = $2 WHERE target_type = 'exercise' AND target_id = $1", [from, into]);
    await ctx.q.query("UPDATE reminders SET target_id = $2 WHERE target_type = 'exercise' AND target_id = $1", [from, into]);
    await ctx.q.query("DELETE FROM exercises WHERE id = $1", [from]);
    ctx.changed("exercise", "workout");
    return { ok: true };
  });
  // alternatives for "replace exercise": same main muscle, most used first
  r.get("/exercises/:id/alternatives", async ({ q }, p) => {
    const ex = (await getExercises(q, [id(p.id)])).get(p.id!);
    if (!ex) throw notFound();
    const { rows } = await q.query(
      `SELECT ${EX_COLS}, coalesce(u.n, 0) AS times_done FROM exercises e
       LEFT JOIN (SELECT exercise_id, count(*) n FROM workout_exercises GROUP BY 1) u ON u.exercise_id = e.id
       WHERE NOT e.archived AND e.id <> $1 AND e.primary_muscles && $2::text[] AND e.category = $3
       ORDER BY coalesce(u.n, 0) DESC, (e.equipment IS NOT DISTINCT FROM $4) DESC, e.name LIMIT 30`,
      [ex.id, ex.primaryMuscles, ex.category, ex.equipment]);
    return rows.map(exerciseFromRow);
  });
}

async function saveCustom(ctx: Ctx, exId: string, b: any, isNew: boolean) {
  const name = str(b.name, 120).trim();
  if (!name) throw bad("Give the exercise a name");
  const arr = (v: unknown, max = 40, len = 1000) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, max).map((x: string) => x.slice(0, len)) : []);
  const vals = [exId, ctx.userId, name, arr(b.aliases), str(b.category, 40, "strength"), b.equipment ? str(b.equipment, 40) : null, oneOf(b.tracking, TRACKING, "weight_reps"),
    bool(b.unilateral), arr(b.primaryMuscles), arr(b.secondaryMuscles), arr(b.instructions, 60), arr(b.images, 10, 4_000_000) /* local accounts keep photos inline */, b.videoUrl ? str(b.videoUrl, 500) : null];
  if (isNew) {
    await ctx.q.query(
      `INSERT INTO exercises (id, owner_id, source, name, aliases, category, equipment, tracking, unilateral, primary_muscles, secondary_muscles, instructions, images, video_url)
       VALUES ($1,$2,'custom',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, vals);
  } else {
    const { rows } = await ctx.q.query(
      `UPDATE exercises SET name=$3, aliases=$4, category=$5, equipment=$6, tracking=$7, unilateral=$8, primary_muscles=$9, secondary_muscles=$10,
         instructions=$11, images=$12, video_url=$13, updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id`, vals);
    if (!rows.length) throw notFound("Only your own exercises can be edited");
  }
}
