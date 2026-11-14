// A band's heart rate through a whole day (through Health Connect): the day's lowest, highest and average, and a
// series for a chart. It is a by-product of the heart rate samples the phone already reads, not something the person
// logged, so it is not in the import log: each import writes the day again.
// Also: body fat readings, water and VO2 max from Health Connect in the import log (body_metrics kind body_fat, daily_logs
// kinds water_ml and vo2max).
const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";

export default /* sql */ `
CREATE TABLE hr_days (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- the calendar day as the phone counts it
  date date NOT NULL,
  min_hr int,
  max_hr int,
  avg_hr int,
  -- [[unix seconds, bpm], ...], at most 288 points (one per 5 minutes)
  hr jsonb,
  PRIMARY KEY (user_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_days TO motus_app;
ALTER TABLE hr_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON hr_days TO motus_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});
CREATE TRIGGER sync_log AFTER INSERT OR UPDATE OR DELETE ON hr_days FOR EACH ROW EXECUTE FUNCTION motus_log_change('user_id', 'date');
ALTER TABLE health_imports DROP CONSTRAINT IF EXISTS health_imports_kind_check;
ALTER TABLE health_imports ADD CONSTRAINT health_imports_kind_check
  CHECK (kind IN ('steps', 'sleep', 'weight', 'activity', 'resting_hr', 'spo2', 'hrv', 'distance', 'active_kcal', 'body_fat', 'water', 'vo2max'));
`;
