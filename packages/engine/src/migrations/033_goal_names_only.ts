// A goal's title column now holds only a name the person gave it; the automatic title ("Walk 30 min a day") is built on
// every read (withTitles in modules/goals.ts), so it follows a renamed routine, a change of units or an edited target.
// Before, the app stored its automatic title at save time ("Walk: 30 min time a day"), which went stale and would now
// read as a name the person chose. Each stored title that has the exact shape the old app's builder made for that goal's
// measure is cleared here (the name of what it was about and the number may have changed since, so those parts match
// anything): "<about>: <n> <unit> <measure>< a week|a month|a day|on …>", "<about>: <n> a week" for sessions,
// "<measure> to <n> <unit>" for the body. The two goals the app once made by itself ("Weekly target", "Daily steps",
// ids from the person's id, see 026) lose their app-given names too, unless renamed since.
// The measures' names are written out as they were, not read from the shared list, so a later rename there can't change
// what this migration did.
const N = "[0-9][0-9.,]*";
const PER = "( a week| a month| a day| on .+)?";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "''");
// metric → its name in the old form, lower-cased as the old title had it
const OLD: [string, string][] = [
  ["workouts", "workouts"], ["active_minutes", "active minutes (workouts and activities)"], ["streak_weeks", "weeks in a row meeting your weekly goal"],
  ["volume", "total volume"], ["routine_count", "times done"], ["routine_duration", "finish within"], ["routine_volume", "volume in one session"],
  ["max_weight", "heaviest weight"], ["e1rm", "estimated one-rep max"], ["max_reps", "most reps in a set"], ["max_duration", "longest hold"],
  ["exercise_count", "times done"], ["muscle_sets", "working sets"], ["muscle_sessions", "sessions training it"], ["activity_distance", "distance"],
  ["activity_count", "number of sessions"], ["activity_minutes", "time"], ["steps_avg", "average daily steps"], ["sleep_h", "average sleep"],
];
const shaped = OLD.map(([m, name]) => `(metric = '${m}' AND title ~ '^(.+: )?(under )?${N} \\S+ ${esc(name)}${PER}$')`).join("\n  OR ");

export default /* sql */ `
UPDATE goals SET title = '' WHERE title <> '' AND (
  ${shaped}
  OR (metric IN ('sessions', 'activity_count') AND title ~ '^.+: ${N}( a week| a month| a day| on .+| in total)$')
  OR (metric IN ('body_weight', 'body_metric') AND title ~ '^.+ to ${N} (kg|lb|cm|in|%)$')
  OR (id = md5(user_id::text || ':weekly-target')::uuid AND title = 'Weekly target')
  OR (id = md5(user_id::text || ':daily-steps')::uuid AND title = 'Daily steps')
);
`;
