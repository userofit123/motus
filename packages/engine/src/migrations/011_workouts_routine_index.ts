// Routine cards and previews look up a routine's recent workouts (count, newest, last few durations): index them by routine
// and start time so that doesn't scan every workout.
export default /* sql */ `
CREATE INDEX workouts_routine_started ON workouts (routine_id, started_at DESC);
`;
