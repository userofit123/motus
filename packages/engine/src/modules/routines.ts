// Routines (saved plans) and their folders: list, open, create (from scratch, from another routine, from a workout,
// from a template), edit, duplicate, version history, and the pre-start preview.
import { TEMPLATES, applyStructure, cleanProgression, planNext, progressionDefaultsOf, estimate, usualDuration, restAfterSet, opensSideRound, restDefaultsOf, ymd, LIFTED_SQL, type RoutineItemLike, type RoutineSummary, type RoutineSnapshot, type RoutineSnapshotExercise, type RoutineVersionRow, type RoutineTrendPoint, type SetKind, type Tracking } from "@motus/shared";
import { SOURCE } from "@motus/exercise-data/meta";
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { camel, id, optId, str, strList, intOrNull, numOrNull, bool, oneOf, visible } from "../util";
import { uuidv7 } from "../ids";
import { notFound, bad } from "../errors";
import { getSettings } from "./settings";
import { buildPlan, loadRoutine, withWorkoutOverrides } from "./plan";
import { DURATION_SQL, loadWorkout } from "./workouts";

// a list of short strings from a request (change keys), anything else dropped

const KINDS = ["warmup", "normal", "drop", "failure"] as const;
const VERSIONS_PAGE = 50;
const arrSql = (x: string) => `CASE WHEN jsonb_typeof(${x}) = 'array' THEN ${x} ELSE '[]'::jsonb END`;

/** The routine `r`'s last few finished workouts, newest first, each how long it took without its pauses (seconds).
 *  A few more than the 3 that get averaged, so a given-up session doesn't leave too few. */
const RECENT_DURATIONS = `coalesce((SELECT json_agg(x.d ORDER BY x.at DESC) FROM (
    SELECT ${DURATION_SQL} AS d, w.started_at AS at
    FROM workouts w WHERE w.routine_id = r.id AND w.status = 'completed' AND w.ended_at IS NOT NULL ORDER BY w.started_at DESC LIMIT 6) x), '[]')`;

export async function routineSummaries(q: Sql, userId: string, where = "r.deleted_at IS NULL"): Promise<RoutineSummary[]> {
  const settings = await getSettings(q, userId);
  const d = restDefaultsOf(settings.workout);
  const { rows } = await q.query(
    `SELECT r.*,
       (SELECT count(*) FROM workouts w WHERE w.routine_id = r.id AND w.status = 'completed') AS times_done,
       (SELECT max(started_at) FROM workouts w WHERE w.routine_id = r.id AND w.status = 'completed') AS last_done_at,
       ${RECENT_DURATIONS} AS recent_s,
       (SELECT count(*) FROM reminders m WHERE m.status = 'pending' AND ((m.target_type = 'routine' AND m.target_id = r.id)
          OR (m.target_type = 'exercise' AND m.target_id IN (SELECT exercise_id FROM routine_exercises WHERE routine_id = r.id)
              AND (m.scope_routine_id IS NULL OR m.scope_routine_id = r.id)))) AS pending_reminders,
       coalesce((SELECT json_agg(json_build_object('name', e.name, 'primary', e.primary_muscles, 'secondary', e.secondary_muscles, 'restS', re.rest_s, 'restAfterS', re.rest_after_s, 'restByKind', re.rest_by_kind,
          'sets', (SELECT coalesce(json_agg(json_build_object('kind', s.kind, 'reps', s.reps, 'durationS', s.duration_s, 'restS', s.rest_s, 'side', s.side) ORDER BY s.position), '[]')
                   FROM routine_sets s WHERE s.routine_exercise_id = re.id)) ORDER BY re.position)
         FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id WHERE re.routine_id = r.id), '[]') AS exs
     FROM routines r WHERE ${where} ORDER BY r.pinned DESC, r.position, r.created_at`);
  return rows.map((r: any) => {
    const exs = r.exs as any[];
    const est = estimate(exs.map((e, i) => ({
      sets: (e.sets as any[]).map((s, j) => ({ ...s, restS: restAfterSet({ setRestS: s.restS, kind: s.kind, nextKind: e.sets[j + 1]?.kind, sideRound: opensSideRound(e.sets, j), byKindS: e.restByKind, exRestS: e.restS, isLastSet: j === e.sets.length - 1, exRestAfterS: e.restAfterS }, d) })),
    })));
    const muscles = [...new Set(exs.flatMap((e) => e.primary as string[]))];
    // helpers that are nobody's main muscle here, for the little body on the routine card
    const helpers = [...new Set(exs.flatMap((e) => (e.secondary ?? []) as string[]))].filter((m) => !muscles.includes(m));
    return {
      id: r.id, folderId: r.folder_id, name: r.name, description: r.description, color: r.color, pinned: r.pinned, archived: r.archived, position: r.position,
      exerciseCount: exs.length, setCount: exs.reduce((a, e) => a + e.sets.length, 0), estimateS: est.totalS, usual: usualDuration((r.recent_s as number[]).map(Number)), muscles, helpers,
      lastDoneAt: r.last_done_at, timesDone: Number(r.times_done), pendingReminders: Number(r.pending_reminders), exerciseNames: exs.map((e) => e.name),
    };
  });
}

/** Only the kinds of set that have their own rest, each 0-60 min; null when none do. */
function restByKind(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const out: Record<string, number> = {};
  for (const k of ["warmup", "drop", "failure"]) { const n = intOrNull((v as any)[k], 0, 3600); if (n != null) out[k] = n; }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** Writes a routine's exercises and sets, keeping the ids of exercises that stay (workouts point at them). `missed`
 * (workouts in a row with missed reps) is only written by finishing (`withMissed`); an edit keeps each one's count,
 * unless it changed the exercise's Progression (a count from under another mode means nothing). */
// a template as a routine's body, in the editor's full shape; unsaved, so the editor can open it as a draft
// that only becomes a routine on Save (GET /templates/:slug), and POST /routines { template } saves the same
async function templateBody(q: Sql, slug: string) {
  const t = TEMPLATES.find((x) => x.slug === slug);
  if (!t) throw notFound("Template not found");
  const ids = new Map((await q.query("SELECT source_id, id FROM exercises WHERE owner_id IS NULL AND source = $1 AND source_id = ANY($2::text[])", [SOURCE, t.exercises.map((e) => e.id)])).rows.map((x: any) => [x.source_id, x.id]));
  return {
    name: t.name, description: t.description, folderId: null, color: null,
    exercises: t.exercises.filter((e) => ids.has(e.id)).map((e) => ({
      exerciseId: ids.get(e.id) as string, superset: null, restS: e.restS ?? null, restAfterS: e.restAfterS ?? null, restByKind: null, repRestS: null, fixed: false, note: "",
      // a template's "8-12" becomes the exercise's own rep range, its sets starting at the bottom
      progression: e.repsMax && !e.durationS ? { mode: null, repsMin: e.reps, repsMax: e.repsMax, stepKg: null, lowerAfter: null } : null,
      sets: Array.from({ length: e.sets }, () => ({ kind: "normal", reps: e.durationS ? null : e.reps, weightKg: null, durationS: e.durationS ?? null, distanceM: null, rpe: null, restS: null, side: null })),
    })),
  };
}

async function writeRoutineBody(ctx: Ctx, routineId: string, exercises: any[], withMissed = false) {
  if (!Array.isArray(exercises)) throw bad("Expected a list of exercises");
  if (exercises.length > 100) throw bad("Too many exercises");
  const keep: string[] = [];
  for (const [pos, e] of exercises.entries()) {
    const reId = e.id && typeof e.id === "string" && /^[0-9a-f-]{36}$/.test(e.id) ? e.id : uuidv7();
    keep.push(reId);
    await visible(ctx.q, "exercises", id(e.exerciseId, "exercise"), "exercise");
    const prog = cleanProgression(e.progression);
    // a version saved before "Keep these numbers fixed" said prefill "target" for it
    const vals = [reId, ctx.userId, routineId, id(e.exerciseId, "exercise"), pos, e.superset ? str(e.superset, 20) : null, intOrNull(e.restS, 0, 3600),
      intOrNull(e.restAfterS, 0, 3600), intOrNull(e.repRestS, 0, 600), bool(e.fixed) || e.prefill === "target",
      prog ? JSON.stringify(prog) : null, str(e.note, 2000), restByKind(e.restByKind), withMissed ? intOrNull(e.missed, 0, 1000) ?? 0 : null];
    await ctx.q.query(
      `INSERT INTO routine_exercises (id, user_id, routine_id, exercise_id, position, superset, rest_s, rest_after_s, rep_rest_s, fixed, progression, note, rest_by_kind, missed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14::int, 0))
       ON CONFLICT (id) DO UPDATE SET exercise_id=$4, position=$5, superset=$6, rest_s=$7, rest_after_s=$8, rep_rest_s=$9, fixed=$10, progression=$11, note=$12, rest_by_kind=$13,
         missed=coalesce($14::int, CASE WHEN routine_exercises.progression IS DISTINCT FROM $11::jsonb THEN 0 ELSE routine_exercises.missed END)
       WHERE routine_exercises.routine_id = $3`, vals);
    await ctx.q.query("DELETE FROM routine_sets WHERE routine_exercise_id = $1", [reId]);
    const sets = Array.isArray(e.sets) ? e.sets.slice(0, 50) : [];
    for (const [sp, s] of sets.entries()) {
      // the rep range is the exercise's Progression's (022_progression_rep_range): reps_max and start_reps stay empty
      await ctx.q.query(
        `INSERT INTO routine_sets (id, user_id, routine_exercise_id, position, kind, reps, weight_kg, duration_s, distance_m, rpe, rest_s, side)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [uuidv7(), ctx.userId, reId, sp, oneOf(s.kind, KINDS, "normal"), intOrNull(s.reps, 0, 1000), numOrNull(s.weightKg, -500, 2000),
          intOrNull(s.durationS, 0, 86400), numOrNull(s.distanceM, 0, 1e7), numOrNull(s.rpe, 0, 10), intOrNull(s.restS, 0, 3600), sideOf(s.side)]);
    }
  }
  await ctx.q.query("DELETE FROM routine_exercises WHERE routine_id = $1 AND NOT (id = ANY($2::uuid[]))", [routineId, keep]);
}

/** A set's side: "L" or "R", anything else is both together (null). */
const sideOf = (v: unknown): "L" | "R" | null => (v === "L" || v === "R" ? v : null);

type Loose = Record<string, unknown> | null | undefined;
const nOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A version as History keeps it (RoutineSnapshot): from the routine as loadRoutine gives it, or from a stored version of
 * either shape (slim, or the whole routine as versions were kept before 016_history_now), so both read the same. */
function slimRoutine(r: Loose): RoutineSnapshot {
  const exs = Array.isArray(r?.exercises) ? (r.exercises as Loose[]) : [];
  return {
    name: String(r?.name ?? ""), description: String(r?.description ?? ""),
    exercises: exs.map((e): RoutineSnapshotExercise => {
      const x = (e?.exercise ?? {}) as Record<string, unknown>;
      const sets = Array.isArray(e?.sets) ? (e.sets as Loose[]) : [];
      return {
        id: typeof e?.id === "string" ? e.id : null, exerciseId: String(e?.exerciseId ?? ""), name: String(e?.name ?? x.name ?? ""),
        primary: (e?.primary ?? x.primaryMuscles ?? []) as string[], secondary: (e?.secondary ?? x.secondaryMuscles ?? []) as string[],
        tracking: (e?.tracking ?? x.tracking ?? "weight_reps") as Tracking, superset: typeof e?.superset === "string" ? e.superset : null,
        restS: nOrNull(e?.restS), restAfterS: nOrNull(e?.restAfterS), repRestS: nOrNull(e?.repRestS),
        restByKind: e?.restByKind && typeof e.restByKind === "object" ? (e.restByKind as Record<string, number>) : null,
        fixed: e?.fixed === true || e?.prefill === "target", progression: cleanProgression(e?.progression), note: String(e?.note ?? ""),
        sets: sets.map((t) => ({ kind: (t?.kind ?? "normal") as SetKind, reps: nOrNull(t?.reps), repsMax: nOrNull(t?.repsMax), startReps: nOrNull(t?.startReps), weightKg: nOrNull(t?.weightKg),
          durationS: nOrNull(t?.durationS), distanceM: nOrNull(t?.distanceM), rpe: nOrNull(t?.rpe), restS: nOrNull(t?.restS), side: sideOf(t?.side) })),
      };
    }),
  };
}
// the same version whatever order its keys were stored in (jsonb sorts them)
const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v ?? null);
const sameVersion = (a: RoutineSnapshot, b: RoutineSnapshot) => canon(a) === canon(b);

const NEWEST = "SELECT id, snapshot, created_at FROM routine_versions WHERE routine_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1";
/** The routine as it is now, kept in its History (every version, none dropped), unless the newest version already is
 * it: after an edit, or after a workout changed it (with that workout). So the newest version is always the routine as
 * it is now. `keepCurrent` (before a change) keeps the current one first when something else changed the routine since
 * (a sync from a device), so a change never loses where it was. */
async function snapshot(ctx: Ctx, routineId: string, reason: "edit" | "workout" = "edit", workoutId: string | null = null) {
  const r = await loadRoutine(ctx.q, routineId);
  if (!r) return;
  const now = slimRoutine(r), newest = (await ctx.q.query(NEWEST, [routineId])).rows[0];
  if (newest && sameVersion(slimRoutine(newest.snapshot), now)) return;
  // strictly after the newest one, so two versions kept in one request (before and after a change) never tie on the
  // millisecond and History's newest-first order is always right
  const t = Math.max(ctx.now().getTime(), newest ? new Date(newest.created_at).getTime() + 1 : 0);
  await ctx.q.query("INSERT INTO routine_versions (id, user_id, routine_id, snapshot, reason, workout_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [uuidv7(), ctx.userId, routineId, JSON.stringify(now), reason, workoutId, new Date(t).toISOString()]);
}
const keepCurrent = (ctx: Ctx, routineId: string) => snapshot(ctx, routineId);

async function createRoutine(ctx: Ctx, b: any): Promise<string> {
  const rid = uuidv7();
  const name = str(b.name, 120).trim() || "New routine";
  await visible(ctx.q, "folders", optId(b.folderId), "folder");
  await visible(ctx.q, "routines", optId(b.basedOnId), "routine");
  const pos = (await ctx.q.query("SELECT coalesce(max(position), -1) + 1 AS p FROM routines WHERE deleted_at IS NULL")).rows[0].p;
  await ctx.q.query(
    `INSERT INTO routines (id, user_id, folder_id, name, description, color, based_on_id, position, pinned, settings) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [rid, ctx.userId, optId(b.folderId), name, str(b.description, 2000), b.color ? str(b.color, 20) : null, optId(b.basedOnId), pos, bool(b.pinned), JSON.stringify(b.settings ?? {})]);
  await writeRoutineBody(ctx, rid, b.exercises ?? []);
  await snapshot(ctx, rid);
  return rid;
}

/** A workout's structure as a routine body (for "Save as routine" and "Update routine from this workout"). */
async function bodyFromWorkout(q: Sql, workoutId: string) {
  const exs = (await q.query("SELECT * FROM workout_exercises WHERE workout_id = $1 AND status <> 'skipped' ORDER BY position", [workoutId])).rows;
  const sets = exs.length ? (await q.query("SELECT * FROM workout_sets WHERE workout_exercise_id = ANY($1::uuid[]) ORDER BY position", [exs.map((e: any) => e.id)])).rows : [];
  return exs.map((e: any) => ({
    id: e.routine_exercise_id ?? undefined, exerciseId: e.exercise_id, superset: e.superset, restS: e.rest_s, restAfterS: e.rest_after_s, repRestS: e.rep_rest_s,
    sets: sets.filter((s: any) => s.workout_exercise_id === e.id && (s.done || !sets.some((x: any) => x.workout_exercise_id === e.id && x.done)))
      .map((s: any) => ({ kind: s.kind, reps: s.reps, weightKg: s.weight_kg, durationS: s.duration_s, distanceM: s.distance_m, side: s.side })),
  }));
}

/** What a finished session changes in its routine. Structure: only the changes asked for (their keys from
 * structureChanges), the Finish screen's "Routine changes" and a finished workout's ⋮ "Update the routine from this",
 * the same list and the same save in both places (applyStructure). Numbers (`numbers`, finishing only): each exercise
 * done takes today's numbers, then its Progression, the "Suggest" ones only when Apply was switched on (planNext, as the
 * Finish screen lists them). An exercise added to the routine becomes the workout exercise's own routine exercise, so
 * the change isn't listed (or saved) again. A change shows in the routine's History, with the workout. True when the
 * routine's numbers or structure changed. */
export async function updateRoutineFromWorkout(ctx: Ctx, routineId: string, workoutId: string, accept: string[], numbers?: { accepted: string[] }): Promise<boolean> {
  const routine = await loadRoutine(ctx.q, routineId);
  const w = await loadWorkout(ctx.q, workoutId, ymd(ctx.now()));
  if (!routine || !w) return false;
  const shaped = applyStructure(routine, w, accept);
  type Item = RoutineItemLike & Record<string, unknown>;
  let body = (shaped ?? routine.exercises) as Item[];
  let changed = !!shaped, missedMoved = false;
  if (numbers) {
    const s = await getSettings(ctx.q, ctx.userId);
    const next = planNext(body, w, progressionDefaultsOf(s), numbers.accepted);
    missedMoved = next.exercises.some((e, i) => (e.missed ?? 0) !== (body[i]!.missed ?? 0));
    changed ||= next.numbersChanged;
    body = next.exercises;
  }
  if (!changed && !missedMoved) return false;
  const links: [string, string][] = [];
  const items = body.map((x) => {
    if (!("fromWorkoutExerciseId" in x) || typeof x.fromWorkoutExerciseId !== "string") return x;
    const { fromWorkoutExerciseId, ...rest } = x, reId = uuidv7();
    links.push([fromWorkoutExerciseId, reId]);
    return { ...rest, id: reId };
  });
  if (changed) await keepCurrent(ctx, routineId);
  await writeRoutineBody(ctx, routineId, items, !!numbers);
  if (changed) {
    await ctx.q.query("UPDATE routines SET updated_at = $2 WHERE id = $1", [routineId, ctx.now().toISOString()]);
    await snapshot(ctx, routineId, "workout", workoutId);
  }
  for (const [weId, reId] of links) await ctx.q.query("UPDATE workout_exercises SET routine_exercise_id = $2 WHERE id = $1 AND workout_id = $3", [weId, reId, workoutId]);
  if (links.length) ctx.changed("workout");
  ctx.changed("routine");
  return changed;
}

/** "Use 3:30 for this exercise from now on" in a workout from this routine: the routine exercise's rest between sets
 * (`restS`) or after its last set (`restAfterS`) becomes it, as that is what the next workout from the routine rests by.
 * A routine set's own rest wins over the exercise's (restAfterSet), so the sets it stands for lose theirs: the working
 * sets but the last for a rest between sets, the last set for the rest after. Kept in History with the workout, as a
 * finish's changes are. False when the slot is gone or holds another exercise (swapped): the rest isn't the routine's. */
export async function keepRoutineRest(ctx: Ctx, reId: string, exerciseId: string, field: "restS" | "restAfterS", secs: number, workoutId: string): Promise<boolean> {
  const re = (await ctx.q.query(
    "SELECT re.routine_id FROM routine_exercises re JOIN routines r ON r.id = re.routine_id WHERE re.id = $1 AND re.exercise_id = $2 AND r.deleted_at IS NULL",
    [reId, exerciseId])).rows[0];
  if (!re) return false;
  await keepCurrent(ctx, re.routine_id);
  await ctx.q.query(`UPDATE routine_exercises SET ${field === "restS" ? "rest_s" : "rest_after_s"} = $2 WHERE id = $1`, [reId, secs]);
  const sets: { id: string; kind: string }[] = (await ctx.q.query("SELECT id, kind FROM routine_sets WHERE routine_exercise_id = $1 ORDER BY position", [reId])).rows;
  const own = sets.filter((x, i) => (field === "restAfterS" ? i === sets.length - 1 : i < sets.length - 1 && x.kind === "normal")).map((x) => x.id);
  if (own.length) await ctx.q.query("UPDATE routine_sets SET rest_s = NULL WHERE id = ANY($1::uuid[])", [own]);
  await ctx.q.query("UPDATE routines SET updated_at = $2 WHERE id = $1", [re.routine_id, ctx.now().toISOString()]);
  await snapshot(ctx, re.routine_id, "workout", workoutId);
  ctx.changed("routine");
  return true;
}

export function routineRoutes(r: Router) {
  r.get("/routines", async ({ q, userId }, _p, _b, qs) => routineSummaries(q, userId, qs.archived === "1" ? "r.deleted_at IS NULL AND r.archived" : "r.deleted_at IS NULL"));

  r.get("/routines/:id", async ({ q }, p) => {
    const routine = await loadRoutine(q, id(p.id));
    if (!routine) throw notFound("Routine not found");
    return routine;
  });

  // `settings`: the start screen's Workout settings for this workout only (JSON), as the start will apply them
  r.get("/routines/:id/preview", async (ctx, p, _b, qs) => {
    const routine = await loadRoutine(ctx.q, id(p.id));
    if (!routine) throw notFound("Routine not found");
    let own: unknown = null;
    try { own = qs.settings ? JSON.parse(String(qs.settings).slice(0, 5000)) : null; } catch { throw bad("Unreadable settings"); }
    const settings = withWorkoutOverrides(await getSettings(ctx.q, ctx.userId), own);
    const plan = await buildPlan(ctx.q, routine, settings, ymd(ctx.now()));
    const stats = (await ctx.q.query(
      `SELECT (SELECT count(*) FROM workouts w WHERE w.routine_id = r.id AND w.status = 'completed') AS n,
         (SELECT max(started_at) FROM workouts w WHERE w.routine_id = r.id AND w.status = 'completed') AS last_at,
         ${RECENT_DURATIONS} AS recent_s
       FROM routines r WHERE r.id = $1`, [routine.id])).rows[0];
    return { routine, ...plan, timesDone: Number(stats.n), lastDoneAt: stats.last_at, usual: usualDuration((stats.recent_s as number[]).map(Number)) };
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
      body = { ...(await templateBody(ctx.q, str(b.template, 80))), folderId: b.folderId };
    }
    const rid = await createRoutine(ctx, body);
    ctx.changed("routine");
    return { id: rid };
  });

  r.put("/routines/:id", async (ctx, p, b) => {
    const rid = id(p.id);
    const cur = (await ctx.q.query("SELECT id FROM routines WHERE id = $1 AND deleted_at IS NULL", [rid])).rows[0];
    if (!cur) throw notFound("Routine not found");
    // History keeps the routine as each edit leaves it (its name and exercises; not where it's filed or pinned)
    const edit = !!b.exercises || "name" in b || "description" in b;
    if (edit) await keepCurrent(ctx, rid);
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
    if (edit) await snapshot(ctx, rid);
    ctx.changed("routine");
    return { ok: true };
  });

  r.post("/routines/reorder", async (ctx, _p, b) => {
    const ids: string[] = (Array.isArray(b.ids) ? b.ids : []).map((x: unknown) => id(x));
    for (const [i, rid] of ids.entries()) await ctx.q.query("UPDATE routines SET position = $2, updated_at = $3 WHERE id = $1", [rid, i, ctx.now().toISOString()]);
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

  // save a finished workout's structure to its routine (its ⋮ menu: "Update the routine from this"), never its numbers
  r.post("/routines/:id/from-workout", async (ctx, p, b) => {
    const rid = id(p.id);
    // older apps sent no list (they saved everything): saying so beats an "ok" that changed nothing
    if (!Array.isArray(b?.changes)) throw bad("Update the app to save routine changes");
    if (!(await ctx.q.query("SELECT 1 FROM routines WHERE id = $1", [rid])).rows.length) throw notFound("Routine not found");
    const w = (await ctx.q.query("SELECT routine_id FROM workouts WHERE id = $1", [id(b.workoutId)])).rows[0];
    if (!w) throw notFound("Workout not found");
    if (w.routine_id !== rid) throw bad("This workout wasn't done from this routine");
    const saved = await updateRoutineFromWorkout(ctx, rid, id(b.workoutId), strList(b.changes));
    if (saved) ctx.changed("routine");
    return { ok: true, saved };
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

  // History: a page of versions, newest first, each with why it was made (an edit, or a workout and its name), never
  // the snapshots themselves; `current` marks the routine as it is now. The first page also brings the weight trend:
  // each exercise's heaviest working weight in every version, worked out in SQL so no snapshot leaves the database.
  r.get("/routines/:id/versions", async ({ q }, p, _b, qs) => {
    const rid = id(p.id), offset = intOrNull(Number(qs.offset ?? 0), 0, 1e6) ?? 0;
    const rows = (await q.query(
      `SELECT v.id, v.created_at, v.reason, v.workout_id, w.name AS workout_name, coalesce(v.snapshot->>'name', '') AS name,
         CASE WHEN jsonb_typeof(v.snapshot->'exercises') = 'array' THEN jsonb_array_length(v.snapshot->'exercises') ELSE 0 END AS exercises
       FROM routine_versions v LEFT JOIN workouts w ON w.id = v.workout_id WHERE v.routine_id = $1 ORDER BY v.created_at DESC, v.id DESC LIMIT $2 OFFSET $3`,
      [rid, VERSIONS_PAGE + 1, offset])).rows;
    const items: RoutineVersionRow[] = rows.slice(0, VERSIONS_PAGE).map((x: Record<string, unknown>) => ({
      id: String(x.id), createdAt: String(x.created_at instanceof Date ? x.created_at.toISOString() : x.created_at), reason: x.reason === "workout" ? "workout" : "edit",
      workoutId: (x.workout_id as string | null) ?? null, workoutName: (x.workout_name as string | null) ?? null, name: String(x.name), exercises: Number(x.exercises), current: false }));
    if (offset > 0) return { items, more: rows.length > VERSIONS_PAGE };
    // "Current" only when the newest version really is the routine now (something may have changed it since)
    const [routine, newest] = [await loadRoutine(q, rid), (await q.query(NEWEST, [rid])).rows[0]];
    if (routine && newest && items[0] && sameVersion(slimRoutine(newest.snapshot), slimRoutine(routine))) items[0].current = true;
    const ex = arrSql("v.snapshot->'exercises'"), sets = arrSql("e->'sets'");
    const trend: RoutineTrendPoint[] = (await q.query(
      `SELECT * FROM (SELECT v.id AS version_id, v.created_at AS at, v.reason, w.name AS workout_name, e->>'exerciseId' AS exercise_id, coalesce(e->>'name', e->'exercise'->>'name', '') AS name,
          (SELECT max((s->>'weightKg')::float8) FROM jsonb_array_elements(${sets}) s
            WHERE coalesce(s->>'kind', 'normal') NOT IN ('warmup', 'drop') AND jsonb_typeof(s->'weightKg') = 'number') AS kg
        FROM routine_versions v LEFT JOIN workouts w ON w.id = v.workout_id CROSS JOIN LATERAL jsonb_array_elements(${ex}) e WHERE v.routine_id = $1) t
       WHERE kg IS NOT NULL AND exercise_id IS NOT NULL ORDER BY at, version_id`, [rid])).rows.map((x: Record<string, unknown>) => ({
      versionId: String(x.version_id), at: String(x.at instanceof Date ? x.at.toISOString() : x.at),
      reason: x.reason === "workout" ? "workout" : "edit", workoutName: (x.workout_name as string | null) ?? null, exerciseId: String(x.exercise_id), name: String(x.name), kg: Number(x.kg) }));
    return { items, more: rows.length > VERSIONS_PAGE, trend };
  });
  r.get("/routines/:id/versions/:vid", async ({ q }, p) => {
    const v = (await q.query("SELECT snapshot FROM routine_versions WHERE id = $1 AND routine_id = $2", [id(p.vid), id(p.id)])).rows[0];
    if (!v) throw notFound("Version not found");
    return slimRoutine(v.snapshot);
  });
  // a version of either shape: its exercises are rebuilt from their exerciseId (writeRoutineBody checks each still exists)
  r.post("/routines/:id/versions/:vid/restore", async (ctx, p) => {
    const rid = id(p.id);
    const v = (await ctx.q.query("SELECT snapshot FROM routine_versions WHERE id = $1 AND routine_id = $2", [id(p.vid), rid])).rows[0];
    if (!v) throw notFound("Version not found");
    await keepCurrent(ctx, rid);
    const s = slimRoutine(v.snapshot);
    await ctx.q.query("UPDATE routines SET name = $2, description = $3, updated_at = now() WHERE id = $1", [rid, s.name || "Routine", s.description]);
    await writeRoutineBody(ctx, rid, s.exercises);
    await snapshot(ctx, rid);
    ctx.changed("routine");
    return { ok: true };
  });

  r.get("/routines/:id/workouts", async ({ q }, p) =>
    (await q.query(
      `SELECT w.id, w.name, w.started_at, w.ended_at, extract(epoch FROM coalesce(w.ended_at, w.started_at) - w.started_at)::int - w.paused_s AS duration_s,
         coalesce((SELECT sum(${LIFTED_SQL}) FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN exercises e ON e.id = we.exercise_id
                   WHERE we.workout_id = w.id AND s.done AND s.kind <> 'warmup'), 0) AS volume_kg,
         (SELECT count(*) FROM workout_exercises we WHERE we.workout_id = w.id AND we.status = 'skipped') AS skipped
       FROM workouts w WHERE w.routine_id = $1 AND w.status = 'completed' ORDER BY w.started_at DESC LIMIT 200`, [id(p.id)])).rows.map((x: any) => camel(x)));

  // each template carries the muscles its exercises work (from the built-in library), for the same little body the routine cards show
  r.get("/templates", async ({ q }) => {
    const lib = new Map((await q.query("SELECT source_id, primary_muscles, secondary_muscles FROM exercises WHERE owner_id IS NULL AND source = $1 AND source_id = ANY($2::text[])",
      [SOURCE, [...new Set(TEMPLATES.flatMap((t) => t.exercises.map((e) => e.id)))]])).rows.map((x: any) => [x.source_id, x]));
    return TEMPLATES.map((t) => {
      const exs = t.exercises.map((e) => lib.get(e.id)).filter(Boolean);
      const muscles = [...new Set(exs.flatMap((e) => e.primary_muscles as string[]))];
      const helpers = [...new Set(exs.flatMap((e) => (e.secondary_muscles ?? []) as string[]))].filter((m) => !muscles.includes(m));
      return { slug: t.slug, group: t.group, name: t.name, description: t.description, exercises: t.exercises.length, muscles, helpers };
    });
  });
  r.get("/templates/:slug", async ({ q }, p) => templateBody(q, str(p.slug, 80)));

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
