// Home shows only goals the person made and pinned. The app used to make two goals by itself (the "Weekly target",
// pinned first on Home with its streak, and "Daily steps") with ids taken from the person's id, so they are told apart
// from goals the person made (random v7 ids) by id alone, whatever they were renamed to. They come off Home here; the
// goals themselves and their history stay in Goals, where the person can pin them again or delete them.

/** The two goals' ids: from each person's own id, or (a restore of an older backup, modules/data.ts) the ids they have
 * in that file, which came from the id of the account it was made in. */
export interface SeededGoals { weekly: string | null; steps: string | null }
const lit = (id: string | null) => (id ? `'${id.replace(/'/g, "''")}'` : "NULL");
export const seededIds = (s?: SeededGoals): [string, string] => s
  ? [lit(s.weekly), lit(s.steps)]
  : ["md5(s.user_id::text || ':weekly-target')::uuid::text", "md5(s.user_id::text || ':daily-steps')::uuid::text"];

export function unpinSeededGoals(seeded?: SeededGoals): string {
  const [w, st] = seededIds(seeded);
  return /* sql */ `
UPDATE user_settings s SET data = jsonb_set(s.data, '{home,goals}', coalesce((
    SELECT jsonb_agg(x ORDER BY i) FROM jsonb_array_elements(s.data->'home'->'goals') WITH ORDINALITY AS t(x, i)
    WHERE x->>'id' IS DISTINCT FROM ${w}
      AND x->>'id' IS DISTINCT FROM ${st}), '[]'::jsonb))
-- SQL may test the conditions in any order, so the array check guards the EXISTS itself: a pin list that isn't an array
-- (written by hand or an old bug) is skipped instead of failing the whole migration
WHERE CASE WHEN jsonb_typeof(s.data->'home'->'goals') = 'array' THEN EXISTS (SELECT 1 FROM jsonb_array_elements(s.data->'home'->'goals') x
    WHERE x->>'id' IN (${w}, ${st})) ELSE false END;
`;
}

export default unpinSeededGoals();
