// 040's trigger again, with two changes (M-238 review):
// - it takes the person's records lock (modules/healthRecords.ts lockRecords) before deleting, so a save running at the
//   same moment, which reads blocks, merges and writes them back, can't bring back what the deletion took: the save
//   either finishes first (and the deletion then takes its records) or waits and sees the key deleted;
// - a reading's or session's record is deleted from the blocks holding its id only (the ids index), and a block it was
//   the last record of goes, instead of looking through all of the type's blocks for empty ones.
export default /* sql */ `
CREATE OR REPLACE FUNCTION motus_health_records_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text; rid text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('health_records:' || NEW.user_id::text));
  t := CASE NEW.kind WHEN 'water' THEN 'hydration' WHEN 'activity' THEN 'exercise' ELSE NEW.kind END;
  IF NEW.kind IN ('weight', 'body_fat', 'activity') THEN
    rid := substr(NEW.key, length(NEW.kind) + 2);
    DELETE FROM health_records WHERE user_id = NEW.user_id AND type = t AND ids @> ARRAY[rid] AND ids <@ ARRAY[rid];
    UPDATE health_records SET recs = recs - rid, ids = array_remove(ids, rid), updated_at = now()
      WHERE user_id = NEW.user_id AND type = t AND ids @> ARRAY[rid];
  ELSIF NEW.date IS NOT NULL THEN
    DELETE FROM health_records WHERE user_id = NEW.user_id AND type = t AND day = NEW.date;
  END IF;
  RETURN NULL;
END $$;
`;
