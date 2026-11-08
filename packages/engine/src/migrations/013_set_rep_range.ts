// A workout set keeps the top of its rep range ("8-12": 12), so the Finish screen can tell when every set reached it
// and suggest the next weight with reps back at the bottom.
export default /* sql */ `
ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS target_reps_max int;
`;
