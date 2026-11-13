// Home shows only goals the person made and pinned. The app used to make two goals by itself (the "Weekly target",
// pinned first on Home with its streak, and "Daily steps") with ids taken from the person's id, so they are told apart
// from goals the person made (random v7 ids) by id alone, whatever they were renamed to. They come off Home here; the
// goals themselves and their history stay in Goals, where the person can pin them again or delete them.
export default /* sql */ `
UPDATE user_settings s SET data = jsonb_set(s.data, '{home,goals}', coalesce((
    SELECT jsonb_agg(x ORDER BY i) FROM jsonb_array_elements(s.data->'home'->'goals') WITH ORDINALITY AS t(x, i)
    WHERE x->>'id' IS DISTINCT FROM md5(s.user_id::text || ':weekly-target')::uuid::text
      AND x->>'id' IS DISTINCT FROM md5(s.user_id::text || ':daily-steps')::uuid::text), '[]'::jsonb))
WHERE jsonb_typeof(s.data->'home'->'goals') = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.data->'home'->'goals') x
    WHERE x->>'id' IN (md5(s.user_id::text || ':weekly-target')::uuid::text, md5(s.user_id::text || ':daily-steps')::uuid::text));
`;
