// Track by: each person can choose what any exercise tracks (counted by reps, time, distance or two of them, with or
// without weight), built-in ones too. It replaces the reps-or-time switch (023's timed): null keeps the exercise's own
// way, and each earlier switch becomes the tracking it stood for. exercise_prefs already has user_id and its
// row-level-security policy (002).
export default /* sql */ `
ALTER TABLE exercise_prefs ADD COLUMN IF NOT EXISTS tracking text;
UPDATE exercise_prefs p SET tracking = CASE
    WHEN p.timed AND e.tracking IN ('weight_reps', 'bodyweight_reps') THEN 'weight_duration'
    WHEN p.timed AND e.tracking IN ('assisted', 'reps_only') THEN 'duration'
    WHEN p.timed = false AND e.tracking = 'weight_duration' THEN 'weight_reps'
    WHEN p.timed = false AND e.tracking = 'duration' THEN 'reps_only'
  END
  FROM exercises e WHERE e.id = p.exercise_id AND p.timed IS NOT NULL AND p.tracking IS NULL;
ALTER TABLE exercise_prefs DROP COLUMN IF EXISTS timed;
`;
