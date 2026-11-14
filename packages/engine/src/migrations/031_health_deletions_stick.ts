// A Health Connect import deleted from the import log (or whose data was deleted elsewhere) has no data left, wherever
// the data comes from. Before, only the next import of that same key cleared a day's number that a copy which hadn't
// heard of the deletion synced back (a phone pushing its older rows, newest wins for daily_logs), so Home, Stats and the
// Calendar showed values that the import log hid as deleted and nobody could correct or delete.
// Now the database keeps the two in step on every path (an import, a sync from a device, a device applying the
// server's rows):
// - a day's number from Health Connect (daily_logs source 'health_connect') or a night (sleep_nights) is not written for
//   a key marked deleted; a typed value ('manual') always is;
// - marking a key deleted removes its day's number from Health Connect and, for sleep, its night.
// Repair of what is already out of step: a day's number from Health Connect or a night filed under a deleted key goes.
// Every deletion in the log is the person's own (deleted from the log, or its data deleted elsewhere in the app); the
// number only came back because a copy that hadn't heard yet synced it. Un-deleting instead would also not hold: a
// copy that still has the deletion sends it again, and a deletion wins on every copy (sync/core overrule), so the
// person would see the numbers vanish again later, on one copy before another.

/** The import log's key for a daily_logs or sleep_nights row: its kind as the import log names it, and the day. */
const KEY = (kind: string) => `(CASE ${kind} WHEN 'sleep_h' THEN 'sleep' WHEN 'distance_m' THEN 'distance' WHEN 'water_ml' THEN 'water' ELSE ${kind} END) || ':' || to_char(NEW.date, 'YYYY-MM-DD')`;
/** The daily_logs kind for an import log kind (h: health_imports). */
const DAILY = `CASE h.kind WHEN 'sleep' THEN 'sleep_h' WHEN 'distance' THEN 'distance_m' WHEN 'water' THEN 'water_ml' ELSE h.kind END`;
const DAILY_KINDS = "('steps', 'sleep', 'resting_hr', 'spo2', 'hrv', 'distance', 'active_kcal', 'water', 'vo2max')";

export default /* sql */ `
DELETE FROM daily_logs d USING health_imports h
  WHERE h.deleted_at IS NOT NULL AND h.kind IN ${DAILY_KINDS}
    AND d.user_id = h.user_id AND d.date = h.date AND d.kind = ${DAILY} AND d.source = 'health_connect';
DELETE FROM sleep_nights n USING health_imports h
  WHERE h.user_id = n.user_id AND h.kind = 'sleep' AND h.date = n.date AND h.deleted_at IS NOT NULL;

-- runs for every writer (also a sync applying rows), so it never looks at motus.sync_apply
CREATE FUNCTION motus_health_deleted_skip() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
  -- one branch per table: each only names columns its table has
  IF TG_TABLE_NAME = 'sleep_nights' THEN
    k := 'sleep:' || to_char(NEW.date, 'YYYY-MM-DD');
  ELSE
    IF NEW.source IS DISTINCT FROM 'health_connect' THEN RETURN NEW; END IF;
    k := ${KEY("NEW.kind")};
  END IF;
  IF EXISTS (SELECT 1 FROM health_imports WHERE user_id = NEW.user_id AND key = k AND deleted_at IS NOT NULL) THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER health_deleted BEFORE INSERT OR UPDATE ON daily_logs FOR EACH ROW EXECUTE FUNCTION motus_health_deleted_skip();
CREATE TRIGGER health_deleted BEFORE INSERT OR UPDATE ON sleep_nights FOR EACH ROW EXECUTE FUNCTION motus_health_deleted_skip();

CREATE FUNCTION motus_health_deleted_clear() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IN ${DAILY_KINDS} AND NEW.date IS NOT NULL THEN
    DELETE FROM daily_logs WHERE user_id = NEW.user_id AND date = NEW.date AND source = 'health_connect'
      AND kind = CASE NEW.kind WHEN 'sleep' THEN 'sleep_h' WHEN 'distance' THEN 'distance_m' WHEN 'water' THEN 'water_ml' ELSE NEW.kind END;
    IF NEW.kind = 'sleep' THEN DELETE FROM sleep_nights WHERE user_id = NEW.user_id AND date = NEW.date; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER health_deleted AFTER INSERT OR UPDATE ON health_imports FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION motus_health_deleted_clear();
`;
