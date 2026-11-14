// Whether a row a device's change points at is someone else's (sync/core.ts ownRefs). Row-level security hides other
// people's rows, so a request can't tell "someone else's" from "not here yet": a row created later in the same push, or
// in a later page of it (a device sends 500 changes at a time), and a row already deleted. Only someone else's row may
// make the server clear or refuse a reference; one it can't find yet is kept. This function looks past row-level
// security for exactly that and nothing else: yes or no, for the signed-in person (app.user_id), on the tables a
// synced row can point into.

/** The tables a synced row's reference points into (REFS in sync/core.ts), besides exercises; each has user_id. */
const TARGETS = ["folders", "programs", "routines", "routine_exercises", "schedules", "workouts", "workout_exercises", "activities"];

export default /* sql */ `
CREATE FUNCTION motus_foreign_row(t text, i uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me uuid := NULLIF(current_setting('app.user_id', true), '')::uuid; r boolean;
BEGIN
  -- the shared catalog has no owner and is everyone's
  IF t = 'exercises' THEN
    RETURN EXISTS (SELECT 1 FROM exercises WHERE id = i AND owner_id IS NOT NULL AND owner_id IS DISTINCT FROM me);
  END IF;
  IF NOT t = ANY (ARRAY[${TARGETS.map((x) => `'${x}'`).join(", ")}]) THEN
    RAISE EXCEPTION 'not a table synced rows point into: %', t;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND user_id IS DISTINCT FROM $2)', t) INTO r USING i, me;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION motus_foreign_row(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION motus_foreign_row(text, uuid) TO motus_app;
`;
