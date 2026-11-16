// Letting go of a band session linked to a workout or activity recorded in Motus (046, bandMatch; M-250 fix round 3):
// deleting that record makes the session its own activity again, instead of marking it deleted as the person's
// deletion of an imported activity does. Its entry lets go of the record (ref, linked) and counts as restored
// (restored_at), so the phone's next read brings it in as an activity; never deleted_at, so the check that keeps out
// the same session from a second app after a deletion doesn't keep this one out.
// - health_imports.copied: which of the band's figures this entry filled in on the Motus activity ({"steps": "5000"}),
//   so letting go takes back exactly those (when still the same) and the steps aren't counted twice afterwards.
// - activities.edited_at: when the person changed what an activity is (type, name, notes, route). An imported activity
//   the person edited is theirs: it is never taken into a Motus record (linkBandSessions) and so never deleted by it.
// 034's trigger again, now also on workouts: the sync skip stays (the copy where the record was deleted lets go, and
// that travels as its own health_imports row).
export default /* sql */ `
ALTER TABLE health_imports ADD COLUMN copied jsonb;
ALTER TABLE activities ADD COLUMN edited_at timestamptz;
CREATE OR REPLACE FUNCTION motus_health_deleted_mark() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('motus.sync_apply', true) = '1' OR coalesce(current_setting('motus.sync_origin', true), '') <> '' THEN RETURN NULL; END IF;
  -- one branch per table: each only names columns its table has
  IF TG_TABLE_NAME = 'daily_logs' THEN
    -- a typed number (or one from before sources) is the person's own: clearing it leaves the band's import as it was
    IF OLD.source IS DISTINCT FROM 'health_connect' THEN RETURN NULL; END IF;
    UPDATE health_imports SET deleted_at = now()
      WHERE user_id = OLD.user_id AND key = CASE OLD.kind WHEN 'sleep_h' THEN 'sleep' WHEN 'distance_m' THEN 'distance' WHEN 'water_ml' THEN 'water' ELSE OLD.kind END
        || ':' || to_char(OLD.date, 'YYYY-MM-DD') AND deleted_at IS NULL;
  ELSE
    -- a band session linked to this workout or activity: its own activity again with the next read
    UPDATE health_imports SET ref = NULL, linked = NULL, copied = NULL, restored_at = now()
      WHERE user_id = OLD.user_id AND ref = OLD.id::text AND linked IS NOT NULL AND deleted_at IS NULL;
    IF TG_TABLE_NAME <> 'workouts' THEN
      UPDATE health_imports SET deleted_at = now() WHERE user_id = OLD.user_id AND ref = OLD.id::text AND linked IS NULL AND deleted_at IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER health_deleted_mark AFTER DELETE ON workouts FOR EACH ROW EXECUTE FUNCTION motus_health_deleted_mark();
`;
