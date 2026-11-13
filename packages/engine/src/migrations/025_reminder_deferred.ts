// "Next time" on a reminder in a running workout: the workout it was put off in, so that workout neither shows it again
// nor counts it as done on finish, and the next workout brings it back. reminders already has user_id and its
// row-level-security policy (002).
export default /* sql */ `
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS deferred_workout_id uuid REFERENCES workouts(id) ON DELETE SET NULL;
`;
