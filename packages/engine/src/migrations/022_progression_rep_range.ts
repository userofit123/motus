// The rep range moves from each routine set into its exercise's Progression (M-107): Progression is what uses it (the
// reps move inside it, every set at its top makes the weight go up), so one range per exercise, with a default in
// Settings. An exercise whose sets had a range keeps it as its own (the lowest bottom and the highest top); each set's
// reps become where it was to start next time (its starting reps, else the bottom). The old columns stay, unused, so
// an older app's save still works.
export default /* sql */ `
UPDATE routine_exercises re SET progression = coalesce(CASE WHEN jsonb_typeof(re.progression) = 'object' THEN re.progression END,
    '{"mode": null, "stepKg": null, "lowerAfter": null}'::jsonb)
  || jsonb_build_object('repsMin', r.lo, 'repsMax', r.hi)
FROM (SELECT routine_exercise_id, min(reps) AS lo, max(reps_max) AS hi FROM routine_sets
      WHERE reps_max IS NOT NULL AND reps IS NOT NULL AND kind NOT IN ('warmup', 'drop') GROUP BY routine_exercise_id) r
WHERE r.routine_exercise_id = re.id AND r.lo BETWEEN 1 AND 100 AND r.hi BETWEEN r.lo AND 100
  AND coalesce(jsonb_typeof(re.progression->'repsMin'), 'null') = 'null';
UPDATE routine_sets SET reps = CASE WHEN start_reps IS NOT NULL AND reps IS NOT NULL AND reps_max IS NOT NULL
    THEN least(greatest(start_reps, reps), greatest(reps_max, reps)) ELSE reps END,
  reps_max = NULL, start_reps = NULL
WHERE reps_max IS NOT NULL OR start_reps IS NOT NULL;
`;
