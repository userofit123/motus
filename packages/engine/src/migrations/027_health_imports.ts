// The Health Connect import log: one row per thing the phone brought in (a day's steps or sleep, a weight reading, an
// exercise session), keyed by what Health Connect calls it. It lets the person see, edit and delete what came in, and a
// deletion sticks: deleted_at stays set, so the next sync skips that key instead of bringing it back.
// Synced like the other tables of a person's data (004_sync), so a phone's local copy knows what was deleted elsewhere.
const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";

export default /* sql */ `
CREATE TABLE health_imports (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL, -- steps:YYYY-MM-DD, sleep:YYYY-MM-DD, weight:<record id>, activity:<record id>
  kind text NOT NULL CHECK (kind IN ('steps', 'sleep', 'weight', 'activity')),
  date date, -- the day, for steps and sleep
  ref text, -- the body_metrics or activities row it became; text, so a stray value from a backup can't break a read
  imported_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON health_imports TO motus_app;
ALTER TABLE health_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON health_imports TO motus_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});
CREATE TRIGGER sync_log AFTER INSERT OR UPDATE OR DELETE ON health_imports FOR EACH ROW EXECUTE FUNCTION motus_log_change('user_id', 'key');
`;
