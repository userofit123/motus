// Before, the Weekly target was seeded counting gym workouts only, even for someone who had only logged activities, so
// their walks could never fill it. Seeding now makes it count everything for them; this does the same for those already
// seeded, under the seeding's own conditions (no weekly number set, no workouts, some activities) and only while the
// goal still counts gym workouts. Its id comes from the person's id, as in ensureStarterGoal.
export default /* sql */ `
UPDATE goals g SET scope_id = NULL
WHERE g.scope_id = 'workout'
  AND g.id = md5(g.user_id::text || ':weekly-target')::uuid
  AND NOT EXISTS (SELECT 1 FROM user_settings s WHERE s.user_id = g.user_id AND coalesce(jsonb_typeof(s.data->'weeklyGoal'), 'null') <> 'null')
  AND NOT EXISTS (SELECT 1 FROM workouts w WHERE w.user_id = g.user_id)
  AND EXISTS (SELECT 1 FROM activities a WHERE a.user_id = g.user_id);
`;
