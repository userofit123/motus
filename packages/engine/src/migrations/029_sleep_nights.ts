// A band's night of sleep in detail (through Health Connect): when it started and ended, the time in each stage, and
// heart rate, SpO2 and breathing during it. The daily log's sleep_h stays the day's number (the person's, when typed);
// a night is the detail behind it, filed under the same import key (sleep:<date>), so deleting that day's sleep from the
// import log deletes the night too and it never comes back.
// date is the day the person woke up, the same day the daily log files the sleep under. One night per day.
// Also: a band's daily distance and active calories in the import log (daily_logs kinds distance_m and active_kcal).
const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";

export default /* sql */ `
CREATE TABLE sleep_nights (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  asleep_min int NOT NULL,
  awake_min int NOT NULL,
  -- NULL when the source had no stages (only asleep and awake)
  light_min int,
  deep_min int,
  rem_min int,
  avg_hr int,
  min_hr int,
  -- [[unix seconds, bpm], ...], at most 300 points
  hr jsonb,
  avg_spo2 numeric,
  min_spo2 numeric,
  -- breaths per minute
  resp_rate numeric,
  source text NOT NULL DEFAULT 'health_connect',
  PRIMARY KEY (user_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON sleep_nights TO motus_app;
ALTER TABLE sleep_nights ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON sleep_nights TO motus_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});
CREATE TRIGGER sync_log AFTER INSERT OR UPDATE OR DELETE ON sleep_nights FOR EACH ROW EXECUTE FUNCTION motus_log_change('user_id', 'date');
ALTER TABLE health_imports DROP CONSTRAINT IF EXISTS health_imports_kind_check;
ALTER TABLE health_imports ADD CONSTRAINT health_imports_kind_check
  CHECK (kind IN ('steps', 'sleep', 'weight', 'activity', 'resting_hr', 'spo2', 'hrv', 'distance', 'active_kcal'));
`;
