// Turning a routine into today's plan: the sets to do with the routine's numbers (which are where you are now, PLAN.md
// §8.7), last time's beside them, with reminders, pinned notes and an estimate of how long it takes. Used by the pre-start preview and by "Start".
import { estimate, pairSets, restAfterSet, opensSideRound, restDefaultsOf, startRepsOf, type Exercise, type Reminder, type Note, type Settings, type SetKind } from "@motus/shared";
import type { Sql } from "../db";
import { camel } from "../util";
import { exerciseSessions, getExercises } from "./library";

export interface PlannedSet {
  kind: SetKind;
  weightKg: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  rpe: number | null;
  /** "L" / "R": the routine set's side, copied into the workout; null: both together */
  side: string | null;
  restS: number; // rest after this set
  targetReps: number | null;
  targetRepsMax: number | null;
  targetWeightKg: number | null;
  prev: { weightKg: number | null; reps: number | null; durationS: number | null; distanceM: number | null } | null;
  prefilled: boolean;
  adjusted: boolean; // changed by a reminder or a program's lighter week
}
export interface PlannedExercise {
  routineExerciseId: string | null;
  exerciseId: string;
  exercise: Exercise;
  superset: string | null;
  restS: number | null;
  restAfterS: number | null;
  repRestS: number | null;
  note: string;
  sets: PlannedSet[];
  last: { workoutId: string; workoutName: string; startedAt: string; position: number; ofN: number; sets: any[] } | null;
  reminders: Reminder[];
  notes: Note[];
}

export async function loadRoutine(q: Sql, routineId: string) {
  const r = (await q.query("SELECT * FROM routines WHERE id = $1 AND deleted_at IS NULL", [routineId])).rows[0];
  if (!r) return null;
  const res = (await q.query("SELECT * FROM routine_exercises WHERE routine_id = $1 ORDER BY position", [routineId])).rows;
  const sets = res.length ? (await q.query("SELECT * FROM routine_sets WHERE routine_exercise_id = ANY($1::uuid[]) ORDER BY position", [res.map((x: any) => x.id)])).rows : [];
  const exs = await getExercises(q, res.map((x: any) => x.exercise_id));
  const routine = camel<any>(r);
  routine.exercises = res.map((x: any) => {
    const re = camel<any>(x);
    re.exercise = exs.get(x.exercise_id);
    re.sets = sets.filter((s: any) => s.routine_exercise_id === x.id).map((s: any) => { const c = camel<any>(s); delete c.routineExerciseId; delete c.userId; return c; });
    delete re.userId; delete re.routineId; delete re.position;
    return re;
  });
  delete routine.userId;
  return routine;
}

export async function pendingReminders(q: Sql, opts: { routineId?: string | null; exerciseIds: string[]; today: string }): Promise<Reminder[]> {
  const { rows } = await q.query(
    `SELECT * FROM reminders WHERE status = 'pending' AND (
       (target_type = 'routine' AND target_id = $1) OR
       (target_type = 'exercise' AND target_id = ANY($2::uuid[]) AND (scope_routine_id IS NULL OR scope_routine_id = $1)))
     ORDER BY created_at`, [opts.routineId ?? null, opts.exerciseIds]);
  return rows.map((r: any) => camel<Reminder>(r)).filter((r) =>
    r.trigger === "date" ? (r.triggerDate ?? "") <= opts.today : r.trigger === "after_n" ? r.seenN + 1 >= (r.triggerN ?? 1) : true);
}

async function pinnedNotes(q: Sql, targets: { type: string; id: string }[]): Promise<Note[]> {
  if (!targets.length) return [];
  const { rows } = await q.query(
    `SELECT n.*, w.name AS workout_name FROM notes n LEFT JOIN workouts w ON w.id = n.workout_id
     WHERE n.pinned AND (n.target_type, n.target_id) IN (${targets.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::uuid)`).join(",")})
     ORDER BY n.updated_at DESC`, targets.flatMap((t) => [t.type, t.id]));
  return rows.map((r: any) => camel<Note>(r));
}

/** The saved settings with a workout's own Workout settings over them (the start screen's, for this workout only),
 * only known keys of the right type. Used by the start and its preview alike, so the preview matches the start. */
export function withWorkoutOverrides(settings: Settings, raw: unknown): Settings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return settings;
  const base = settings.workout as unknown as Record<string, unknown>;
  const rest = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 3600;
  const own: Record<string, unknown> = {};
  // each key checked on its own (it comes from the query string): anything not of the saved setting's kind is dropped
  for (const [k, v] of Object.entries(raw)) {
    if (!Object.hasOwn(base, k)) continue;
    if (k === "restByKindS") {
      if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) continue;
      own[k] = Object.fromEntries(Object.entries(v).filter(([kind, n]) => REST_KINDS.includes(kind) && rest(n)));
    }
    else if (typeof base[k] === "boolean") { if (typeof v === "boolean") own[k] = v; }
    else if (typeof base[k] === "number") { if (rest(v)) own[k] = v; }
  }
  return { ...settings, workout: { ...settings.workout, ...own } };
}
// the kinds of set that can have their own rest (as a routine exercise's restByKind)
const REST_KINDS: string[] = ["warmup", "drop", "failure"];

export async function buildPlan(q: Sql, routine: any, settings: Settings, today: string): Promise<{ exercises: PlannedExercise[]; reminders: Reminder[]; notes: Note[]; estimate: ReturnType<typeof estimate> }> {
  const exIds = routine.exercises.map((e: any) => e.exerciseId);
  const reminders = await pendingReminders(q, { routineId: routine.id, exerciseIds: exIds, today });
  const notes = await pinnedNotes(q, [
    { type: "routine", id: routine.id },
    ...routine.exercises.flatMap((e: any) => [{ type: "exercise", id: e.exerciseId }, ...(e.id ? [{ type: "routine_exercise", id: e.id }] : [])]),
  ]);
  const prefs = new Map((await q.query("SELECT * FROM exercise_prefs WHERE exercise_id = ANY($1::uuid[])", [exIds])).rows.map((p: any) => [p.exercise_id, p]));
  const d = restDefaultsOf(settings.workout);

  const out: PlannedExercise[] = [];
  for (const re of routine.exercises) {
    // last time beside each set: this routine's own, else any; a routine starts from its own numbers (they follow each
    // finished workout), a workout planned on the spot (no routine) from last time's, unless kept fixed
    let hist = routine.id ? await exerciseSessions(q, re.exerciseId, 1, routine.id) : [];
    if (!hist.length) hist = await exerciseSessions(q, re.exerciseId, 1);
    const last = hist[0] ?? null;
    const useLast = !routine.id && !re.fixed;
    const pref: any = prefs.get(re.exerciseId);
    // each planned set with the same set last time: warm-ups with warm-ups, working sets with working sets, a left set
    // with last time's left one; more sets than last time repeat the last working set
    const prevs = pairSets(re.sets as { kind: SetKind; side?: string | null }[], (last?.sets ?? []) as any[], true);
    const exReminders = reminders.filter((r) => r.targetType === "exercise" && r.targetId === re.exerciseId);
    const delta = exReminders.reduce((a, r) => ({ w: a.w + (r.action?.weightKg ?? 0), r: a.r + (r.action?.reps ?? 0) }), { w: 0, r: 0 });
    // an older "Ready for more weight" reminder still pending: an exact weight and reps (the newest wins). None are made
    // any more (Progression writes into the routine at the finish)
    const exact = exReminders.filter((r) => r.action?.setWeightKg != null).at(-1)?.action ?? null;

    // a drop set moves with the set it drops from: when a reminder sets that set's weight, the drop shifts by as much
    let parentShift = 0;
    const sets: PlannedSet[] = re.sets.map((s: any, i: number) => {
      const prev = prevs[i];
      const fromLast = useLast && prev && (prev.weightKg != null || prev.reps != null || prev.durationS != null);
      let weightKg = fromLast ? prev.weightKg : s.weightKg;
      // a rep range starts where last time's reps left it inside the range (targetReps stays the range's bottom)
      let reps = fromLast ? prev.reps : startRepsOf(s);
      let adjusted = false;
      if (s.kind !== "warmup") {
        if (s.kind === "drop") { if (parentShift && weightKg != null) { weightKg = Math.max(0, weightKg + parentShift); adjusted = true; } }
        else parentShift = 0;
        if (delta.w && weightKg != null) { weightKg = Math.round((weightKg + delta.w) * 100) / 100; adjusted = true; }
        if (delta.r && reps != null) { reps += delta.r; adjusted = true; }
        if (exact && s.kind !== "drop") {
          parentShift += exact.setWeightKg! - (weightKg ?? exact.setWeightKg!);
          weightKg = exact.setWeightKg!; if (exact.setReps != null) reps = exact.setReps; adjusted = true;
        }
      }
      const isLastSet = i === re.sets.length - 1;
      return {
        kind: s.kind, weightKg, reps,
        durationS: fromLast && prev.durationS != null ? prev.durationS : s.durationS,
        distanceM: fromLast && prev.distanceM != null ? prev.distanceM : s.distanceM,
        rpe: s.rpe, side: s.side ?? null,
        restS: restAfterSet({ setRestS: s.restS, kind: s.kind, nextKind: re.sets[i + 1]?.kind, sideRound: opensSideRound(re.sets, i), byKindS: re.restByKind, exRestS: re.restS, prefRestS: pref?.rest_s, isLastSet, exRestAfterS: re.restAfterS, prefRestAfterS: pref?.rest_after_s }, d),
        targetReps: s.reps, targetRepsMax: s.repsMax, targetWeightKg: s.weightKg,
        prev: prev ? { weightKg: prev.weightKg, reps: prev.reps, durationS: prev.durationS, distanceM: prev.distanceM } : null,
        prefilled: !!fromLast, adjusted,
      };
    });
    out.push({
      routineExerciseId: re.id ?? null, exerciseId: re.exerciseId, exercise: re.exercise, superset: re.superset, restS: re.restS, restAfterS: re.restAfterS,
      repRestS: re.repRestS, note: re.note ?? "", sets,
      last: last ? { workoutId: last.workoutId, workoutName: last.workoutName, startedAt: last.startedAt, position: last.position, ofN: last.ofN, sets: last.sets } : null,
      reminders: exReminders, notes: notes.filter((n) => (n.targetType === "exercise" && n.targetId === re.exerciseId) || (n.targetType === "routine_exercise" && n.targetId === re.id)),
    });
  }
  // superset rounds: no rest between the exercises inside a round
  out.forEach((e, i) => {
    const nx = out[i + 1];
    if (e.superset && nx?.superset === e.superset) e.sets.forEach((s) => { s.restS = 0; });
  });
  const est = estimate(out.map((e) => ({ sets: e.sets.map((s) => ({ kind: s.kind, reps: s.reps, durationS: s.durationS, restS: s.restS })) })));
  return { exercises: out, reminders: reminders.filter((r) => r.targetType === "routine"), notes: notes.filter((n) => n.targetType === "routine"), estimate: est };
}
