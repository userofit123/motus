// Home's suggestions: the numbers they're worked out from. The rules themselves are in @motus/shared (pickSuggestions).
import { pickSuggestions } from "@motus/shared";
import type { Sql } from "../db";
import type { RoutineSummary, HomeSuggestion } from "@motus/shared";
import { programState } from "./programs";
import { dayIn } from "./achievements";

const DAY = 86400000;

/** hidden: suggestions you dismissed (subject → when). tzMin: the app's offset, so days are counted by its calendar, as the
 *  Routines page counts "last done". plannedRoutineIds: routines planned from today on and not done yet; a workout in
 *  progress counts as planned too. */
export async function suggestions(q: Sql, routines: RoutineSummary[], now: Date, hidden: Record<string, string> = {}, tzMin = 0, plannedRoutineIds: string[] = []): Promise<HomeSuggestion[]> {
  const usable = routines.filter((r) => !r.archived && r.exerciseCount > 0);
  const ids = new Set(usable.map((r) => r.id));
  // whole calendar days since, on the app's calendar: yesterday evening is 1 day ago at any hour today
  const today = Date.parse(dayIn(now, tzMin));
  const calDays = (at: string | number | Date) => Math.round((today - Date.parse(dayIn(new Date(at), tzMin))) / DAY);

  const programs = [];
  for (const p of (await q.query("SELECT * FROM programs WHERE active ORDER BY created_at DESC")).rows) {
    const next = (await programState(q, p)).next;
    if (next) programs.push({ program: String(p.name), routineId: next.routineId, name: next.name, color: next.color ?? null, week: next.week, day: next.day, deload: !!next.deload });
  }
  const recent = (await q.query<{ routine_id: string | null }>(
    "SELECT routine_id FROM workouts WHERE status = 'completed' ORDER BY started_at DESC LIMIT 80")).rows.map((x) => x.routine_id).reverse();
  const muscleDays = Object.fromEntries((await q.query<{ m: string; at: string }>(
    `SELECT unnest(e.primary_muscles) AS m, max(w.started_at) AS at FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
     WHERE w.status = 'completed' AND we.status <> 'skipped' GROUP BY 1`)).rows.map((x) => [x.m, calDays(x.at)]));
  const sets28 = Object.fromEntries((await q.query<{ m: string; n: string }>(
    `SELECT unnest(e.primary_muscles) AS m, count(s.id) AS n FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
     JOIN workout_sets s ON s.workout_exercise_id = we.id AND s.done AND s.kind <> 'warmup'
     WHERE w.status = 'completed' AND w.started_at >= $1 GROUP BY 1`, [new Date(now.getTime() - 28 * DAY).toISOString()])).rows.map((x) => [x.m, Number(x.n)]));
  const routineMuscles = (await q.query<{ routine_id: string; m: string; n: string; main: boolean }>(
    `SELECT re.routine_id, unnest(e.primary_muscles) AS m, count(*) AS n, true AS main FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id GROUP BY 1, 2
     UNION ALL SELECT re.routine_id, unnest(e.secondary_muscles) AS m, count(*) AS n, false AS main FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id GROUP BY 1, 2`))
    .rows.filter((h) => ids.has(h.routine_id)).map((h) => ({ routineId: h.routine_id, muscle: h.m, n: Number(h.n), main: h.main }));

  // taken care of: what's planned, and the workout in progress (its routine and the muscles of what's in it)
  const going = (await q.query<{ routine_id: string | null; m: string | null }>(
    `SELECT w.routine_id, unnest(e.primary_muscles) AS m FROM workouts w LEFT JOIN workout_exercises we ON we.workout_id = w.id LEFT JOIN exercises e ON e.id = we.exercise_id
     WHERE w.status = 'in_progress'`)).rows;
  const plannedIds = new Set([...plannedRoutineIds, ...going.flatMap((x) => (x.routine_id ? [x.routine_id] : []))]);
  const plannedMuscles = new Set([...routineMuscles.filter((h) => h.main && plannedIds.has(h.routineId)).map((h) => h.muscle), ...going.flatMap((x) => (x.m ? [x.m] : []))]);

  return pickSuggestions({
    now: now.getTime(),
    routines: usable.map((r) => ({ id: r.id, name: r.name, color: r.color ?? null, daysAgo: r.lastDoneAt ? calDays(r.lastDoneAt) : null })),
    programs, recent, muscleDays, sets28, routineMuscles,
    planned: { routineIds: [...plannedIds], muscles: [...plannedMuscles] },
    hidden,
  });
}
