// What a band (through Health Connect) adds to what was recorded in Motus: its step count for exactly an activity's
// time, and heart rate for activities and workouts. Also the daily resting heart rate, SpO2 and HRV in the import log.
// Every new column is NULL-tolerant with no NOT NULL: a device on an older app syncs or restores rows without these
// keys (as 009 had to learn for has_steps). Sync writes only the keys a row's JSON has, so such a row keeps what is here.
export default /* sql */ `
-- NULL: as recorded, or typed when it was logged; 'band': the band's count replaced the app's; 'manual': changed by hand later
ALTER TABLE activities ADD COLUMN steps_source text;
-- the app's own count, kept when the band's replaced it
ALTER TABLE activities ADD COLUMN steps_app int;
ALTER TABLE activities ADD COLUMN max_hr int;
-- [[unix seconds, bpm], ...], at most 600 points
ALTER TABLE activities ADD COLUMN hr jsonb;
ALTER TABLE workouts ADD COLUMN avg_hr int;
ALTER TABLE workouts ADD COLUMN max_hr int;
ALTER TABLE workouts ADD COLUMN hr jsonb;
ALTER TABLE health_imports DROP CONSTRAINT IF EXISTS health_imports_kind_check;
ALTER TABLE health_imports ADD CONSTRAINT health_imports_kind_check CHECK (kind IN ('steps', 'sleep', 'weight', 'activity', 'resting_hr', 'spo2', 'hrv'));
`;
