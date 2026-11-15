// The times the phone read each Health Connect record type whole (M-238 review): a read posted as complete to
// /health/records (every record of the type in that time), merged with the ones before it. A day's number is worked out
// from the saved records only when its whole day was read (modules/healthDerive.ts readDay); a day read in part keeps
// the phone's number, which had all of it. zone: the read's zone (seconds east of UTC), for where its days begin.
// Not synced and not in backups: a by-product of the phone's reads, which a later read fills in again.
const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";
export default /* sql */ `
CREATE TABLE health_record_reads (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  from_s bigint NOT NULL,
  to_s bigint NOT NULL,
  zone integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, type, from_s)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON health_record_reads TO motus_app;
ALTER TABLE health_record_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON health_record_reads TO motus_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});
`;
