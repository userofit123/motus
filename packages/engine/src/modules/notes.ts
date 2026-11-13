// Notes (on exercises, routines, workouts…) and reminders ("increase the weight next time").
import type { Router } from "../router";
import type { Sql } from "../db";
import { camel, id, optId, str, intOrNull, bool, oneOf, dateStr, visible } from "../util";
import { uuidv7 } from "../ids";
import { notFound } from "../errors";

const NOTE_TARGETS = ["exercise", "routine", "routine_exercise", "workout", "workout_exercise", "activity"] as const;
const TRIGGERS = ["next", "every", "after_n", "date"] as const;

export function noteRoutes(r: Router) {
  // every note for a target; for an exercise also the notes written on it inside workouts and routines
  r.get("/notes", async ({ q }, _p, _b, qs) => {
    const type = oneOf(qs.targetType, NOTE_TARGETS, "exercise"), tid = id(qs.targetId);
    const extra = type === "exercise"
      ? `OR (n.target_type = 'workout_exercise' AND n.target_id IN (SELECT id FROM workout_exercises WHERE exercise_id = $2))
         OR (n.target_type = 'routine_exercise' AND n.target_id IN (SELECT id FROM routine_exercises WHERE exercise_id = $2))`
      : type === "routine" ? `OR (n.target_type = 'routine_exercise' AND n.target_id IN (SELECT id FROM routine_exercises WHERE routine_id = $2))
         OR (n.target_type = 'workout' AND n.target_id IN (SELECT id FROM workouts WHERE routine_id = $2))` : "";
    const { rows } = await q.query(
      `SELECT n.*, w.name AS workout_name, w.started_at AS workout_at FROM notes n LEFT JOIN workouts w ON w.id = n.workout_id
       WHERE (n.target_type = $1 AND n.target_id = $2) ${extra} ORDER BY n.pinned DESC, n.created_at DESC`, [type, tid]);
    return rows.map((x: any) => camel(x));
  });
  r.get("/notes/recent", async ({ q }) =>
    (await q.query("SELECT n.*, w.name AS workout_name FROM notes n LEFT JOIN workouts w ON w.id = n.workout_id ORDER BY n.created_at DESC LIMIT 50")).rows.map((x: any) => camel(x)));
  r.post("/notes", async (ctx, _p, b) => {
    const nid = uuidv7();
    const tt = oneOf(b.targetType, NOTE_TARGETS, "exercise");
    await visible(ctx.q, tt === "workout_exercise" ? "workout_exercises" : tt === "routine_exercise" ? "routine_exercises" : tt === "activity" ? "activities" : tt + "s", id(b.targetId), "target");
    await visible(ctx.q, "routines", optId(b.scopeRoutineId), "routine");
    const wid = await seenIn(ctx.q, b.workoutId);
    await ctx.q.query(
      `INSERT INTO notes (id, user_id, target_type, target_id, scope_routine_id, body, tags, difficulty, pinned, workout_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [nid, ctx.userId, oneOf(b.targetType, NOTE_TARGETS, "exercise"), id(b.targetId), optId(b.scopeRoutineId), str(b.body, 10000),
        Array.isArray(b.tags) ? b.tags.filter((t: unknown) => typeof t === "string").slice(0, 10) : [], intOrNull(b.difficulty, 1, 5), bool(b.pinned), wid]);
    ctx.changed("note");
    return { id: nid };
  });
  r.put("/notes/:id", async (ctx, p, b) => {
    const { rows } = await ctx.q.query(
      `UPDATE notes SET body = coalesce($2, body), tags = coalesce($3, tags), difficulty = CASE WHEN $6::boolean THEN $4 ELSE difficulty END, pinned = coalesce($5, pinned), updated_at = now() WHERE id = $1 RETURNING id`,
      [id(p.id), b.body != null ? str(b.body, 10000) : null, Array.isArray(b.tags) ? b.tags.slice(0, 10) : null, intOrNull(b.difficulty, 1, 5), typeof b.pinned === "boolean" ? b.pinned : null, "difficulty" in b]);
    if (!rows.length) throw notFound("Note not found");
    ctx.changed("note");
    return { ok: true };
  });
  r.del("/notes/:id", async (ctx, p) => {
    await ctx.q.query("DELETE FROM notes WHERE id = $1", [id(p.id)]);
    ctx.changed("note");
    return { ok: true };
  });

  r.get("/reminders", async ({ q }, _p, _b, qs) => {
    const conds: string[] = [], params: unknown[] = [];
    if (qs.targetId) { params.push(id(qs.targetId)); conds.push(`m.target_id = $${params.length}`); }
    if (qs.status) { params.push(qs.status); conds.push(`m.status = $${params.length}`); }
    const { rows } = await q.query(
      `SELECT m.*, coalesce(e.name, r.name) AS target_name FROM reminders m
       LEFT JOIN exercises e ON m.target_type = 'exercise' AND e.id = m.target_id
       LEFT JOIN routines r ON m.target_type = 'routine' AND r.id = m.target_id
       ${conds.length ? "WHERE " + conds.join(" AND ") : ""} ORDER BY m.status = 'pending' DESC, m.created_at DESC LIMIT 200`, params);
    return rows.map((x: any) => camel(x));
  });
  r.post("/reminders", async (ctx, _p, b) => {
    const mid = uuidv7();
    await visible(ctx.q, b.targetType === "routine" ? "routines" : "exercises", id(b.targetId), "target");
    await visible(ctx.q, "routines", optId(b.scopeRoutineId), "routine");
    const wid = await seenIn(ctx.q, b.workoutId);
    const action = b.action && typeof b.action === "object" ? { weightKg: Number(b.action.weightKg) || undefined, reps: Number(b.action.reps) || undefined, restS: Number(b.action.restS) || undefined } : null;
    await ctx.q.query(
      `INSERT INTO reminders (id, user_id, target_type, target_id, scope_routine_id, body, trigger, trigger_date, trigger_n, action, created_workout_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [mid, ctx.userId, oneOf(b.targetType, ["exercise", "routine"], "exercise"), id(b.targetId), optId(b.scopeRoutineId), str(b.body, 2000) || "Reminder",
        oneOf(b.trigger, TRIGGERS, "next"), dateStr(b.triggerDate), intOrNull(b.triggerN, 1, 100), action && Object.values(action).some(Boolean) ? JSON.stringify(action) : null, wid]);
    ctx.changed("reminder");
    return { id: mid };
  });
  // done / dismissed; "every" reminders stay pending when marked done for today. "Next time" in a running workout is
  // pending with its `workoutId`: put off there, so that workout neither shows it again nor ends it on finish
  r.put("/reminders/:id", async (ctx, p, b) => {
    const m = (await ctx.q.query("SELECT * FROM reminders WHERE id = $1", [id(p.id)])).rows[0];
    if (!m) throw notFound("Reminder not found");
    const status = b.status ? oneOf(b.status, ["pending", "done", "dismissed"], m.status) : m.status;
    const deferIn = status === "pending" && b.workoutId != null ? await seenIn(ctx.q, b.workoutId) : null;
    await ctx.q.query(
      `UPDATE reminders SET status = $2, body = coalesce($3, body), done_at = CASE WHEN $2 = 'pending' THEN NULL ELSE now() END,
         trigger = coalesce($4, trigger), trigger_date = coalesce($5, trigger_date), trigger_n = coalesce($6, trigger_n),
         deferred_workout_id = coalesce($7::uuid, deferred_workout_id) WHERE id = $1`,
      [m.id, m.trigger === "every" && status === "done" ? "pending" : status, b.body != null ? str(b.body, 2000) : null,
        b.trigger ? oneOf(b.trigger, TRIGGERS, m.trigger) : null, dateStr(b.triggerDate), intOrNull(b.triggerN, 1, 100), deferIn]);
    ctx.changed("reminder");
    return { ok: true };
  });
  r.del("/reminders/:id", async (ctx, p) => {
    await ctx.q.query("DELETE FROM reminders WHERE id = $1", [id(p.id)]);
    ctx.changed("reminder");
    return { ok: true };
  });
}

/** The workout a note or reminder was written in, if this copy of the data has it. It only says where the note came
 * from, so one the server hasn't seen yet (made offline, still syncing) leaves it out instead of refusing the note. */
async function seenIn(q: Sql, v: unknown): Promise<string | null> {
  const w = optId(v);
  return w && (await q.query("SELECT 1 FROM workouts WHERE id = $1", [w])).rows.length ? w : null;
}
