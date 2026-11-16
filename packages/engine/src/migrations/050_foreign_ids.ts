// motus_foreign_row (035) for every synced table whose key is an id, not only those a reference points into: a row a
// device sends whose id is another account's (a backup restored inside a device's copy, M-257) is then told apart from
// one refused for any other reason, and the server gives it an id of this account's own (modules/sync.ts push). Still
// yes or no only. A table without user_id (none today) answers no: the row is then never taken for someone else's.
const TABLES = ["folders", "programs", "routines", "routine_exercises", "routine_sets", "routine_versions", "schedules", "workouts",
  "workout_exercises", "workout_sets", "notes", "reminders", "goals", "activity_types", "activities", "body_metrics"];

export default /* sql */ `
CREATE OR REPLACE FUNCTION motus_foreign_row(t text, i uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me uuid := NULLIF(current_setting('app.user_id', true), '')::uuid; r boolean;
BEGIN
  -- the shared catalog has no owner and is everyone's
  IF t = 'exercises' THEN
    RETURN EXISTS (SELECT 1 FROM exercises WHERE id = i AND owner_id IS NOT NULL AND owner_id IS DISTINCT FROM me);
  END IF;
  IF NOT t = ANY (ARRAY[${TABLES.map((x) => `'${x}'`).join(", ")}]) THEN
    RAISE EXCEPTION 'not a synced table with an id: %', t;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'user_id') THEN
    RETURN false;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND user_id IS DISTINCT FROM $2)', t) INTO r USING i, me;
  RETURN r;
END $$;
`;
