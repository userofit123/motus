// A day's number keeps both values it can have: the one typed in (typed) and the one Health Connect brought in
// (synced), and which of them the day uses (chosen: 'synced', or null for the default: a typed value wins, else the
// synced one; 'typed' is accepted and means the default). Before, a typed value replaced the band's, so the band's number
// was lost, and an import skipped a typed day entirely (not even noted in the import log).
// value and source stay what every reader takes (stats, goals, Home, Calendar, Reports, readiness, exports): the value
// the day uses and where it came from ('health_connect' or a typed source), kept by the trigger below on every write,
// so nothing else re-implements the choice.
// An older app (through sync) or a backup from before writes only value and source: the trigger files that value as
// typed or synced by its source, so the other value stays as it was (an older app typing a number never wipes the
// band's, and it makes the typed one used, as typing does here).
// Also replaces 031's rules for daily_logs: a key marked deleted keeps no synced value (the row goes when nothing typed
// is left), instead of the whole row being skipped or deleted with the typed value in it.
// health_imports.restored_at: when the person took back a deletion (Imported data → Deleted → Restore), so a copy that
// still has the deletion doesn't win over the restore (sync/core overrule), and a later deletion still wins over it.
// typed_at: when typed or chosen last changed (stamped by the trigger, unless the writer brings its own: a sync carries
// the stamp of the copy where the person typed). Sync merges a day per column with it (sync/core): an import from a copy
// that hadn't heard of a newer typed value or choice takes its synced value in, never its stale typed one.
// The backfill isn't logged for sync: every copy runs this migration on its own rows.

/** The import log's key for a daily_logs row (as KEY in 031). */
const KEY = `(CASE NEW.kind WHEN 'sleep_h' THEN 'sleep' WHEN 'distance_m' THEN 'distance' WHEN 'water_ml' THEN 'water' ELSE NEW.kind END) || ':' || to_char(NEW.date, 'YYYY-MM-DD')`;
const DAILY_KINDS = "('steps', 'sleep', 'resting_hr', 'spo2', 'hrv', 'distance', 'active_kcal', 'water', 'vo2max')";

/**
 * The trigger that keeps value and source. Also run on its own (TYPED_AT, migrate.ts) on a database that recorded 039
 * before typed_at was added to it (development copies only; 039 was never released without it).
 */
const VALUE_TRIGGER = /* sql */ `
-- runs for every writer (also a sync applying rows), so it never looks at motus.sync_apply
CREATE OR REPLACE FUNCTION motus_daily_value() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE use_synced boolean;
BEGIN
  -- a writer that knows only value and source: the value is typed or synced by its source
  IF TG_OP = 'INSERT' THEN
    IF NEW.typed IS NULL AND NEW.synced IS NULL THEN
      IF NEW.source = 'health_connect' THEN NEW.synced := NEW.value; ELSE NEW.typed := NEW.value; END IF;
    END IF;
    IF (NEW.typed IS NOT NULL OR NEW.chosen IS NOT NULL) AND NEW.typed_at IS NULL THEN NEW.typed_at := now(); END IF;
  ELSE
    IF (NEW.typed, NEW.synced, NEW.chosen) IS NOT DISTINCT FROM (OLD.typed, OLD.synced, OLD.chosen)
      AND (NEW.value, NEW.source) IS DISTINCT FROM (OLD.value, OLD.source) THEN
      IF NEW.source = 'health_connect' THEN NEW.synced := NEW.value; ELSE NEW.typed := NEW.value; NEW.chosen := NULL; END IF;
    END IF;
    -- typed or chosen changed here: stamped now, unless the writer brought the stamp of where it changed (a sync)
    IF (NEW.typed, NEW.chosen) IS DISTINCT FROM (OLD.typed, OLD.chosen) AND NEW.typed_at IS NOT DISTINCT FROM OLD.typed_at THEN
      NEW.typed_at := now();
    END IF;
  END IF;
  -- an import the person deleted has no number from Health Connect
  IF NEW.synced IS NOT NULL AND EXISTS (SELECT 1 FROM health_imports WHERE user_id = NEW.user_id AND key = ${KEY} AND deleted_at IS NOT NULL) THEN
    NEW.synced := NULL;
  END IF;
  IF NEW.typed IS NULL AND NEW.synced IS NULL THEN RETURN NULL; END IF;
  use_synced := NEW.typed IS NULL OR (NEW.chosen = 'synced' AND NEW.synced IS NOT NULL);
  NEW.value := CASE WHEN use_synced THEN NEW.synced ELSE NEW.typed END;
  NEW.source := CASE WHEN use_synced THEN 'health_connect' WHEN NEW.source = 'health_connect' THEN 'manual' ELSE NEW.source END;
  RETURN NEW;
END $$;
`;

/** typed_at on a database that ran 039 before it had it (see VALUE_TRIGGER); safe to run again. */
export const TYPED_AT = /* sql */ `
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS typed_at timestamptz;
${VALUE_TRIGGER}
`;

export default /* sql */ `
ALTER TABLE daily_logs ADD COLUMN typed numeric;
ALTER TABLE daily_logs ADD COLUMN synced numeric;
ALTER TABLE daily_logs ADD COLUMN chosen text CHECK (chosen IN ('typed', 'synced'));
ALTER TABLE daily_logs ADD COLUMN typed_at timestamptz;
ALTER TABLE health_imports ADD COLUMN restored_at timestamptz;

SELECT set_config('motus.sync_apply', '1', true);
UPDATE daily_logs SET synced = CASE WHEN source = 'health_connect' THEN value END, typed = CASE WHEN source IS DISTINCT FROM 'health_connect' THEN value END;
-- sleep typed over the band's: the band's hours are still known from its night
UPDATE daily_logs d SET synced = round(n.asleep_min / 6.0) / 10 FROM sleep_nights n
  WHERE d.kind = 'sleep_h' AND d.synced IS NULL AND n.user_id = d.user_id AND n.date = d.date
    AND NOT EXISTS (SELECT 1 FROM health_imports h WHERE h.user_id = d.user_id AND h.key = 'sleep:' || to_char(d.date, 'YYYY-MM-DD') AND h.deleted_at IS NOT NULL);
SELECT set_config('motus.sync_apply', '', true);

DROP TRIGGER health_deleted ON daily_logs;

${VALUE_TRIGGER}
CREATE TRIGGER daily_value BEFORE INSERT OR UPDATE ON daily_logs FOR EACH ROW EXECUTE FUNCTION motus_daily_value();

-- a key marked deleted: the day's synced value goes, and the day with it when nothing typed is left
CREATE OR REPLACE FUNCTION motus_health_deleted_clear() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
  IF NEW.kind IN ${DAILY_KINDS} AND NEW.date IS NOT NULL THEN
    k := CASE NEW.kind WHEN 'sleep' THEN 'sleep_h' WHEN 'distance' THEN 'distance_m' WHEN 'water' THEN 'water_ml' ELSE NEW.kind END;
    DELETE FROM daily_logs WHERE user_id = NEW.user_id AND date = NEW.date AND kind = k AND typed IS NULL;
    UPDATE daily_logs SET synced = NULL, chosen = NULL WHERE user_id = NEW.user_id AND date = NEW.date AND kind = k AND (synced IS NOT NULL OR chosen IS NOT NULL);
    IF NEW.kind = 'sleep' THEN DELETE FROM sleep_nights WHERE user_id = NEW.user_id AND date = NEW.date; END IF;
  END IF;
  RETURN NULL;
END $$;
`;
