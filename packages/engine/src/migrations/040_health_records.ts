// Every record Health Connect holds for the kinds Motus reads, kept as Health Connect has it (M-238): its times, its
// value or samples or stages, the app and device it came from, and Health Connect's id and last-modified time, so a
// read again updates instead of duplicating and a record deleted there is deleted here. Daily totals, nights and an
// activity's band numbers are results; these are the readings behind them, for the Sleep, Steps and Heart pages and
// whatever comes later.
//
// Storage: one row per person, type and day (a block), the day's records in one jsonb object keyed by Health Connect's
// id. Minute heart rate is ~500k samples a year; as one row per sample that is a big table and a big index, while a
// day's block is one row of a few tens of kB, read whole by a day's page. day: the record's own calendar day (by the
// zone offset it was written with), from its start, or for sleep its end (the day the person woke up, as the daily log
// files sleep). ids: the block's keys again, indexed, so a record deleted in Health Connect (only its id is known then)
// or moved to another day is found without reading every block.
//
// Not synced between devices (no sync_log trigger): a server account sends its records straight to the server
// (/health/records is server-only on the phone's copy), which keeps everything; Health Connect is the buffer while the
// phone is offline. A local account keeps them in its own database. In backups, like every table of a person's data.
//
// The import log covers them: a day's number deleted from it (or its data deleted elsewhere, 034) takes that day's
// records of that kind with it, a reading or session deleted takes its record, and the import never brings them back
// while the key is deleted (modules/healthRecords.ts). Kinds without an import log key (heart rate, breathing, floors,
// climb) are by-products, as hr_days is.
const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";
export const RECORD_TYPES = [
  "steps", "distance", "active_kcal", "floors", "elevation", "hydration", "heart_rate", "sleep", "exercise",
  "resting_hr", "spo2", "hrv", "resp_rate", "vo2max", "weight", "body_fat",
] as const;

export default /* sql */ `
CREATE TABLE health_records (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (${RECORD_TYPES.map((t) => `'${t}'`).join(", ")})),
  day date NOT NULL,
  recs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ids text[] NOT NULL DEFAULT '{}'::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type, day)
);
CREATE INDEX health_records_ids ON health_records USING gin (ids);
GRANT SELECT, INSERT, UPDATE, DELETE ON health_records TO motus_app;
ALTER TABLE health_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON health_records TO motus_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});

-- a key marked deleted takes its records: a day's number the day's records of its kind, a reading or session its record
CREATE FUNCTION motus_health_records_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text; rid text;
BEGIN
  t := CASE NEW.kind WHEN 'water' THEN 'hydration' WHEN 'activity' THEN 'exercise' ELSE NEW.kind END;
  IF NEW.kind IN ('weight', 'body_fat', 'activity') THEN
    rid := substr(NEW.key, length(NEW.kind) + 2);
    UPDATE health_records SET recs = recs - rid, ids = array_remove(ids, rid), updated_at = now()
      WHERE user_id = NEW.user_id AND type = t AND ids @> ARRAY[rid];
    DELETE FROM health_records WHERE user_id = NEW.user_id AND type = t AND cardinality(ids) = 0;
  ELSIF NEW.date IS NOT NULL THEN
    DELETE FROM health_records WHERE user_id = NEW.user_id AND type = t AND day = NEW.date;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER health_records_deleted AFTER INSERT OR UPDATE OF deleted_at ON health_imports
  FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL) EXECUTE FUNCTION motus_health_records_deleted();
`;
