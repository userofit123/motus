// Routines (saved plans) and their folders: list, open, create (from scratch, from another routine, from a workout,
// from a template), edit, duplicate, version history, and the pre-start preview.
import { TEMPLATES, estimate, restAfterSet, ymd, type RoutineSummary } from "@motus/shared";
import { SOURCE } from "@motus/exercise-data/meta";
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { camel, id, optId, str, intOrNull, numOrNull, bool, oneOf, visible } from "../util";
import { uuidv7 } from "../ids";
import { notFound, bad } from "../errors";
import { getSettings } from "./settings";
import { buildPlan, loadRoutine } from "./plan";

const KINDS = ["warmup", "normal", "drop", "failure"] as const;

export async function routineSummaries(q: Sql, userId: string, where = "r.deleted_at IS NULL"): Promise<RoutineSummary[]> {
  const settings = await getSettings(q, userId);
  const d = { betweenSetsS: settings.workout.restBetweenSetsS, afterExerciseS: settings.workout.restAfterExerciseS };
  const { rows } = await q.query(
    `SELECT r.*,
       (SELECT count(*) FROM workouts w WHERE w.routine_id = r.id AND w.status = 'completed') AS times_done,
       (SELECT max(started_at) FROM workouts w WHERE w.routine_id = r.id AND w.status = 'completed') AS last_done_at,
       (SELECT count(*) FROM reminders m WHERE m.status = 'pending' AND ((m.target_type = 'routine' AND m.target_id = r.id)
          OR (m.target_type = 'exercise' AND m.target_id IN (SELECT exercise_id FROM routine_exercises WHERE routine_id = r.id)
              AND (m.scope_routine_id IS NULL OR m.scope_routine_id = r.id)))) AS pending_reminders,
       coalesce((SELECT json_agg(json_build_object('name', e.name, 'primary', e.primary_muscles, 'restS', re.rest_s, 'restAfterS', re.rest_after_s,
          'sets', (SELECT coalesce(json_agg(json_build_object('kind', s.kind, 'reps', s.reps, 'durationS', s.duration_s, 'restS', s.rest_s) ORDER BY s.position), '[]')
                   FROM routine_sets s WHERE s.routine_exercise_id = re.id)) ORDER BY re.position)
         FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id WHERE re.routine_id = r.id), '[]') AS exs
     FROM routines r WHERE ${where} ORDER BY r.pinned DESC, r.position, r.created_at`);
  return rows.map((r: any) => {
    const exs = r.exs as any[];
    const est = estimate(exs.map((e, i) => ({
      sets: (e.sets as any[]).map((s, j) => ({ ...s, restS: restAfterSet({ setRestS: s.restS, exRestS: e.restS, isLastSet: j === e.sets.length - 1, exRestAfterS: e.restAfterS }, d) })),
    })).map((x, i, a) => x));
    const muscles = [...new Set(exs.flatMap((e) => e.primary as string[]))];
    return {
      id: r.id, folderId: r.folder_id, name: r.name, description: r.description, color: r.color, pinned: r.pinned, archived: r.archived, position: r.position,
      exerciseCount: exs.length, setCount: exs.reduce((a, e) => a + e.sets.length, 0), estimateS: est.totalS, muscles,
      lastDoneAt: r.last_done_at, timesDone: Number(r.times_done), pendingReminders: Number(r.pending_reminders), exerciseNames: exs.map((e) => e.name),
    };
  });
}

/** Writes a routine's exercises and sets, keeping the ids of exercises that stay (workouts point at them). */
export async function writeRoutineBody(ctx: Ctx, routineId: string, exercises: any[]) {
  if (!Array.isArray(exercises)) throw bad("Expected a list of exercises");
  if (exercises.length > 100) throw bad("Too many exercises");
  const keep: string[] = [];
  for (const [pos, e] of exercises.entries()) {
    const reId = e.id && typeof e.id === "string" && /^[0-9a-f-]{36}$/.test(e.id) ? e.id : uuidv7();
    keep.push(reId);
    await visible(ctx.q, "exercises", id(e.exerciseId, "exercise"), "exercise");
    const vals = [reId, ctx.userId, routineId, id(e.exerciseId, "exercise"), pos, e.superset ? str(e.superset, 20) : null, intOrNull(e.restS, 0, 3600),
      intOrNull(e.restAfterS, 0, 3600), intOrNull(e.repRestS, 0, 600), oneOf(e.prefill, ["last", "target"], "last"), oneOf(e.prefillScope, ["any", "routine"], "any"),
      e.progression && typeof e.progression === "object" ? JSON.stringify(e.progression) : null, str(e.note, 2000)];
    await ctx.q.query(
      `INSERT INTO routine_exercises (id, user_id, routine_id, exercise_id, position, superset, rest_s, rest_after_s, rep_rest_s, prefill, prefill_scope, progression, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET exercise_id=$4, position=$5, superset=$6, rest_s=$7, rest_after_s=$8, rep_rest_s=$9, prefill=$10, prefill_scope=$11, progression=$12, note=$13
       WHERE routine_exercises.routine_id = $3`, vals);
    await ctx.q.query("DELETE FROM routine_sets WHERE routine_exercise_id = $1", [reId]);
    const sets = Array.isArray(e.sets) ? e.sets.slice(0, 50) : [];
    for (const [sp, s] of sets.entries()) {
      await ctx.q.query(
        `INSERT INTO routine_sets (id, user_id, routine_exercise_id, position, kind, reps, reps_max, weight_kg, duration_s, distance_m, rpe, rest_s)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [uuidv7(), ctx.userId, reId, sp, oneOf(s.kind, KINDS, "normal"), intOrNull(s.reps, 0, 1000), intOrNull(s.repsMax, 0, 1000), numOrNull(s.weightKg, -500, 2000),
          intOrNull(s.durationS, 0, 86400), numOrNull(s.distanceM, 0, 1e7), numOrNull(s.rpe, 0, 10), intOrNull(s.restS, 0, 3600)]);
    }
  }
  await ctx.q.query("DELETE FROM routine_exercises WHERE routine_id = $1 AND NOT (id = ANY($2::uuid[]))", [routineId, keep]);
}

async function snapshot(ctx: Ctx, routineId: string) {
  const r = await loadRoutine(ctx.q, routineId);
  if (!r) return;
  await ctx.q.query("INSERT INTO routine_versions (id, user_id, routine_id, snapshot) VALUES ($1,$2,$3,$4)", [uuidv7(), ctx.userId, routineId, JSON.stringify(r)]);
  // keep the last 30 versions
  await ctx.q.query(
    "DELETE FROM routine_versions WHERE routine_id = $1 AND id NOT IN (SELECT id FROM routine_versions WHERE routine_id = $1 ORDER BY created_at DESC LIMIT 30)", [routineId]);
}

export async function createRoutine(ctx: Ctx, b: any): Promise<string> {
  const rid = uuidv7();
  const name = str(b.name, 120).trim() || "New routine";
  await visible(ctx.q, "folders", optId(b.folderId), "folder");
  await visible(ctx.q, "routines", optId(b.basedOnId), "routine");
  const pos = (await ctx.q.query("SELECT coalesce(max(position), -1) + 1 AS p FROM routines WHERE deleted_at IS NULL")).rows[0].p;
  await ctx.q.query(
    `INSERT INTO routines (id, user_id, folder_id, name, description, color, based_on_id, position, pinned, settings) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [rid, ctx.userId, optId(b.folderId), name, str(b.description, 2000), b.color ? str(b.color, 20) : null, optId(b.basedOnId), pos, bool(b.pinned), JSON.stringify(b.settings ?? {})]);
  await writeRoutineBody(ctx, rid, b.exercises ?? []);
  return rid;
}

/** A workout's structure as a routine body (for "Save as routine" and "Update routine from this workout"). */
export async function bodyFromWorkout(q: Sql, workoutId: string) {
  const exs = (await q.query("SELECT * FROM workout_exercises WHERE workout_id = $1 AND status <> 'skipped' ORDER BY position", [workoutId])).rows;
  const sets = exs.length ? (await q.query("SELECT * FROM workout_sets WHERE workout_exercise_id = ANY($1::uuid[]) ORDER BY position", [exs.map((e: any) => e.id)])).rows : [];
  return exs.map((e: any) => ({
    id: e.routine_exercise_id ?? undefined, exerciseId: e.exercise_id, superset: e.superset, restS: e.rest_s, restAfterS: e.rest_after_s, repRestS: e.rep_rest_s,
    sets: sets.filter((s: any) => s.workout_exercise_id === e.id && (s.done || !sets.some((x: any) => x.workout_exercise_id === e.id && x.done)))
      .map((s: any) => ({ kind: s.kind, reps: s.reps, weightKg: s.weight_kg, durationS: s.duration_s, distanceM: s.distance_m })),
  }));
}

/** "Update the routine from this workout": today's exercises, order and numbers, keeping each exercise's own settings
 * (prefill, progression, note, rep ranges, rests) and the routine as it was in its history. */
export async function updateRoutineFromWorkout(ctx: Ctx, routineId: string, workoutId: string) {
  const body = await bodyFromWorkout(ctx.q, workoutId);
  if (!body.length) return;
  await snapshot(ctx, routineId);
  const cur = new Map(((await loadRoutine(ctx.q, routineId))?.exercises ?? []).map((e: any) => [e.id, e]));
  await writeRoutineBody(ctx, routineId, body.map((e) => {
    const old: any = e.id ? cur.get(e.id) : null;
    if (!old) return e;
    return { ...old, exerciseId: e.exerciseId, sets: e.sets.map((s: any, i: number) => ({ ...(old.sets?.[i] ?? old.sets?.at(-1) ?? {}), ...s })) };
  }));
}

export function routineRoutes(r: Router) {
  r.get("/routines", async ({ q, userId }, _p, _b, qs) => routineSummaries(q, userId, qs.archived === "1" ? "r.deleted_at IS NULL AND r.archived" : "r.deleted_at IS NULL"));

  r.get("/routines/:id", async ({ q }, p) => {
    const routine = await loadRoutine(q, id(p.id));
    if (!routine) throw notFound("Routine not found");
    return routine;
  });

  r.get("/routines/:id/preview", async (ctx, p) => {
    const routine = await loadRoutine(ctx.q, id(p.id));
    if (!routine) throw notFound("Routine not found");
    const settings = await getSettings(ctx.q, ctx.userId);
    const plan = await buildPlan(ctx.q, routine, settings, ymd(ctx.now()));
    const stats = (await ctx.q.query(
      `SELECT count(*) AS n, max(started_at) AS last_at,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ended_at - started_at) - paused_s) AS median_s
       FROM workouts WHERE routine_id = $1 AND status = 'completed'`, [p.id])).rows[0];
    return { routine, ...plan, timesDone: Number(stats.n), lastDoneAt: stats.last_at, medianDurationS: stats.median_s ? Math.round(stats.median_s) : null };
  });

  r.post("/routines", async (ctx, _p, b) => {
    let body = b ?? {};
    if (b?.fromRoutineId) {
      const src = await loadRoutine(ctx.q, id(b.fromRoutineId));
      if (!src) throw notFound("Routine not found");
      body = { ...src, name: str(b.name, 120) || `${src.name} (copy)`, basedOnId: src.id, pinned: false, exercises: src.exercises.map((e: any) => ({ ...e, id: undefined })) };
    } else if (b?.fromWorkoutId) {
      const w = (await ctx.q.query("SELECT name FROM workouts WHERE id = $1", [id(b.fromWorkoutId)])).rows[0];
      if (!w) throw notFound("Workout not found");
      body = { name: str(b.name, 120) || w.name, exercises: (await bodyFromWorkout(ctx.q, b.fromWorkoutId)).map((e) => ({ ...e, id: undefined })) };
    } else if (b?.template) {
      const t = TEMPLATES.find((x) => x.slug === b.template);
      if (!t) throw notFound("Template not found");
      const ids = new Map((await ctx.q.query("SELECT source_id, id FROM exercises WHERE owner_id IS NULL AND source = $1 AND source_id = ANY($2::text[])", [SOURCE, t.exercises.map((e) => e.id)])).rows.map((x: any) => [x.source_id, x.id]));
      body = {
        name: t.name, description: t.description, folderId: b.folderId,
        exercises: t.exercises.filter((e) => ids.has(e.id)).map((e) => ({
          exerciseId: ids.get(e.id), restS: e.restS ?? null, restAfterS: e.restAfterS ?? null,
          sets: Array.from({ length: e.sets }, () => ({ kind: "normal", reps: e.durationS ? null : e.reps, repsMax: e.repsMax ?? null, durationS: e.durationS ?? null })),
        })),
      };
    }
    const rid = await createRoutine(ctx, body);
    ctx.changed("routine");
    return { id: rid };
  });

  r.put("/routines/:id", async (ctx, p, b) => {
    const rid = id(p.id);
    const cur = (await ctx.q.query("SELECT id FROM routines WHERE id = $1 AND deleted_at IS NULL", [rid])).rows[0];
    if (!cur) throw notFound("Routine not found");
    if (b.exercises) await snapshot(ctx, rid);
    const sets: string[] = [], vals: unknown[] = [rid];
    const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ("name" in b) put("name", str(b.name, 120).trim() || "Routine");
    if ("description" in b) put("description", str(b.description, 2000));
    if ("folderId" in b) { await visible(ctx.q, "folders", optId(b.folderId), "folder"); put("folder_id", optId(b.folderId)); }
    if ("color" in b) put("color", b.color ? str(b.color, 20) : null);
    if ("pinned" in b) put("pinned", bool(b.pinned));
    if ("archived" in b) put("archived", bool(b.archived));
    if ("position" in b) put("position", intOrNull(b.position, 0, 100000) ?? 0);
    if ("settings" in b) put("settings", JSON.stringify(b.settings ?? {}));
    put("updated_at", ctx.now().toISOString());
    await ctx.q.query(`UPDATE routines SET ${sets.join(", ")} WHERE id = $1`, vals);
    if (b.exercises) await writeRoutineBody(ctx, rid, b.exercises);
    ctx.changed("routine");
    return { ok: true };
  });

  r.post("/routines/reorder", async (ctx, _p, b) => {
    const ids: string[] = (Array.isArray(b.ids) ? b.ids : []).map((x: unknown) => id(x));
    for (const [i, rid] of ids.entries()) await ctx.q.query("UPDATE routines SET position = $2 WHERE id = $1", [rid, i]);
    ctx.changed("routine");
    return { ok: true };
  });

  r.post("/routines/:id/duplicate", async (ctx, p, b) => {
    const src = await loadRoutine(ctx.q, id(p.id));
    if (!src) throw notFound("Routine not found");
    const rid = await createRoutine(ctx, { ...src, name: str(b?.name, 120) || `${src.name} (copy)`, pinned: false, exercises: src.exercises.map((e: any) => ({ ...e, id: undefined })) });
    ctx.changed("routine");
    return { id: rid };
  });

  // update a routine from a workout (the finish screen's "Update routine with today's values")
  r.post("/routines/:id/from-workout", async (ctx, p, b) => {
    const rid = id(p.id);
    if (!(await ctx.q.query("SELECT 1 FROM routines WHERE id = $1", [rid])).rows.length) throw notFound("Routine not found");
    await updateRoutineFromWorkout(ctx, rid, id(b.workoutId));
    ctx.changed("routine");
    return { ok: true };
  });

  r.del("/routines/:id", async (ctx, p) => {
    await ctx.q.query("UPDATE routines SET deleted_at = now() WHERE id = $1", [id(p.id)]);
    ctx.changed("routine");
    return { ok: true };
  });
  r.post("/routines/:id/restore", async (ctx, p) => {
    await ctx.q.query("UPDATE routines SET deleted_at = NULL WHERE id = $1", [id(p.id)]);
    ctx.changed("routine");
    return { ok: true };
  });

  r.get("/routines/:id/versions", async ({ q }, p) =>
    (await q.query("SELECT id, created_at, snapshot->>'name' AS name, jsonb_array_length(snapshot->'exercises') AS exercises FROM routine_versions WHERE routine_id = $1 ORDER BY created_at DESC", [id(p.id)])).rows.map((x: any) => camel(x)));
  r.post("/routines/:id/versions/:vid/restore", async (ctx, p) => {
    const v = (await ctx.q.query("SELECT snapshot FROM routine_versions WHERE id = $1 AND routine_id = $2", [id(p.vid), id(p.id)])).rows[0];
    if (!v) throw notFound("Version not found");
    await snapshot(ctx, p.id!);
    const s = v.snapshot;
    await ctx.q.query("UPDATE routines SET name = $2, description = $3, updated_at = now() WHERE id = $1", [p.id, s.name, s.description ?? ""]);
    await writeRoutineBody(ctx, p.id!, s.exercises);
    ctx.changed("routine");
    return { ok: true };
  });

  r.get("/routines/:id/workouts", async ({ q }, p) =>
    (await q.query(
      `SELECT w.id, w.name, w.started_at, w.ended_at, extract(epoch FROM coalesce(w.ended_at, w.started_at) - w.started_at)::int - w.paused_s AS duration_s,
         coalesce((SELECT sum(s.weight_kg * s.reps) FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
                   WHERE we.workout_id = w.id AND s.done AND s.kind <> 'warmup'), 0) AS volume_kg,
         (SELECT count(*) FROM workout_exercises we WHERE we.workout_id = w.id AND we.status = 'skipped') AS skipped
       FROM workouts w WHERE w.routine_id = $1 AND w.status = 'completed' ORDER BY w.started_at DESC LIMIT 200`, [id(p.id)])).rows.map((x: any) => camel(x)));

  r.get("/templates", async () => TEMPLATES.map((t) => ({ slug: t.slug, group: t.group, name: t.name, description: t.description, exercises: t.exercises.length })));

  // folders
  r.get("/folders", async ({ q }) => (await q.query("SELECT id, name, position, color FROM folders ORDER BY position, name")).rows);
  r.post("/folders", async (ctx, _p, b) => {
    const fid = uuidv7();
    await ctx.q.query("INSERT INTO folders (id, user_id, name, position, color) VALUES ($1,$2,$3,(SELECT coalesce(max(position),-1)+1 FROM folders),$4)",
      [fid, ctx.userId, str(b.name, 80).trim() || "Folder", b.color ? str(b.color, 20) : null]);
    ctx.changed("routine");
    return { id: fid };
  });
  r.put("/folders/:id", async (ctx, p, b) => {
    await ctx.q.query("UPDATE folders SET name = coalesce($2, name), position = coalesce($3, position), color = CASE WHEN $5::boolean THEN $4 ELSE color END WHERE id = $1",
      [id(p.id), b.name ? str(b.name, 80) : null, intOrNull(b.position, 0, 10000), b.color ? str(b.color, 20) : null, "color" in b]);
    ctx.changed("routine");
    return { ok: true };
  });
  r.del("/folders/:id", async (ctx, p) => {
    await ctx.q.query("DELETE FROM folders WHERE id = $1", [id(p.id)]);
    ctx.changed("routine");
    return { ok: true };
  });
}
