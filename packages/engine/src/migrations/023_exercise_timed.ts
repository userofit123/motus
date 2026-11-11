// Timed sets: each person can switch any exercise between reps and time (a stretch for reps, a dead hang or a timed
// carry), built-in ones too, so it is a per-person setting beside one side at a time. Null keeps the exercise's own way.
// exercise_prefs already has user_id and its row-level-security policy (002).
export default /* sql */ `
ALTER TABLE exercise_prefs ADD COLUMN IF NOT EXISTS timed boolean;
`;
