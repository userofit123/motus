// What Health Connect brought in and the person deleted elsewhere in the app (a day's number cleared in the daily log, a
// weight or body fat reading deleted, an activity deleted) is marked deleted in the import log at the moment it is
// deleted, so the next import doesn't bring it back. Before, an import guessed it: an import log entry whose data was
// missing counted as deleted by the person. That guess also hit data nobody deleted, and the deletion then went to every
// copy and could never be undone: a copy that had the log entry but not yet the day's number (sync sends rows a page at
// a time, so one can arrive before the other), or a day's number typed over the band's and then cleared (the person
// cleared their own number, not the band's).
// Only a deletion made on this copy by the app counts, never one a sync writes (motus.sync_apply on a device, or
// motus.sync_origin on the server): the copy where the person deleted it marks the entry, and that mark travels on its
// own as a health_imports row. A synced delete of a day's number is keyed only by the day and kind, so it may stand for
// a typed number deleted elsewhere while this copy has the band's.

/** The import log's kind for a daily_logs kind (as KEY in 031). */
const KIND = `CASE OLD.kind WHEN 'sleep_h' THEN 'sleep' WHEN 'distance_m' THEN 'distance' WHEN 'water_ml' THEN 'water' ELSE OLD.kind END`;

export default /* sql */ `
CREATE FUNCTION motus_health_deleted_mark() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('motus.sync_apply', true) = '1' OR coalesce(current_setting('motus.sync_origin', true), '') <> '' THEN RETURN NULL; END IF;
  -- one branch per table: each only names columns its table has
  IF TG_TABLE_NAME = 'daily_logs' THEN
    -- a typed number (or one from before sources) is the person's own: clearing it leaves the band's import as it was
    IF OLD.source IS DISTINCT FROM 'health_connect' THEN RETURN NULL; END IF;
    UPDATE health_imports SET deleted_at = now()
      WHERE user_id = OLD.user_id AND key = ${KIND} || ':' || to_char(OLD.date, 'YYYY-MM-DD') AND deleted_at IS NULL;
  ELSE
    UPDATE health_imports SET deleted_at = now() WHERE user_id = OLD.user_id AND ref = OLD.id::text AND deleted_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER health_deleted_mark AFTER DELETE ON daily_logs FOR EACH ROW EXECUTE FUNCTION motus_health_deleted_mark();
CREATE TRIGGER health_deleted_mark AFTER DELETE ON body_metrics FOR EACH ROW EXECUTE FUNCTION motus_health_deleted_mark();
CREATE TRIGGER health_deleted_mark AFTER DELETE ON activities FOR EACH ROW EXECUTE FUNCTION motus_health_deleted_mark();
`;
