// A workout set keeps the numbers it started with (the plan's, after a lighter week or a reminder), so the Finish screen
// can tell sets you typed into from ones you never touched.
export default /* sql */ `
ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS start_weight_kg numeric, ADD COLUMN IF NOT EXISTS start_reps int;
`;
