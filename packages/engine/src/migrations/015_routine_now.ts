// A routine always holds where you are now (PLAN.md §8.7): its numbers follow each finished workout, then Progression.
// - "Always start with these numbers" becomes "Keep these numbers fixed" (fixed); "Start from what you did last time"
//   and its scope are gone, so prefill and prefill_scope go too.
// - progression holds the exercise's own Progression ({mode, stepKg, lowerAfter}, each null = follow Settings); an old
//   rule becomes its own Automatic with its step and its misses before lowering.
// - missed counts workouts in a row with missed reps, for "Lower the weight after".
// - routine_versions keep every version, each saying why it was made (an edit, or a workout and which); RLS is already
//   on the table (002_isolation).
export default /* sql */ `
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS fixed boolean NOT NULL DEFAULT false;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS missed int NOT NULL DEFAULT 0;
UPDATE routine_exercises SET fixed = true WHERE prefill = 'target';
UPDATE routine_exercises SET progression = jsonb_build_object(
    'mode', 'auto',
    'stepKg', CASE WHEN jsonb_typeof(progression->'incrementKg') = 'number' AND (progression->>'incrementKg')::numeric > 0 THEN (progression->'incrementKg') ELSE 'null'::jsonb END,
    'lowerAfter', CASE WHEN jsonb_typeof(progression->'deloadAfter') = 'number' THEN to_jsonb(least(10, greatest(0, round((progression->>'deloadAfter')::numeric)))::int) ELSE 'null'::jsonb END)
  WHERE progression IS NOT NULL AND jsonb_typeof(progression) = 'object' AND progression ? 'kind';
UPDATE routine_exercises SET progression = NULL WHERE progression IS NOT NULL AND (jsonb_typeof(progression) <> 'object' OR NOT progression ? 'mode');
ALTER TABLE routine_exercises DROP COLUMN IF EXISTS prefill;
ALTER TABLE routine_exercises DROP COLUMN IF EXISTS prefill_scope;
ALTER TABLE routine_versions ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'edit' CHECK (reason IN ('edit','workout'));
ALTER TABLE routine_versions ADD COLUMN IF NOT EXISTS workout_id uuid;
`;
