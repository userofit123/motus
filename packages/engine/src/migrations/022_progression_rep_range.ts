// The rep range moves from each routine set into its exercise's Progression (M-107): Progression is what uses it (the
// reps move inside it, every set at its top makes the weight go up), so one range per exercise, with a default in
// Settings. An exercise whose sets had a range keeps it as its own (the lowest bottom and the highest top); each set's
// reps become where it was to start next time (its starting reps, else the bottom; a set with only a top keeps the top
// as its reps). The old columns stay, unused, so an older app's save still works.
//
// An exercise with weight and reps but no range (5 × 5) gets its targets as its own range, so the default 6-12 doesn't
// turn its 5 reps into a missed workout that lowers the weight: all working sets at 5 give 5-5, so every set at 5 still
// steps the weight up as before. Working sets with different targets (5, 5, 8) get the lowest to the highest (5-8), the
// same rule as for sets with a range: no working set starts below the bottom, so none of them counts as a miss.
// "Keep these numbers fixed" ones are left alone: their numbers never move, so a range means nothing to them.
export default /* sql */ `
UPDATE routine_exercises re SET progression = coalesce(CASE WHEN jsonb_typeof(re.progression) = 'object' THEN re.progression END,
    '{"mode": null, "stepKg": null, "lowerAfter": null}'::jsonb)
  || jsonb_build_object('repsMin', r.lo, 'repsMax', r.hi)
FROM (SELECT routine_exercise_id, min(reps) AS lo, max(reps_max) AS hi FROM routine_sets
      WHERE reps_max IS NOT NULL AND reps IS NOT NULL AND kind NOT IN ('warmup', 'drop') GROUP BY routine_exercise_id) r
WHERE r.routine_exercise_id = re.id AND r.lo BETWEEN 1 AND 100 AND r.hi BETWEEN r.lo AND 100
  AND coalesce(jsonb_typeof(re.progression->'repsMin'), 'null') = 'null';
UPDATE routine_exercises re SET progression = coalesce(CASE WHEN jsonb_typeof(re.progression) = 'object' THEN re.progression END,
    '{"mode": null, "stepKg": null, "lowerAfter": null}'::jsonb)
  || jsonb_build_object('repsMin', r.lo, 'repsMax', r.hi)
FROM (SELECT routine_exercise_id, min(coalesce(reps, reps_max)) AS lo, max(coalesce(reps, reps_max)) AS hi FROM routine_sets
      WHERE coalesce(reps, reps_max) IS NOT NULL AND kind NOT IN ('warmup', 'drop') GROUP BY routine_exercise_id) r, exercises x
WHERE r.routine_exercise_id = re.id AND x.id = re.exercise_id AND x.tracking IN ('weight_reps', 'bodyweight_reps', 'assisted') AND NOT re.fixed
  AND r.lo BETWEEN 1 AND 100 AND r.hi BETWEEN r.lo AND 100
  AND coalesce(jsonb_typeof(re.progression->'repsMin'), 'null') = 'null';
UPDATE routine_sets SET reps = CASE WHEN start_reps IS NOT NULL AND reps IS NOT NULL AND reps_max IS NOT NULL
    THEN least(greatest(start_reps, reps), greatest(reps_max, reps)) ELSE coalesce(reps, reps_max) END,
  reps_max = NULL, start_reps = NULL
WHERE reps_max IS NOT NULL OR start_reps IS NOT NULL;
`;
