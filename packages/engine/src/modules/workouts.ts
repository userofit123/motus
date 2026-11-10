// Workouts: starting one (from a routine or empty), logging sets, skipping, reordering and replacing exercises,
// finishing, logging a past workout, editing and duplicating, and the full detail with records and improvements.
import { e1rm, ymd, pairSets, planSetRest, restDefaultsOf, liftedKg, LIFTED_SQL, structureChanges, type Tracking, type RoutineExercise, type ExerciseStatus, type SetKind, type WorkoutExercise, type HomeRecord, type Workout, type WorkoutSummary, type Routine } from "@motus/shared";
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { camel, id, optId, str, strList, intOrNull, numOrNull, bool, oneOf, isoTime, secondsBetween, visible } from "../util";
import { uuidv7 } from "../ids";
import { notFound, bad, HttpError } from "../errors";
import { getSettings } from "./settings";
import { buildPlan, loadRoutine, pendingReminders, withWorkoutOverrides } from "./plan";
import { getExercises, exerciseSessions, savePrefs } from "./library";

const KINDS = ["warmup", "normal", "drop", "failure"] as const;
const EX_STATUS = ["pending", "done", "skipped", "partial"] as const;

const VOLUME_SQL = `coalesce((SELECT sum(${LIFTED_SQL}) FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
  JOIN exercises e ON e.id = we.exercise_id WHERE we.workout_id = w.id AND s.done AND s.kind <> 'warmup'), 0)`;
export const DURATION_SQL = `greatest(0, extract(epoch FROM coalesce(w.ended_at, now()) - w.started_at)::int - w.paused_s)`;

export async function workoutSummaries(q: Sql, where: string, params: unknown[], limit = 100): Promise<WorkoutSummary[]> {
  const { rows } = await q.query(
    `SELECT w.id, w.routine_id, w.name, w.status, w.started_at, w.ended_at, ${DURATION_SQL} AS duration_s, r.color,
       (SELECT count(*) FROM workout_exercises we WHERE we.workout_id = w.id AND we.status <> 'skipped') AS exercise_count,
       (SELECT count(*) FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.workout_id = w.id AND s.done) AS set_count,
       ${VOLUME_SQL} AS volume_kg
     FROM workouts w LEFT JOIN routines r ON r.id = w.routine_id WHERE ${where} ORDER BY w.started_at DESC LIMIT ${limit}`, params);
  return rows.map((r: any) => ({ ...camel<WorkoutSummary>(r), exerciseCount: Number(r.exercise_count), setCount: Number(r.set_count), volumeKg: Number(r.volume_kg), prCount: 0 }));
}

/** A set as the record check reads it. */
interface RecSet { id: string; kind: string; done?: boolean; weightKg: number | string | null; reps: number | null; durationS: number | null; distanceM: number | string | null }

/** The records each of `sets` breaks against `prev` (the exercise's earlier working sets), in order, so a set also
 * counts the ones before it and a record is flagged once, not on every set that matches it. Kinds: weight, e1rm,
 * volume, reps, duration, distance. `prev` grows with the sets checked. */
function flagRecords(tracking: string | undefined, prev: RecSet[], sets: RecSet[], out: Map<string, string[]>) {
  // assisted exercises log the help taken off as weight: less help is the better lift, and help isn't weight lifted
  const assisted = tracking === "assisted";
  const wt = (s: RecSet) => Number(s.weightKg) || 0;
  const best = (f: (s: RecSet) => number) => Math.max(0, ...prev.map(f));
  for (const s of sets) {
    if (!s.done || s.kind === "warmup") continue;
    const f: string[] = [];
    const kg = wt(s), reps = s.reps ?? 0;
    if (assisted) {
      const helped = prev.filter((p) => p.weightKg != null && (p.reps ?? 0) > 0);
      if (s.weightKg != null && reps > 0 && helped.length && kg < Math.min(...helped.map(wt))) f.push("weight");
    } else {
      if (kg > 0 && kg > best(wt)) f.push("weight");
      if ((e1rm(kg, reps) ?? 0) > best((p) => e1rm(wt(p), p.reps) ?? 0) + 0.01) f.push("e1rm");
      const v = liftedKg(kg, reps, tracking);
      if (v > 0 && v > best((p) => liftedKg(wt(p), p.reps, tracking))) f.push("volume");
    }
    // most reps at this weight or more (assisted: this much help or less). A set without weight (push-ups, reps only)
    // is weighed against every set, so it is simply the most reps
    if (reps > 0 && !f.includes("weight")) {
      const most = Math.max(0, ...prev.filter((p) => (assisted ? wt(p) <= kg : wt(p) >= kg)).map((p) => p.reps ?? 0));
      if (reps > most) f.push("reps");
    }
    if ((s.durationS ?? 0) > best((p) => p.durationS ?? 0)) f.push("duration");
    if ((Number(s.distanceM) || 0) > best((p) => Number(p.distanceM) || 0)) f.push("distance");
    if (f.length) out.set(s.id, f);
    prev.push(s);
  }
}

/** Records set in this workout: each done set compared with the best of every earlier session of that exercise and the
 * sets before it in this one. */
async function recordsIn(q: Sql, w: any, exercises: any[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const we of exercises) {
    const before = (await exerciseSessions(q, we.exerciseId, 500)).filter((s) => s.startedAt < w.startedAt && s.workoutId !== w.id);
    if (!before.length) continue; // the first time is not a record
    const prev: RecSet[] = before.flatMap((s) => s.sets).filter((s: RecSet) => s.kind !== "warmup");
    flagRecords(we.exercise?.tracking, prev, we.sets, out);
  }
  return out;
}

/** Records set since `since`, newest workout first, at most `limit`. Two queries whatever the history: every done set of
 * the exercises done since then (their whole history, as a record is against all of it), then their names; the same
 * check as a workout's own records, worked out in memory. */
export async function recentRecords(q: Sql, since: string, limit = 6): Promise<HomeRecord[]> {
  const { rows } = await q.query<{ id: string; kind: string; weight_kg: string | null; reps: number | null; duration_s: number | null; distance_m: string | null;
    we_id: string; exercise_id: string; tracking: Tracking; workout_id: string; started_at: string | Date }>(
    `SELECT s.id, s.kind, s.weight_kg, s.reps, s.duration_s, s.distance_m, we.id AS we_id, we.exercise_id, e.tracking, w.id AS workout_id, w.started_at
     FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
     WHERE s.done AND w.status = 'completed' AND we.exercise_id IN (
       SELECT x.exercise_id FROM workout_exercises x JOIN workouts y ON y.id = x.workout_id WHERE y.status = 'completed' AND y.started_at >= $1)
       AND we.id IN (SELECT id FROM (SELECT we2.id, row_number() OVER (PARTITION BY we2.exercise_id ORDER BY w2.started_at DESC, w2.id DESC) AS rn
         FROM workout_exercises we2 JOIN workouts w2 ON w2.id = we2.workout_id WHERE w2.status = 'completed') z WHERE z.rn <= 500)
     ORDER BY w.started_at, w.id, we.position, s.position`, [since]);
  // per exercise, its sessions (one per workout exercise) in time order
  const byEx = new Map<string, { weId: string; workoutId: string; at: string; tracking: Tracking; sets: RecSet[] }[]>();
  for (const r of rows) {
    const at = new Date(r.started_at).toISOString();
    const list = byEx.get(r.exercise_id) ?? byEx.set(r.exercise_id, []).get(r.exercise_id)!;
    let sess = list.at(-1);
    if (sess?.weId !== r.we_id) list.push(sess = { weId: r.we_id, workoutId: r.workout_id, at, tracking: r.tracking, sets: [] });
    sess.sets.push({ id: r.id, kind: r.kind, done: true, weightKg: r.weight_kg == null ? null : Number(r.weight_kg), reps: r.reps, durationS: r.duration_s, distanceM: r.distance_m == null ? null : Number(r.distance_m) });
  }
  const found: Omit<HomeRecord, "name">[] = [];
  for (const [exerciseId, list] of byEx) {
    list.forEach((sess, i) => {
      if (sess.at < since) return;
      // as in a workout: earlier sessions of other workouts, and the first time is not a record
      const prev = list.slice(0, i).filter((p) => p.at < sess.at && p.workoutId !== sess.workoutId).flatMap((p) => p.sets).filter((s) => s.kind !== "warmup");
      if (!prev.length) return;
      const flags = new Map<string, string[]>();
      flagRecords(sess.tracking, prev, sess.sets, flags);
      const top = sess.sets.filter((s) => flags.has(s.id)).sort((a, b) => flags.get(b.id)!.length - flags.get(a.id)!.length)[0];
      if (top) found.push({ workoutId: sess.workoutId, at: sess.at, exerciseId, tracking: sess.tracking, kinds: flags.get(top.id)!,
        weightKg: top.weightKg == null ? null : Number(top.weightKg), reps: top.reps, durationS: top.durationS, distanceM: top.distanceM == null ? null : Number(top.distanceM) });
    });
  }
  const out = found.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  const names = await getExercises(q, [...new Set(out.map((x) => x.exerciseId))]);
  return out.map((x) => ({ ...x, name: names.get(x.exerciseId)?.name ?? "" }));
}

export async function loadWorkout(q: Sql, workoutId: string, today: string): Promise<Workout | null> {
  const w = (await q.query("SELECT * FROM workouts WHERE id = $1", [workoutId])).rows[0];
  if (!w) return null;
  const wes = (await q.query("SELECT * FROM workout_exercises WHERE workout_id = $1 ORDER BY position", [workoutId])).rows;
  const sets = wes.length ? (await q.query("SELECT * FROM workout_sets WHERE workout_exercise_id = ANY($1::uuid[]) ORDER BY position", [wes.map((e: any) => e.id)])).rows : [];
  const exs = await getExercises(q, wes.map((e: any) => e.exercise_id));
  const workout = camel<any>(w);
  delete workout.userId;
  // the exercise each routine slot holds: a slot holding another one was swapped during this workout (it keeps the
  // slot, so Finish can offer "Swapped"), and what is written for the slot belongs to the exercise it holds
  const reIds = wes.map((e: any) => e.routine_exercise_id).filter(Boolean);
  const slotEx = new Map<string, string>(reIds.length ? (await q.query("SELECT id, exercise_id FROM routine_exercises WHERE id = ANY($1::uuid[])", [reIds])).rows
    .map((r: { id: string; exercise_id: string }) => [r.id, r.exercise_id]) : []);
  // "Previous": the same set in the last completed session of that exercise before this workout
  const prevByEx = new Map<string, any[]>();
  for (const e of wes) {
    if (prevByEx.has(e.exercise_id)) continue;
    const hist = await exerciseSessions(q, e.exercise_id, 3, w.status === "in_progress" && w.routine_id ? w.routine_id : null);
    const fallback = hist.length ? hist : await exerciseSessions(q, e.exercise_id, 3);
    prevByEx.set(e.exercise_id, (fallback.find((h) => h.workoutId !== w.id && h.startedAt < w.started_at)?.sets) ?? []);
  }
  // what the server plans a set's rest from (replanRests), so the workout screen can show a set's new rest at once
  const snap: Pick<Routine, "exercises"> | null = typeof w.routine_snapshot === "string" ? JSON.parse(w.routine_snapshot) : w.routine_snapshot;
  const prefs = new Map<string, { rest_s: number | null; rest_after_s: number | null }>(wes.length ? (await q.query("SELECT exercise_id, rest_s, rest_after_s FROM exercise_prefs WHERE exercise_id = ANY($1::uuid[])",
    [wes.map((e: any) => e.exercise_id)])).rows.map((r: any) => [r.exercise_id, r]) : []);
  workout.exercises = wes.map((e: any) => {
    const x = camel<any>(e);
    delete x.userId; delete x.workoutId;
    const re = e.routine_exercise_id ? snap?.exercises?.find((r) => r.id === e.routine_exercise_id) : undefined;
    x.restByKind = re?.restByKind ?? null;
    x.routineSetRests = re?.sets?.map((r) => r.restS ?? null) ?? null;
    x.prefRestS = prefs.get(e.exercise_id)?.rest_s ?? null;
    x.prefRestAfterS = prefs.get(e.exercise_id)?.rest_after_s ?? null;
    x.swapped = !!e.routine_exercise_id && slotEx.has(e.routine_exercise_id) && slotEx.get(e.routine_exercise_id) !== e.exercise_id;
    x.exercise = exs.get(e.exercise_id);
    const prev = prevByEx.get(e.exercise_id) ?? [];
    const work = prev.filter((s) => s.kind !== "warmup");
    // the whole of last session's working sets too (prev pairs them by position, so a set fewer today has no pair):
    // the Finish screen compares sessions with it. Already loaded above, so no extra query.
    x.last = work.map((p) => ({ weightKg: p.weightKg, reps: p.reps, durationS: p.durationS, distanceM: p.distanceM }));
    // each set with last time's in turn: warm-ups with warm-ups, a left set with last time's left ones (pairSets)
    const mine = sets.filter((s: any) => s.workout_exercise_id === e.id);
    const pairs = pairSets(mine, prev);
    x.sets = mine.map((s: any, i: number) => {
      const c = camel<any>(s);
      delete c.userId; delete c.workoutExerciseId;
      const p = pairs[i];
      c.prev = p ? { weightKg: p.weightKg, reps: p.reps, durationS: p.durationS, distanceM: p.distanceM } : null;
      return c;
    });
    return x;
  });
  const prs = await recordsIn(q, workout, workout.exercises);
  for (const e of workout.exercises) for (const s of e.sets) s.pr = prs.get(s.id) ?? [];
  // reminders and notes shown during the workout
  const rem = await pendingReminders(q, { routineId: w.routine_id, exerciseIds: wes.map((e: any) => e.exercise_id), today });
  workout.reminders = rem.filter((r) => r.targetType === "routine");
  const noteRows = (await q.query(
    `SELECT n.*, ww.name AS workout_name FROM notes n LEFT JOIN workouts ww ON ww.id = n.workout_id
     WHERE (n.workout_id = $1) OR (n.pinned AND ((n.target_type = 'exercise' AND n.target_id = ANY($2::uuid[]))
        OR (n.target_type = 'routine_exercise' AND n.target_id = ANY($3::uuid[])) OR (n.target_type = 'routine' AND n.target_id = $4)))
        OR (n.target_type = 'workout' AND n.target_id = $1)
     ORDER BY n.created_at`, [workoutId, wes.map((e: any) => e.exercise_id), wes.map((e: any) => e.routine_exercise_id).filter(Boolean), w.routine_id])).rows.map((n: any) => camel(n));
  workout.routineNotes = noteRows.filter((n: any) => n.targetType === "routine" || n.targetType === "workout");
  for (const e of workout.exercises) {
    e.reminders = rem.filter((r) => r.targetType === "exercise" && r.targetId === e.exerciseId);
    e.notes = noteRows.filter((n: any) => (n.targetType === "exercise" && n.targetId === e.exerciseId) || (n.targetType === "routine_exercise" && n.targetId === e.routineExerciseId && !e.swapped) || (n.targetType === "workout_exercise" && n.targetId === e.id));
  }
  return workout as Workout;
}

/** The detail page's extra numbers: totals, time split, and how it compares with last time. */
async function workoutReport(q: Sql, w: any) {
  const done = w.exercises.flatMap((e: any) => e.sets.filter((s: any) => s.done));
  const work = done.filter((s: any) => s.kind !== "warmup");
  const end = w.endedAt ?? new Date().toISOString();
  const durationS = Math.max(0, secondsBetween(w.startedAt, end) - (w.pausedS ?? 0));
  const restS = done.reduce((a: number, s: any) => a + (s.restActualS ?? 0), 0);
  const totals = {
    durationS, restS, activeS: Math.max(0, durationS - restS), sets: done.length, workingSets: work.length,
    reps: work.reduce((a: number, s: any) => a + (s.reps ?? 0), 0), volumeKg: w.exercises.reduce((a: number, e: any) => a + e.sets.filter((s: any) => s.done && s.kind !== "warmup")
      .reduce((b: number, s: any) => b + liftedKg(s.weightKg, s.reps, e.exercise?.tracking), 0), 0),
    exercises: w.exercises.filter((e: any) => e.status !== "skipped").length, skipped: w.exercises.filter((e: any) => e.status === "skipped").length,
    records: done.filter((s: any) => s.pr?.length).length,
    avgRestS: done.filter((s: any) => s.restActualS != null).length ? Math.round(restS / done.filter((s: any) => s.restActualS != null).length) : null,
  };
  // the previous time this routine was done
  let previous: any = null;
  if (w.routineId) {
    const p = (await q.query(
      `SELECT w.id, w.started_at, ${DURATION_SQL} AS duration_s, ${VOLUME_SQL} AS volume_kg FROM workouts w
       WHERE w.routine_id = $1 AND w.status = 'completed' AND w.started_at < $2 AND w.id <> $3 ORDER BY w.started_at DESC LIMIT 1`,
      [w.routineId, w.startedAt, w.id])).rows[0];
    if (p) previous = { id: p.id, startedAt: p.started_at, durationS: Number(p.duration_s), volumeKg: Number(p.volume_kg) };
  }
  // per exercise: compared with its own last session
  const perExercise = [];
  for (const e of w.exercises) {
    if (e.status === "skipped") continue;
    const hist = (await exerciseSessions(q, e.exerciseId, 10)).filter((s) => s.startedAt < w.startedAt && s.workoutId !== w.id);
    const last = hist[0];
    const sw = e.sets.filter((s: any) => s.done && s.kind !== "warmup");
    const now = {
      volumeKg: sw.reduce((a: number, s: any) => a + liftedKg(s.weightKg, s.reps, e.exercise?.tracking), 0),
      // an assisted exercise's "weight" is help, so it has no one-rep max; it's judged on reps
      e1rm: e.exercise?.tracking === "assisted" ? null : Math.max(0, ...sw.map((s: any) => e1rm(s.weightKg, s.reps) ?? 0)) || null,
      maxWeightKg: Math.max(0, ...sw.map((s: any) => s.weightKg ?? 0)) || null,
      reps: sw.reduce((a: number, s: any) => a + (s.reps ?? 0), 0),
    };
    const verdict = !last ? "first" : (now.e1rm ?? 0) > (last.e1rm ?? 0) + 0.01 || now.volumeKg > last.volumeKg + 0.01 || (!now.e1rm && now.reps > last.reps) ? "better"
      : (now.e1rm ?? 0) < (last.e1rm ?? 0) - 0.01 && now.volumeKg < last.volumeKg ? "worse" : "same";
    perExercise.push({ workoutExerciseId: e.id, exerciseId: e.exerciseId, name: e.exercise?.name, now, last: last ? { startedAt: last.startedAt, volumeKg: last.volumeKg, e1rm: last.e1rm, maxWeightKg: last.maxWeightKg, reps: last.reps } : null, verdict });
  }
  const muscles: Record<string, number> = {};
  for (const e of w.exercises) {
    const n = e.sets.filter((s: any) => s.done && s.kind !== "warmup").length;
    if (!n) continue;
    for (const m of e.exercise?.primaryMuscles ?? []) muscles[m] = (muscles[m] ?? 0) + n;
    for (const m of e.exercise?.secondaryMuscles ?? []) muscles[m] = (muscles[m] ?? 0) + n * 0.5;
  }
  return { totals, previous, perExercise, muscles, beat: perExercise.filter((p) => p.verdict === "better").length, compared: perExercise.filter((p) => p.verdict !== "first").length };
}

const clientSetId = (s: any): string | null => typeof s?.id === "string" && /^[0-9a-f-]{36}$/i.test(s.id) ? s.id : null;

async function insertSets(ctx: Ctx, weId: string, sets: any[], startPos = 0) {
  for (const [i, s] of sets.entries()) {
    const given = clientSetId(s);
    // A set with the device's own id may arrive twice: the first send timed out on the phone after the server had
    // saved it, and the outbox sends it again. The second time it is already there, which is fine when it is this
    // user's set; an id taken by someone else's row is refused (and says nothing about that row).
    const res = await ctx.q.query(
      `INSERT INTO workout_sets (id, user_id, workout_exercise_id, position, kind, weight_kg, reps, duration_s, distance_m, rpe, rir, side, done, done_at,
         rest_planned_s, rest_actual_s, target_reps, target_weight_kg, prefilled, target_reps_max, start_weight_kg, start_reps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)${given ? " ON CONFLICT (id) DO NOTHING" : ""} RETURNING id`,
      [given ?? uuidv7(), ctx.userId, weId, startPos + i, oneOf(s.kind, KINDS, "normal"), numOrNull(s.weightKg, -500, 2000), intOrNull(s.reps, 0, 10000),
        intOrNull(s.durationS, 0, 86400), numOrNull(s.distanceM, 0, 1e7), numOrNull(s.rpe, 0, 10), numOrNull(s.rir, 0, 20), s.side ? str(s.side, 5) : null,
        bool(s.done), s.done ? (s.doneAt ? isoTime(s.doneAt) : ctx.now().toISOString()) : null, intOrNull(s.restS ?? s.restPlannedS, 0, 3600),
        intOrNull(s.restActualS, 0, 86400), intOrNull(s.targetReps, 0, 10000), numOrNull(s.targetWeightKg, -500, 2000), bool(s.prefilled), intOrNull(s.targetRepsMax, 0, 10000),
        numOrNull(s.startWeightKg, -500, 2000), intOrNull(s.startReps, 0, 10000)]);
    if (!res.rows.length && !(await ownSet(ctx, given!, weId))) throw bad("That set id is already in use");
  }
}
const ownSet = async (ctx: Ctx, setId: string, weId: string) =>
  (await ctx.q.query("SELECT 1 FROM workout_sets WHERE id = $1 AND user_id = $2 AND workout_exercise_id = $3", [setId, ctx.userId, weId])).rows.length > 0;

async function addExercise(ctx: Ctx, workoutId: string, x: { exerciseId: string; routineExerciseId?: string | null; position: number; superset?: string | null; restS?: number | null; restAfterS?: number | null; repRestS?: number | null; sets: any[] }) {
  const weId = uuidv7();
  await visible(ctx.q, "exercises", x.exerciseId, "exercise");
  await ctx.q.query(
    `INSERT INTO workout_exercises (id, user_id, workout_id, exercise_id, routine_exercise_id, position, superset, rest_s, rest_after_s, rep_rest_s)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [weId, ctx.userId, workoutId, x.exerciseId, x.routineExerciseId ?? null, x.position, x.superset ?? null, x.restS ?? null, x.restAfterS ?? null, x.repRestS ?? null]);
  await insertSets(ctx, weId, x.sets);
  return weId;
}

/** Sets for an exercise added on the fly: its last session's sets, or three empty ones (no routine holds numbers for it). */
async function freshSets(ctx: Ctx, exerciseId: string) {
  const last = (await exerciseSessions(ctx.q, exerciseId, 1))[0];
  if (last?.sets.length) return last.sets.map((s: any) => ({ kind: s.kind, weightKg: s.weightKg, reps: s.reps, durationS: s.durationS, distanceM: s.distanceM, prefilled: true }));
  return [0, 1, 2].map(() => ({ kind: "normal" }));
}

/** A workout planned on the spot (same shape as a routine's body) as an unsaved routine, so buildPlan fills it the same
 * way: last time's numbers, rests per kind and per set, supersets. Cleaned like writeRoutineBody does. */
async function plannedRoutine(ctx: Ctx, exercises: unknown) {
  if (!Array.isArray(exercises)) throw bad("Expected a list of exercises");
  if (exercises.length > 100) throw bad("Too many exercises");
  const exIds = exercises.map((e: any) => id(e?.exerciseId, "exercise"));
  for (const x of new Set(exIds)) await visible(ctx.q, "exercises", x, "exercise");
  const exs = await getExercises(ctx.q, exIds);
  const byKind = (v: any) => {
    if (!v || typeof v !== "object") return null;
    const out: Record<string, number> = {};
    for (const k of ["warmup", "drop", "failure"]) { const n = intOrNull(v[k], 0, 3600); if (n != null) out[k] = n; }
    return Object.keys(out).length ? out : null;
  };
  return {
    id: null,
    exercises: exercises.map((e: any, i: number) => ({
      id: null, exerciseId: exIds[i], exercise: exs.get(exIds[i]!), superset: e.superset ? str(e.superset, 20) : null,
      restS: intOrNull(e.restS, 0, 3600), restAfterS: intOrNull(e.restAfterS, 0, 3600), repRestS: intOrNull(e.repRestS, 0, 600), restByKind: byKind(e.restByKind),
      fixed: bool(e.fixed) || e.prefill === "target", progression: null, note: str(e.note, 2000),
      sets: (Array.isArray(e.sets) ? e.sets.slice(0, 50) : []).map((s: any) => ({
        kind: oneOf(s?.kind, KINDS, "normal"), reps: intOrNull(s?.reps, 0, 1000), repsMax: intOrNull(s?.repsMax, 0, 1000), startReps: intOrNull(s?.startReps, 0, 1000), weightKg: numOrNull(s?.weightKg, -500, 2000),
        durationS: intOrNull(s?.durationS, 0, 86400), distanceM: numOrNull(s?.distanceM, 0, 1e7), rpe: numOrNull(s?.rpe, 0, 10), restS: intOrNull(s?.restS, 0, 3600),
        side: s?.side === "L" || s?.side === "R" ? s.side : null,
      })),
    })),
  };
}

async function touch(ctx: Ctx, workoutId: string) {
  await ctx.q.query("UPDATE workouts SET updated_at = now() WHERE id = $1", [workoutId]);
}
async function workoutOfExercise(q: Sql, weId: string): Promise<string> {
  const r = (await q.query("SELECT workout_id FROM workout_exercises WHERE id = $1", [weId])).rows[0];
  if (!r) throw notFound("Exercise not found in workout");
  return r.workout_id;
}
async function workoutOfSet(q: Sql, setId: string): Promise<{ workoutId: string; weId: string }> {
  const r = (await q.query("SELECT we.workout_id, we.id FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE s.id = $1", [setId])).rows[0];
  if (!r) throw notFound("Set not found");
  return { workoutId: r.workout_id, weId: r.id };
}

/** A workout set as replanRests reads it. */
interface RestSetRow { id: string; kind: SetKind; side: string | null; done: boolean; rest_planned_s: number | null }
/** What a set's planned rest is worked out from that can change during a workout. */
interface RestInputs { restS: number | null; restAfterS: number | null; kinds: SetKind[]; sides: (string | null)[] }

/**
 * Plans the rest after some sets again, the way Start planned it (buildPlan): a set's planned rest is fixed at Start
 * from its kind and the exercise's rests, so a set made a warm-up during the workout, or an exercise given a new rest
 * between sets, would otherwise keep resting as before. The routine set's own rest from the routine as it was at Start
 * (its snapshot, by position), then by kind, the exercise's rests as they are now, then the exercise's and the
 * person's defaults. With `before` (the inputs as they were before the change), a set is planned again only while its
 * rest is still what the old plan gave it: a rest the person set on that one set stays theirs.
 */
async function replanRests(ctx: Ctx, weId: string, pick: (s: RestSetRow, i: number, sets: RestSetRow[]) => boolean, before?: (now: RestInputs, sets: RestSetRow[]) => RestInputs,
  keptOwn?: (i: number, sets: RestSetRow[]) => boolean) {
  const we = (await ctx.q.query(
    `SELECT we.*, w.routine_snapshot, w.settings AS w_settings,
       (SELECT n.superset FROM workout_exercises n WHERE n.workout_id = we.workout_id AND n.position > we.position ORDER BY n.position LIMIT 1) AS next_superset
     FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE we.id = $1 AND w.status = 'in_progress'`, [weId])).rows[0];
  if (!we) return;
  const sets: RestSetRow[] = (await ctx.q.query("SELECT id, kind, side, done, rest_planned_s FROM workout_sets WHERE workout_exercise_id = $1 ORDER BY position", [weId])).rows;
  const d = restDefaultsOf(withWorkoutOverrides(await getSettings(ctx.q, ctx.userId), we.w_settings).workout);
  const pref = (await ctx.q.query("SELECT rest_s, rest_after_s FROM exercise_prefs WHERE exercise_id = $1", [we.exercise_id])).rows[0];
  const snap: Pick<Routine, "exercises"> | null = typeof we.routine_snapshot === "string" ? JSON.parse(we.routine_snapshot) : we.routine_snapshot;
  const re = we.routine_exercise_id ? snap?.exercises?.find((x) => x.id === we.routine_exercise_id) : undefined;
  // the routine set's own rest by position (planSetRest); a change of kind keeps the match: the routine set's own
  // rest stays through it, as it does at Start
  const routineSetRests = re?.sets?.map((x) => x.restS ?? null) ?? null;
  // `keptOwn`: a rest kept from now on (keepRest) takes the place of the routine sets' own rests it covers, in this
  // workout too: dropped from its copy of the routine, so the plan below and every later one rest by the kept rest
  const nowSetRests = keptOwn && routineSetRests ? routineSetRests.map((x, i) => (keptOwn(i, sets) ? null : x)) : routineSetRests;
  if (re?.sets && nowSetRests !== routineSetRests) {
    re.sets.forEach((x, i) => { x.restS = nowSetRests![i] ?? null; });
    await ctx.q.query("UPDATE workouts SET routine_snapshot = $2 WHERE id = $1", [we.workout_id, JSON.stringify(snap)]);
  }
  // inside a superset round there is no rest (as at Start)
  const inRound = !!we.superset && we.next_superset === we.superset;
  const plan = (i: number, x: RestInputs, own = nowSetRests) => inRound ? 0 : planSetRest(x.kinds.map((kind, n) => ({ kind, side: x.sides[n] })), i,
    { restS: x.restS, restAfterS: x.restAfterS, prefRestS: pref?.rest_s, prefRestAfterS: pref?.rest_after_s, restByKind: re?.restByKind, routineSetRests: own }, d);
  const now: RestInputs = { restS: we.rest_s, restAfterS: we.rest_after_s, kinds: sets.map((s) => s.kind), sides: sets.map((s) => s.side) };
  const was = before?.(now, sets);
  for (const [i, s] of sets.entries()) {
    if (!pick(s, i, sets)) continue;
    // no rest of its own (null) follows the plan too. The old plan uses today's settings: had the defaults changed
    // since Start, the rest no longer matches and is left as it is, which errs on the side of keeping it
    if (was && s.rest_planned_s != null && s.rest_planned_s !== plan(i, was, routineSetRests)) continue;
    const secs = plan(i, now);
    if (secs !== s.rest_planned_s) await ctx.q.query("UPDATE workout_sets SET rest_planned_s = $2 WHERE id = $1", [s.id, secs]);
  }
}

export function workoutRoutes(r: Router) {
  r.get("/workouts", async ({ q }, _p, _b, qs) => {
    const conds = ["w.status = 'completed'"], params: unknown[] = [];
    if (qs.from) { params.push(qs.from); conds.push(`w.started_at >= $${params.length}`); }
    if (qs.to) { params.push(qs.to); conds.push(`w.started_at < $${params.length}`); }
    if (qs.routineId) { params.push(id(qs.routineId)); conds.push(`w.routine_id = $${params.length}`); }
    if (qs.q) { params.push(`%${qs.q}%`); conds.push(`w.name ILIKE $${params.length}`); }
    return workoutSummaries(q, conds.join(" AND "), params, Math.min(1000, Number(qs.limit) || 100));
  });

  r.get("/workouts/active", async (ctx) => {
    const a = (await ctx.q.query("SELECT id FROM workouts WHERE status = 'in_progress' ORDER BY started_at DESC LIMIT 1")).rows[0];
    return a ? loadWorkout(ctx.q, a.id, ymd(ctx.now())) : null;
  });

  r.get("/workouts/:id", async (ctx, p) => {
    const w = await loadWorkout(ctx.q, id(p.id), ymd(ctx.now()));
    if (!w) throw notFound("Workout not found");
    const report = await workoutReport(ctx.q, w);
    const nav = (await ctx.q.query(
      `SELECT (SELECT id FROM workouts WHERE status = 'completed' AND started_at < $1 ORDER BY started_at DESC LIMIT 1) AS prev_id,
              (SELECT id FROM workouts WHERE status = 'completed' AND started_at > $1 ORDER BY started_at LIMIT 1) AS next_id`, [w.startedAt])).rows[0];
    const reminders = (await ctx.q.query("SELECT * FROM reminders WHERE created_workout_id = $1 ORDER BY created_at", [w.id])).rows.map((x: any) => camel(x));
    return { ...w, report, prevId: nav.prev_id, nextId: nav.next_id, createdReminders: reminders };
  });

  r.post("/workouts/start", async (ctx, _p, b) => {
    const active = (await ctx.q.query("SELECT id FROM workouts WHERE status = 'in_progress' LIMIT 1")).rows[0];
    if (active && !b.force) throw new HttpError(409, "A workout is already in progress");
    if (active && b.force) await ctx.q.query("DELETE FROM workouts WHERE id = $1", [active.id]);
    if (b.programId) await visible(ctx.q, "programs", id(b.programId), "program");
    if (b.clientId) {
      const dup = (await ctx.q.query("SELECT id FROM workouts WHERE client_id = $1", [str(b.clientId, 80)])).rows[0];
      if (dup) return loadWorkout(ctx.q, dup.id, ymd(ctx.now()));
    }
    const wid = uuidv7();
    await visible(ctx.q, "schedules", optId(b.scheduleId), "schedule");
    const settings = await getSettings(ctx.q, ctx.userId);
    let name = str(b.name, 120).trim() || "Workout", routine: any = null;
    if (b.routineId) {
      routine = await loadRoutine(ctx.q, id(b.routineId));
      if (!routine) throw notFound("Routine not found");
      name = routine.name;
    }
    // planned on the spot (no routine): filled exactly like a routine, but the workout points at no routine
    const planned = !routine && Array.isArray(b.exercises) ? await plannedRoutine(ctx, b.exercises) : null;
    const startedAt = b.startedAt ? isoTime(b.startedAt) : ctx.now().toISOString();
    await ctx.q.query(
      `INSERT INTO workouts (id, user_id, routine_id, routine_snapshot, name, status, started_at, settings, client_id, schedule_id, scheduled_date)
       VALUES ($1,$2,$3,$4,$5,'in_progress',$6,$7,$8,$9,$10)`,
      [wid, ctx.userId, routine?.id ?? null, routine ? JSON.stringify(routine) : null, name, startedAt, JSON.stringify(b.settings ?? {}),
        b.clientId ? str(b.clientId, 80) : null, optId(b.scheduleId), b.scheduledDate ?? null]);
    if (b.programId) await ctx.q.query("UPDATE workouts SET program_id = $2 WHERE id = $1", [wid, b.programId]);
    if (routine || planned) {
      // the start screen's Workout settings for this workout only count here too (rests and the rest)
      const plan = await buildPlan(ctx.q, routine ?? planned, withWorkoutOverrides(settings, b.settings), ymd(ctx.now()));
      // a deload week in a program: lighter working weights
      if (b.deloadPct) for (const e of plan.exercises) for (const s of e.sets) if (s.kind !== "warmup" && s.weightKg) { s.weightKg = Math.round((s.weightKg * (1 - Number(b.deloadPct) / 100)) / 1.25) * 1.25; s.adjusted = true; }
      const skip = new Set<string>(Array.isArray(b.skip) ? b.skip : []);
      const order: string[] | null = Array.isArray(b.order) ? b.order : null;
      let exs = plan.exercises;
      if (order) exs = [...exs].sort((a, c) => order.indexOf(a.routineExerciseId ?? "") - order.indexOf(c.routineExerciseId ?? ""));
      let pos = 0;
      for (const e of exs) {
        const weId = await addExercise(ctx, wid, { ...e, position: pos++, sets: e.sets.map((s) => ({ ...s, restPlannedS: s.restS, startWeightKg: s.weightKg, startReps: s.reps })) });
        if (e.routineExerciseId && skip.has(e.routineExerciseId)) await ctx.q.query("UPDATE workout_exercises SET status = 'skipped', skip_reason = 'Skipped before starting' WHERE id = $1", [weId]);
      }
    } else if (Array.isArray(b.exerciseIds)) {
      for (const [i, exId] of b.exerciseIds.entries()) await addExercise(ctx, wid, { exerciseId: id(exId), position: i, sets: await freshSets(ctx, exId) });
    }
    ctx.changed("workout");
    return loadWorkout(ctx.q, wid, ymd(ctx.now()));
  });

  r.put("/workouts/:id", async (ctx, p, b) => {
    const wid = id(p.id);
    const w = (await ctx.q.query("SELECT * FROM workouts WHERE id = $1", [wid])).rows[0];
    if (!w) throw notFound("Workout not found");
    const sets: string[] = [], vals: unknown[] = [wid];
    const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ("name" in b) put("name", str(b.name, 120).trim() || w.name);
    if ("notes" in b) put("notes", str(b.notes, 10000));
    if ("rating" in b) put("rating", intOrNull(b.rating, 1, 5));
    if ("bodyweightKg" in b) put("bodyweight_kg", numOrNull(b.bodyweightKg, 0, 700));
    if ("startedAt" in b) put("started_at", isoTime(b.startedAt));
    if ("endedAt" in b) put("ended_at", b.endedAt ? isoTime(b.endedAt) : null);
    if ("settings" in b) put("settings", JSON.stringify(b.settings ?? {}));
    if ("pausedS" in b) put("paused_s", intOrNull(b.pausedS, 0, 864000) ?? 0);
    if (b.pause === true && !w.pause_started_at) put("pause_started_at", ctx.now().toISOString());
    if (b.pause === false && w.pause_started_at) {
      put("paused_s", w.paused_s + secondsBetween(w.pause_started_at, ctx.now()));
      put("pause_started_at", null);
    }
    put("updated_at", ctx.now().toISOString());
    await ctx.q.query(`UPDATE workouts SET ${sets.join(", ")} WHERE id = $1`, vals);
    ctx.changed("workout");
    return { ok: true };
  });

  r.post("/workouts/:id/exercises", async (ctx, p, b) => {
    const wid = id(p.id);
    const exId = id(b.exerciseId, "exercise");
    const n = Number((await ctx.q.query("SELECT count(*) AS n FROM workout_exercises WHERE workout_id = $1", [wid])).rows[0].n);
    const pos = b.position == null ? n : Math.max(0, Math.min(n, Number(b.position)));
    await ctx.q.query("UPDATE workout_exercises SET position = position + 1 WHERE workout_id = $1 AND position >= $2", [wid, pos]);
    const weId = await addExercise(ctx, wid, { exerciseId: exId, position: pos, sets: Array.isArray(b.sets) ? b.sets : await freshSets(ctx, exId) });
    // added to a finished workout (editing it afterwards): it counts as done
    await ctx.q.query("UPDATE workout_exercises SET status = 'done' WHERE id = $1 AND (SELECT status FROM workouts WHERE id = $2) = 'completed'", [weId, wid]);
    await touch(ctx, wid);
    ctx.changed("workout");
    return { id: weId };
  });

  r.post("/workouts/:id/reorder", async (ctx, p, b) => {
    const wid = id(p.id);
    const ids: string[] = (Array.isArray(b.ids) ? b.ids : []).map((x: unknown) => id(x));
    for (const [i, weId] of ids.entries()) await ctx.q.query("UPDATE workout_exercises SET position = $3 WHERE id = $1 AND workout_id = $2", [weId, wid, i]);
    await touch(ctx, wid);
    ctx.changed("workout");
    return { ok: true };
  });

  r.put("/workout-exercises/:id", async (ctx, p, b) => {
    const weId = id(p.id);
    const wid = await workoutOfExercise(ctx.q, weId);
    const sets: string[] = [], vals: unknown[] = [weId];
    const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ("status" in b) put("status", oneOf(b.status, EX_STATUS, "pending"));
    if ("skipReason" in b) put("skip_reason", b.skipReason ? str(b.skipReason, 200) : null);
    if ("restS" in b) put("rest_s", intOrNull(b.restS, 0, 3600));
    if ("restAfterS" in b) put("rest_after_s", intOrNull(b.restAfterS, 0, 3600));
    if ("repRestS" in b) put("rep_rest_s", intOrNull(b.repRestS, 0, 600));
    if ("superset" in b) put("superset", b.superset ? str(b.superset, 20) : null);
    if ("startedAt" in b) put("started_at", b.startedAt ? isoTime(b.startedAt) : null);
    if ("endedAt" in b) put("ended_at", b.endedAt ? isoTime(b.endedAt) : null);
    if ("exerciseId" in b) {
      await visible(ctx.q, "exercises", id(b.exerciseId, "exercise"), "exercise");
      // replace the exercise: keep the set structure, take last time's numbers for the new exercise (its own history,
      // never the slot's). It keeps its routine slot, so Finish lists it as "Swapped" (not removed + added); while the
      // slot still holds the old exercise, the slot's pinned notes aren't shown on the new one (loadWorkout), and the slot's
      // numbers and Progression move to the new one only once the swap is saved (planNext matches slot and exercise)
      put("exercise_id", id(b.exerciseId, "exercise"));
      const last = (await exerciseSessions(ctx.q, b.exerciseId, 1))[0];
      const cur = (await ctx.q.query("SELECT id, kind FROM workout_sets WHERE workout_exercise_id = $1 AND NOT done ORDER BY position", [weId])).rows;
      const lw = last?.sets.filter((s: any) => s.kind !== "warmup") ?? [];
      for (const [i, s] of cur.entries()) {
        const l = lw[i] ?? lw.at(-1);
        await ctx.q.query("UPDATE workout_sets SET weight_kg = $2, reps = $3, duration_s = $4, distance_m = $5, prefilled = $6 WHERE id = $1",
          [s.id, l?.weightKg ?? null, l?.reps ?? null, l?.durationS ?? null, l?.distanceM ?? null, !!l]);
      }
    }
    if (!sets.length) return { ok: true };
    const restsWere = "restS" in b || "restAfterS" in b
      ? (await ctx.q.query("SELECT rest_s, rest_after_s FROM workout_exercises WHERE id = $1", [weId])).rows[0] : null;
    await ctx.q.query(`UPDATE workout_exercises SET ${sets.join(", ")} WHERE id = $1`, vals);
    // a new rest between sets or after the exercise counts for the sets still to do, except one whose rest differs from
    // what the old rests gave it: that rest was set on that one set (-15 / +15, "Rest" on the set) and stays
    // "Use 3:30 for this exercise from now on" (`keep`): the sets it covers, as keepRoutineRest picks them in the routine
    const field = "restAfterS" in b ? "restAfterS" : "restS";
    const covers = b.keep === true ? (i: number, all: { kind: string }[]) => (field === "restAfterS" ? i === all.length - 1 : i < all.length - 1 && all[i]!.kind === "normal") : undefined;
    if (restsWere) await replanRests(ctx, weId, (s) => !s.done, (now) => ({ ...now, restS: restsWere.rest_s, restAfterS: restsWere.rest_after_s }), covers);
    // this workout alone would forget it, so it also goes where the next workout's rest comes from: the routine exercise
    // in a workout from a routine (it wins over the exercise's own settings), else the exercise's settings
    if (b.keep === true && restsWere) {
      const secs = intOrNull(b[field], 0, 3600);
      const we = (await ctx.q.query("SELECT exercise_id, routine_exercise_id FROM workout_exercises WHERE id = $1", [weId])).rows[0];
      const { keepRoutineRest } = await import("./routines");
      const inRoutine = secs != null && !!we.routine_exercise_id && await keepRoutineRest(ctx, we.routine_exercise_id, we.exercise_id, field, secs, wid);
      if (!inRoutine) { await savePrefs(ctx, we.exercise_id, { [field]: secs }); ctx.changed("exercise"); }
    }
    await touch(ctx, wid);
    ctx.changed("workout");
    return { ok: true };
  });

  r.del("/workout-exercises/:id", async (ctx, p) => {
    const weId = id(p.id);
    const wid = await workoutOfExercise(ctx.q, weId);
    await ctx.q.query("DELETE FROM workout_exercises WHERE id = $1", [weId]);
    // close the gap in positions
    const rest = (await ctx.q.query("SELECT id FROM workout_exercises WHERE workout_id = $1 ORDER BY position", [wid])).rows;
    for (const [i, x] of rest.entries()) await ctx.q.query("UPDATE workout_exercises SET position = $2 WHERE id = $1", [x.id, i]);
    await touch(ctx, wid);
    ctx.changed("workout");
    return { ok: true };
  });

  r.post("/workout-exercises/:id/sets", async (ctx, p, b) => {
    const weId = id(p.id);
    const wid = await workoutOfExercise(ctx.q, weId);
    const last = (await ctx.q.query("SELECT * FROM workout_sets WHERE workout_exercise_id = $1 ORDER BY position DESC LIMIT 1", [weId])).rows[0];
    const n = last ? last.position + 1 : 0;
    const asked = Array.isArray(b?.sets) ? b.sets : [b?.kind || b?.weightKg != null || b?.reps != null ? b : { kind: last?.kind === "warmup" ? "normal" : last?.kind ?? "normal",
      weightKg: last?.weight_kg ?? null, reps: last?.reps ?? null, durationS: last?.duration_s ?? null, distanceM: last?.distance_m ?? null, restPlannedS: last?.rest_planned_s ?? null }];
    // a set added during the workout keeps the last set's rep target and range (unless given), so the Finish screen
    // can still tell whether the top of the range was reached in every set
    for (const s of asked) if (s && typeof s === "object" && s.kind !== "warmup") {
      if (s.targetReps === undefined) s.targetReps = last?.target_reps ?? null;
      if (s.targetRepsMax === undefined) s.targetRepsMax = last?.target_reps_max ?? null;
    }
    // sets already saved by an earlier send of this same change are left alone, so a replay moves nothing
    const list: any[] = [];
    for (const s of asked) { const sid = clientSetId(s); if (!sid || !(await ownSet(ctx, sid, weId))) list.push(s); }
    if (asked.length && !list.length) return { ok: true };
    // a drop set goes straight after the set it drops from
    const after = typeof b?.afterId === "string" ? (await ctx.q.query("SELECT position FROM workout_sets WHERE id = $1 AND workout_exercise_id = $2", [b.afterId, weId])).rows[0] : null;
    if (b?.atStart || after) {
      const at = after ? after.position + 1 : 0;
      await ctx.q.query("UPDATE workout_sets SET position = position + $2 WHERE workout_exercise_id = $1 AND position >= $3", [weId, list.length, at]);
      await insertSets(ctx, weId, list, at);
      // the set before a drop set rests none (as when a set is made a drop set); only while that rest is still what the
      // plan without the drop gave it: a rest set on it stays
      if (after && list.some((s) => s?.kind === "drop")) {
        const added = new Set((await ctx.q.query("SELECT id FROM workout_sets WHERE workout_exercise_id = $1 AND position >= $2 AND position < $3",
          [weId, at, at + list.length])).rows.map((x: any) => x.id));
        await replanRests(ctx, weId, (s, i, all) => s.id === b.afterId && !all[i + 1]?.done,
          (now, all) => { const kept = all.filter((s) => !added.has(s.id)); return { ...now, kinds: kept.map((s) => s.kind), sides: kept.map((s) => s.side) }; });
      }
    } else await insertSets(ctx, weId, list, n);
    // a new set reopens the exercise during a workout; on a finished workout it is simply part of it
    await ctx.q.query(`UPDATE workout_exercises SET status = CASE WHEN (SELECT status FROM workouts WHERE id = $2) = 'completed' THEN 'done'
      WHEN status = 'done' THEN 'pending' ELSE status END WHERE id = $1`, [weId, wid]);
    await touch(ctx, wid);
    ctx.changed("workout");
    return { ok: true };
  });

  r.put("/workout-sets/:id", async (ctx, p, b) => {
    const sid = id(p.id);
    const { workoutId, weId } = await workoutOfSet(ctx.q, sid);
    const sets: string[] = [], vals: unknown[] = [sid];
    const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ("kind" in b) put("kind", oneOf(b.kind, KINDS, "normal"));
    if ("weightKg" in b) put("weight_kg", numOrNull(b.weightKg, -500, 2000));
    if ("reps" in b) put("reps", intOrNull(b.reps, 0, 10000));
    if ("durationS" in b) put("duration_s", intOrNull(b.durationS, 0, 86400));
    if ("distanceM" in b) put("distance_m", numOrNull(b.distanceM, 0, 1e7));
    if ("rpe" in b) put("rpe", numOrNull(b.rpe, 0, 10));
    if ("rir" in b) put("rir", numOrNull(b.rir, 0, 20));
    if ("side" in b) put("side", b.side === "L" || b.side === "R" ? b.side : null);
    if ("restPlannedS" in b) put("rest_planned_s", intOrNull(b.restPlannedS, 0, 3600));
    if ("restActualS" in b) put("rest_actual_s", intOrNull(b.restActualS, 0, 86400));
    if ("done" in b) {
      put("done", bool(b.done));
      put("done_at", b.done ? (b.doneAt ? isoTime(b.doneAt) : ctx.now().toISOString()) : null);
    }
    if (["weightKg", "reps", "durationS", "distanceM"].some((k) => k in b)) put("prefilled", false);
    if (!sets.length) return { ok: true };
    // a new kind rests as that kind does (a set made a warm-up rests as warm-ups do), unless a rest comes with it; and
    // "as planned" (no rest of its own) is planned again. Every tick sends the kind, so only a change counts.
    const was: SetKind | null = "kind" in b ? (await ctx.q.query("SELECT kind FROM workout_sets WHERE id = $1", [sid])).rows[0]?.kind ?? null : null;
    const kind = "kind" in b ? oneOf(b.kind, KINDS, "normal") : null;
    const kindChanged = kind != null && kind !== was;
    // a set made left or right (or both again): no rest between a left set and the right one after it, so this set and
    // the one before it are planned again (each only while its rest is still what the old sides gave it)
    const oldSide: string | null | undefined = "side" in b ? (await ctx.q.query("SELECT side FROM workout_sets WHERE id = $1", [sid])).rows[0]?.side ?? null : undefined;
    const replan = "restPlannedS" in b ? b.restPlannedS == null : kindChanged;
    await ctx.q.query(`UPDATE workout_sets SET ${sets.join(", ")} WHERE id = $1`, vals);
    if (replan) await replanRests(ctx, weId, (s) => s.id === sid);
    const newSide = b.side === "L" || b.side === "R" ? b.side : null;
    if (oldSide !== undefined && oldSide !== newSide) {
      await replanRests(ctx, weId, (s, i, all) => (s.id === sid || all[i + 1]?.id === sid) && !s.done,
        (now, all) => ({ ...now, sides: all.map((s) => (s.id === sid ? oldSide : s.side)) }));
    }
    // the set before rests by this one's kind too (none before a drop set). Only while that rest is still ahead or may be
    // running (this set not done yet), and only if it is still what the old kind gave it (a rest set on it stays)
    if (kindChanged && was && (was === "drop") !== (kind === "drop")) {
      await replanRests(ctx, weId, (s, i, all) => all[i + 1]?.id === sid && (!s.done || !all[i + 1]!.done),
        (now, all) => ({ ...now, kinds: all.map((s) => (s.id === sid ? was : s.kind)) }));
    }
    // the exercise is done when every set is done; it gets its start time from the first set
    if ("done" in b) {
      const st = (await ctx.q.query("SELECT count(*) FILTER (WHERE done) AS d, count(*) AS n, min(done_at) AS first FROM workout_sets WHERE workout_exercise_id = $1", [weId])).rows[0];
      await ctx.q.query(
        `UPDATE workout_exercises SET status = CASE WHEN status = 'skipped' THEN 'skipped' WHEN $2::int > 0 AND $2::int = $3::int THEN 'done' ELSE 'pending' END,
           started_at = coalesce(started_at, $4), ended_at = CASE WHEN $2::int = $3::int THEN now() ELSE NULL END WHERE id = $1`,
        [weId, Number(st.d), Number(st.n), st.first]);
    }
    await touch(ctx, workoutId);
    ctx.changed("workout");
    return { ok: true };
  });

  r.del("/workout-sets/:id", async (ctx, p) => {
    const sid = id(p.id);
    const { workoutId, weId } = await workoutOfSet(ctx.q, sid);
    await ctx.q.query("DELETE FROM workout_sets WHERE id = $1", [sid]);
    const rest = (await ctx.q.query("SELECT id FROM workout_sets WHERE workout_exercise_id = $1 ORDER BY position", [weId])).rows;
    for (const [i, x] of rest.entries()) await ctx.q.query("UPDATE workout_sets SET position = $2 WHERE id = $1", [x.id, i]);
    await touch(ctx, workoutId);
    ctx.changed("workout");
    return { ok: true };
  });

  r.post("/workouts/:id/finish", async (ctx, p, b) => {
    const wid = id(p.id);
    const w = (await ctx.q.query("SELECT * FROM workouts WHERE id = $1", [wid])).rows[0];
    if (!w) throw notFound("Workout not found");
    // already finished (a second tap, or a retry after a lost answer): nothing to do; finishing again would move its
    // end time and count its reminders twice
    if (w.status !== "in_progress") return { ok: true };
    const end = b?.endedAt ? isoTime(b.endedAt) : ctx.now().toISOString();
    const paused = w.paused_s + (w.pause_started_at ? secondsBetween(w.pause_started_at, end) : 0);
    // sets that were never ticked are removed; exercises with none done are marked skipped, partly done ones partial
    await ctx.q.query(`DELETE FROM workout_sets s USING workout_exercises we WHERE s.workout_exercise_id = we.id AND we.workout_id = $1 AND NOT s.done ${b?.keepUnticked ? "AND false" : ""}`, [wid]);
    await ctx.q.query(
      `UPDATE workout_exercises we SET status = CASE
         WHEN we.status = 'skipped' THEN 'skipped'
         WHEN NOT EXISTS (SELECT 1 FROM workout_sets s WHERE s.workout_exercise_id = we.id AND s.done) THEN 'skipped'
         WHEN EXISTS (SELECT 1 FROM workout_sets s WHERE s.workout_exercise_id = we.id AND NOT s.done) THEN 'partial'
         ELSE 'done' END,
         skip_reason = CASE WHEN we.status <> 'skipped' AND NOT EXISTS (SELECT 1 FROM workout_sets s WHERE s.workout_exercise_id = we.id AND s.done) THEN coalesce(we.skip_reason, 'Not done') ELSE we.skip_reason END
       WHERE we.workout_id = $1`, [wid]);
    await ctx.q.query(
      `UPDATE workouts SET status = 'completed', ended_at = $2, paused_s = $3, pause_started_at = NULL, notes = coalesce($4, notes), rating = coalesce($5, rating),
         bodyweight_kg = coalesce($6, bodyweight_kg), updated_at = now() WHERE id = $1`,
      [wid, end, paused, b?.notes != null ? str(b.notes, 10000) : null, intOrNull(b?.rating, 1, 5), numOrNull(b?.bodyweightKg, 0, 700)]);
    if (b?.bodyweightKg) {
      await ctx.q.query("INSERT INTO body_metrics (id, user_id, kind, value, measured_at) VALUES ($1,$2,'weight',$3,$4)", [uuidv7(), ctx.userId, numOrNull(b.bodyweightKg, 0, 700), end]);
      ctx.changed("body");
    }
    // reminders counted "after N sessions" move on one
    const doneEx = (await ctx.q.query("SELECT DISTINCT exercise_id FROM workout_exercises WHERE workout_id = $1 AND status <> 'skipped'", [wid])).rows.map((x: any) => x.exercise_id);
    await ctx.q.query(
      `UPDATE reminders SET seen_n = seen_n + 1, last_shown_workout_id = $1 WHERE status = 'pending' AND
         ((target_type = 'exercise' AND target_id = ANY($2::uuid[])) OR (target_type = 'routine' AND target_id = $3))`, [wid, doneEx, w.routine_id]);
    // reminders that came up in this workout have done their job ("every" ones keep coming); ones written during it wait for next time
    await ctx.q.query(
      `UPDATE reminders SET status = 'done', done_at = now() WHERE status = 'pending' AND last_shown_workout_id = $1 AND created_workout_id IS DISTINCT FROM $1
         AND (trigger = 'next' OR (trigger = 'after_n' AND seen_n >= coalesce(trigger_n, 1)) OR (trigger = 'date' AND trigger_date <= $2::date))`, [wid, end.slice(0, 10)]);
    // the routine always holds where you are now: each exercise done takes today's numbers, then its Progression
    // (`accepted`: the "Suggest" ones switched on with Apply on Finish, by routine exercise id; Automatic ones always
    // apply), and its structure changes only
    // as asked: each listed change (exercises added, removed, swapped, moved, skipped; sets added or not done) has its
    // own switch, and `routineChanges` names those switched on. All in this one transaction with the finish. Older apps
    // sent `saveLayout` for "save what's listed", which then listed neither skipped exercises nor their own
    // updateRoutine (sent on every finish with "Always", so ignored): saveLayout saves today's list without the skipped
    // ones. Their `moreWeight` is left: Progression decides now, and without `accepted` only Automatic changes apply. The
    // `declined` list apps sent before (Suggest applied unless switched off) is ignored, so it never applies one unasked.
    if (w.routine_id) {
      const { updateRoutineFromWorkout } = await import("./routines");
      let accept = strList(b?.routineChanges);
      if (b?.saveLayout === true && !accept.length) {
        const [routine, done] = [await loadRoutine(ctx.q, w.routine_id), await loadWorkout(ctx.q, wid, ymd(ctx.now()))];
        if (routine && done) accept = structureChanges(routine, done).filter((c) => c.kind !== "skipped").map((c) => c.key);
      }
      await updateRoutineFromWorkout(ctx, w.routine_id, wid, accept, { accepted: strList(b?.accepted) });
    }
    ctx.changed("workout");
    return { ok: true };
  });

  r.post("/workouts/:id/discard", async (ctx, p) => {
    const w = (await ctx.q.query("SELECT status FROM workouts WHERE id = $1", [id(p.id)])).rows[0];
    // gone already is fine (cancelled twice); a finished one is kept, and saying so beats pretending it was cancelled
    if (w && w.status !== "in_progress") throw new HttpError(409, "This workout is already finished");
    await ctx.q.query("DELETE FROM workouts WHERE id = $1 AND status = 'in_progress'", [id(p.id)]);
    ctx.changed("workout");
    return { ok: true };
  });
  r.del("/workouts/:id", async (ctx, p) => {
    await ctx.q.query("DELETE FROM workouts WHERE id = $1", [id(p.id)]);
    ctx.changed("workout");
    return { ok: true };
  });

  // a past workout typed in after the fact
  r.post("/workouts/log", async (ctx, _p, b) => {
    const wid = uuidv7();
    const startedAt = isoTime(b.startedAt);
    const endedAt = b.endedAt ? isoTime(b.endedAt) : new Date(new Date(startedAt).getTime() + (intOrNull(b.durationS, 0, 86400) ?? 3600) * 1000).toISOString();
    let name = str(b.name, 120).trim() || "Workout";
    const routineId = optId(b.routineId);
    await visible(ctx.q, "routines", routineId, "routine");
    if (routineId && !b.name) name = (await ctx.q.query("SELECT name FROM routines WHERE id = $1", [routineId])).rows[0]?.name ?? name;
    await ctx.q.query(
      `INSERT INTO workouts (id, user_id, routine_id, name, status, started_at, ended_at, notes, source, client_id) VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,'manual',$8)`,
      [wid, ctx.userId, routineId, name, startedAt, endedAt, str(b.notes, 10000), b.clientId ? str(b.clientId, 80) : null]);
    for (const [i, e] of (Array.isArray(b.exercises) ? b.exercises : []).entries()) {
      const sets = (Array.isArray(e.sets) ? e.sets : []).map((s: any) => ({ ...s, done: true, doneAt: endedAt }));
      const weId = await addExercise(ctx, wid, { exerciseId: id(e.exerciseId, "exercise"), position: i, sets });
      await ctx.q.query("UPDATE workout_exercises SET status = $2 WHERE id = $1", [weId, sets.length ? "done" : "skipped"]);
    }
    ctx.changed("workout");
    return { id: wid };
  });

  r.post("/workouts/:id/duplicate", async (ctx, p, b) => {
    const src = await loadWorkout(ctx.q, id(p.id), ymd(ctx.now()));
    if (!src) throw notFound("Workout not found");
    const startedAt = b?.startedAt ? isoTime(b.startedAt) : ctx.now().toISOString();
    const dur = src.endedAt ? secondsBetween(src.startedAt, src.endedAt) : 3600;
    const wid = uuidv7();
    await ctx.q.query(
      `INSERT INTO workouts (id, user_id, routine_id, name, status, started_at, ended_at, paused_s, notes, source) VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,$8,'manual')`,
      [wid, ctx.userId, src.routineId, str(b?.name, 120) || src.name, startedAt, new Date(new Date(startedAt).getTime() + dur * 1000).toISOString(), src.pausedS, ""]);
    for (const e of src.exercises) {
      const weId = await addExercise(ctx, wid, { ...e, sets: e.sets.map((s) => ({ ...s, id: undefined, doneAt: s.done ? startedAt : null })) });
      await ctx.q.query("UPDATE workout_exercises SET status = $2, skip_reason = $3 WHERE id = $1", [weId, e.status, e.skipReason]);
    }
    ctx.changed("workout");
    return { id: wid };
  });

  // "Copy for an AI assistant": the workout as plain text
  r.get("/workouts/:id/text", async (ctx, p) => {
    const w = await loadWorkout(ctx.q, id(p.id), ymd(ctx.now()));
    if (!w) throw notFound();
    const lines = [`# ${w.name} - ${w.startedAt.slice(0, 16).replace("T", " ")}`];
    for (const e of w.exercises) {
      lines.push(`\n## ${e.exercise?.name}${e.status === "skipped" ? " (skipped)" : ""}`);
      for (const s of e.sets.filter((x) => x.done)) lines.push(`- ${s.kind !== "normal" ? s.kind + ": " : ""}${s.weightKg != null ? s.weightKg + " kg × " : ""}${s.reps ?? ""}${s.durationS ? s.durationS + " s" : ""}${s.rpe ? ` @RPE ${s.rpe}` : ""}`);
    }
    if (w.notes) lines.push(`\nNotes: ${w.notes}`);
    return { text: lines.join("\n") };
  });
}
