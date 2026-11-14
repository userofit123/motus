// A goal's title column now holds only a name the person gave it; the automatic title ("Walk 30 min a day") is built on
// every read (withTitles in modules/goals.ts), so it follows a renamed routine, a change of units or an edited target.
// Before, the app stored its automatic title at save time ("Walk: 30 min time a day"), which went stale and would now
// read as a name the person chose. A stored title is cleared here only when it is exactly the string the old app's
// builder (autoTitle in GoalsPage.vue, every version of it) would have made for that goal's own fields: the name of what
// it is about as it is now (a routine renamed since keeps its old title as a name, which the person can clear), the
// measure's old name and unit (kg or lb, km or mi, cm or in, as the units may have changed since), and the wording of its
// period and days (days in either week order). Only the number is free: the old edit sheet changed a target without its
// title. Anything else, such as "Summer cut to 75 kg" or "Gym: 3 a week", is a name the person typed and stays.
// The two goals the app once made by itself ("Weekly target", "Daily steps", ids from the person's id, see 026) lose
// their app-given names too, unless renamed since.
// Names are written out as they were, not read from the shared lists, so a later rename there can't change what this
// migration did.
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const arr = (xs: string[]) => `ARRAY[${xs.map(q).join(", ")}]::text[]`;
// metric → its old name, lower-cased as the old title had it, the units it was shown in, and whether it said "under"
const OLD: [string, string, string[], boolean][] = [
  ["workouts", "workouts", ["workouts"], false], ["active_minutes", "active minutes (workouts and activities)", ["min"], false],
  ["streak_weeks", "weeks in a row meeting your weekly goal", ["weeks"], false], ["volume", "total volume", ["kg", "lb"], false],
  ["routine_count", "times done", ["times"], false], ["routine_duration", "finish within", ["min"], true],
  ["routine_volume", "volume in one session", ["kg", "lb"], false], ["max_weight", "heaviest weight", ["kg", "lb"], false],
  ["e1rm", "estimated one-rep max", ["kg", "lb"], false], ["max_reps", "most reps in a set", ["reps"], false],
  ["max_duration", "longest hold", ["s"], false], ["exercise_count", "times done", ["times"], false],
  ["muscle_sets", "working sets", ["sets"], false], ["muscle_sessions", "sessions training it", ["times"], false],
  ["activity_distance", "distance", ["km", "mi"], false], ["activity_count", "number of sessions", ["times"], false],
  ["activity_minutes", "time", ["min"], false], ["steps_avg", "average daily steps", ["steps"], false], ["sleep_h", "average sleep", ["h"], false],
];
const GROUPS: [string, string][] = [["chest", "Chest"], ["back", "Back"], ["shoulders", "Shoulders"], ["arms", "Arms"], ["core", "Core"], ["legs", "Legs"], ["neck", "Neck"]];
// body measure → its names: BODY_MEASURES (packages/shared/src/body.ts) and the first goal form's own list ("Body fat %")
const BODY: [string, string][] = [
  ["weight", "Body weight"], ["body_fat", "Body fat"], ["body_fat", "Body fat %"], ["neck", "Neck"], ["shoulders", "Shoulders"], ["chest", "Chest"],
  ["waist", "Waist"], ["hips", "Hips"], ["arm", "Arm"], ["thigh", "Thigh"],
  ...[["arm", "Upper arm"], ["forearm", "Forearm"], ["thigh", "Thigh"], ["calf", "Calf"]].flatMap(([k, n]) =>
    [[`${k}_l`, `${n} (left)`], [`${k}_r`, `${n} (right)`]] as [string, string][]),
];
const values = (rows: string[][]) => rows.map((r) => `(${r.join(", ")})`).join(", ");

export default /* sql */ `
-- not logged for sync (motus.sync_apply, 004): every copy runs this migration and clears its own titles, and a logged
-- change would travel as the whole row and could overwrite a newer edit made on another copy meanwhile
SELECT set_config('motus.sync_apply', '1', true);
WITH m(metric, name, units, under) AS (VALUES ${values(OLD.map(([m, n, u, under]) => [q(m), q(n), arr(u), String(under)]))}),
grp(k, n) AS (VALUES ${values(GROUPS.map(([k, n]) => [q(k), q(n)]))}),
body(k, n) AS (VALUES ${values(BODY.map(([k, n]) => [q(k), q(n)]))}),
g AS (
  SELECT x.id, x.title, x.metric,
    -- "<about>": what the old form showed as the goal's routine, exercise, muscle group, activity or body measure
    CASE x.scope
      WHEN 'general' THEN ARRAY['']
      WHEN 'routine' THEN ARRAY(SELECT r.name FROM routines r WHERE r.id::text = x.scope_id)
      WHEN 'exercise' THEN ARRAY(SELECT e.name FROM exercises e WHERE e.id::text = x.scope_id)
      WHEN 'muscle' THEN ARRAY(SELECT grp.n FROM grp WHERE grp.k = x.scope_id)
      WHEN 'activity' THEN CASE WHEN x.scope_id IS NULL THEN ARRAY[CASE WHEN x.metric = 'sessions' THEN '' ELSE 'Any activity' END]
        ELSE ARRAY[coalesce((SELECT t.name FROM activity_types t WHERE t.user_id = x.user_id AND t.slug = x.scope_id), x.scope_id)]
          || CASE WHEN x.scope_id = 'workout' THEN ARRAY['Gym workouts'] ELSE '{}'::text[] END END
      WHEN 'body' THEN ARRAY(SELECT body.n FROM body WHERE body.k = coalesce(x.scope_id, 'weight'))
      ELSE '{}'::text[] END AS abouts,
    -- "< a week| a month| a day| on workdays| on Mon, Wed>", the chosen days in Sunday-first or Monday-first order
    CASE x.period WHEN 'week' THEN ARRAY[' a week'] WHEN 'month' THEN ARRAY[' a month'] WHEN 'once' THEN ARRAY['']
      ELSE CASE WHEN x.days = '"workdays"'::jsonb THEN ARRAY[' on workdays']
        WHEN jsonb_typeof(x.days) = 'array' AND jsonb_array_length(x.days) > 0 THEN ARRAY(SELECT ' on ' || (SELECT string_agg(
            (ARRAY['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[d::int + 1], ', ' ORDER BY (d::int - f + 7) % 7)
          FROM jsonb_array_elements_text(x.days) d) FROM generate_series(0, 1) f)
        ELSE ARRAY[' a day'] END END AS pers
  FROM goals x WHERE x.title <> ''
),
-- the old title around its number: "<about>: <under >" + n + " <unit> <measure><per>", "<about>: " + n + "<per>" for
-- sessions, "<measure> to " + n + " <unit>" for the body; runs of spaces were made one
shapes AS (
  SELECT g.id, g.title, regexp_replace(CASE WHEN a = '' THEN '' ELSE a || ': ' END || CASE WHEN m.under THEN 'under ' ELSE '' END, '\\s+', ' ', 'g') AS pre,
      regexp_replace(' ' || u || ' ' || m.name || p, '\\s+', ' ', 'g') AS suf
    FROM g JOIN m ON m.metric = g.metric, unnest(g.abouts) a, unnest(g.pers) p, unnest(m.units) u
  UNION ALL
  SELECT g.id, g.title, coalesce(nullif(a, ''), 'Sessions') || ': ', CASE WHEN p = '' THEN ' in total' ELSE p END
    FROM g, unnest(g.abouts) a, unnest(g.pers) p WHERE g.metric = 'sessions'
  UNION ALL
  SELECT g.id, g.title, a || ' to ', ' ' || u
    FROM g, unnest(g.abouts) a, unnest(ARRAY['kg', 'lb', 'cm', 'in', '%']) u WHERE g.metric IN ('body_weight', 'body_metric')
)
UPDATE goals SET title = '' WHERE id IN (
  SELECT s.id FROM shapes s
  WHERE length(s.title) > length(s.pre) + length(s.suf) AND left(s.title, length(s.pre)) = s.pre AND right(s.title, length(s.suf)) = s.suf
    AND substr(s.title, length(s.pre) + 1, length(s.title) - length(s.pre) - length(s.suf)) ~ '^[0-9]+(\\.[0-9]+)?$'
) OR (id = md5(user_id::text || ':weekly-target')::uuid AND title = 'Weekly target')
  OR (id = md5(user_id::text || ':daily-steps')::uuid AND title = 'Daily steps');
SELECT set_config('motus.sync_apply', '', true);
`;
