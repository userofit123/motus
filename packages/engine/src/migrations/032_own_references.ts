// M-184: rows that point at another account's rows. A browser tab still syncing one person's copy after someone else
// signed in (in another tab) pulled the other person's rows into it, and that copy then sent rows pointing at them:
// workouts, plans and reminders of one account naming another account's routines. Foreign keys are checked without
// row-level security, so the server took them. Now the server checks every reference a device sends (sync/core.ts);
// this repairs what got in before. Only the pointing row changes, never the other account's row: a reference that can
// be cleared is cleared; a row that means nothing without it (a routine's exercise inside someone else's routine, a
// note or reminder about someone else's routine) is removed. Children first, so removing a row never takes another
// account's row with it. On a device's copy (one person's rows) nothing matches.
const ROUTINE_DAY_FOREIGN = `EXISTS (SELECT 1 FROM jsonb_array_elements(p.weeks) w, jsonb_array_elements(CASE WHEN jsonb_typeof(w->'days') = 'array' THEN w->'days' ELSE '[]' END) d
  JOIN routines r ON r.id::text = d #>> '{}' WHERE r.user_id <> p.user_id)`;
// a custom exercise of someone else (the shared catalog has no owner and is everyone's)
const OTHERS_EXERCISE = (col: string) => `EXISTS (SELECT 1 FROM exercises y WHERE y.id = ${col} AND y.owner_id IS NOT NULL AND y.owner_id <> x.user_id)`;
const OTHERS = (table: string, col: string) => `EXISTS (SELECT 1 FROM ${table} y WHERE y.id = ${col} AND y.user_id <> x.user_id)`;
const clear = (table: string, col: string, target: string) => `UPDATE ${table} x SET ${col} = NULL WHERE ${OTHERS(target, `x.${col}`)};`;

export default /* sql */ `
${clear("routines", "folder_id", "folders")}
${clear("routines", "based_on_id", "routines")}
${clear("routine_versions", "workout_id", "workouts")}
${clear("schedules", "routine_id", "routines")}
${clear("workouts", "routine_id", "routines")}
${clear("workouts", "program_id", "programs")}
${clear("workouts", "schedule_id", "schedules")}
${clear("workout_exercises", "routine_exercise_id", "routine_exercises")}
${clear("notes", "scope_routine_id", "routines")}
${clear("notes", "workout_id", "workouts")}
${clear("reminders", "scope_routine_id", "routines")}
${clear("reminders", "created_workout_id", "workouts")}
${clear("reminders", "deferred_workout_id", "workouts")}
${clear("reminders", "last_shown_workout_id", "workouts")}
-- a program's days leave out routines that aren't its person's
UPDATE programs p SET weeks = (
  SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(w->'days') = 'array' THEN jsonb_set(w, '{days}', coalesce((
    SELECT jsonb_agg(d ORDER BY i) FROM jsonb_array_elements(w->'days') WITH ORDINALITY e(d, i)
    WHERE NOT EXISTS (SELECT 1 FROM routines r WHERE r.id::text = d #>> '{}' AND r.user_id <> p.user_id)), '[]')) ELSE w END ORDER BY wi), '[]')
  FROM jsonb_array_elements(p.weeks) WITH ORDINALITY ww(w, wi))
WHERE ${ROUTINE_DAY_FOREIGN};

DELETE FROM workout_sets x WHERE ${OTHERS("workout_exercises", "x.workout_exercise_id")};
DELETE FROM workout_exercises x WHERE ${OTHERS("workouts", "x.workout_id")} OR ${OTHERS_EXERCISE("x.exercise_id")};
DELETE FROM routine_sets x WHERE ${OTHERS("routine_exercises", "x.routine_exercise_id")};
DELETE FROM routine_versions x WHERE ${OTHERS("routines", "x.routine_id")};
DELETE FROM routine_exercises x WHERE ${OTHERS("routines", "x.routine_id")} OR ${OTHERS_EXERCISE("x.exercise_id")};
DELETE FROM schedule_exceptions x WHERE EXISTS (SELECT 1 FROM schedules y WHERE y.id = x.schedule_id AND y.user_id <> x.user_id);
DELETE FROM exercise_prefs x WHERE ${OTHERS_EXERCISE("x.exercise_id")};
DELETE FROM notes x WHERE (x.target_type = 'exercise' AND ${OTHERS_EXERCISE("x.target_id")})
  OR (x.target_type = 'routine' AND ${OTHERS("routines", "x.target_id")})
  OR (x.target_type = 'workout' AND ${OTHERS("workouts", "x.target_id")})
  OR (x.target_type = 'workout_exercise' AND ${OTHERS("workout_exercises", "x.target_id")})
  OR (x.target_type = 'routine_exercise' AND ${OTHERS("routine_exercises", "x.target_id")})
  OR (x.target_type = 'activity' AND ${OTHERS("activities", "x.target_id")});
DELETE FROM reminders x WHERE (x.target_type = 'routine' AND ${OTHERS("routines", "x.target_id")})
  OR (x.target_type <> 'routine' AND ${OTHERS_EXERCISE("x.target_id")});
DELETE FROM goals x WHERE (x.scope = 'routine' AND EXISTS (SELECT 1 FROM routines y WHERE y.id::text = x.scope_id AND y.user_id <> x.user_id))
  OR (x.scope = 'exercise' AND EXISTS (SELECT 1 FROM exercises y WHERE y.id::text = x.scope_id AND y.owner_id IS NOT NULL AND y.owner_id <> x.user_id));
`;
