// The one full-history pass of linking band sessions to Motus records (M-250 fix round 4, bandMatch linkHistory): the
// duplicates from before linking are cleaned up once over the whole history, not only where a read or save happens to
// look. A few hundred imported activities per import or save (after_at, after_id: where it got to), done_at once through.
// Not synced and not in backups: each copy checks its own rows; a restore deletes it, so restored rows are checked too.
const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";
export default /* sql */ `
CREATE TABLE band_link_pass (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  after_at timestamptz,
  after_id text,
  done_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON band_link_pass TO motus_app;
ALTER TABLE band_link_pass ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON band_link_pass TO motus_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});
`;
