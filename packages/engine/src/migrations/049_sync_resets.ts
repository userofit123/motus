// Where in sync_log a person's data was last replaced whole (a restore with Replace, modules/data.ts importAll). A
// device whose copy is from before that point makes its copy again from the server instead of fetching the changes
// (modules/sync.ts pull, sync/replica.ts remakeCopy): the restore's deletions only cover rows the server had, so a row
// only the device had (one the server refused, M-257) would otherwise stay there beside the restored ones for good.
// Not synced and not in backups: it describes the server's log, which each restore moves on.
const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";
export default /* sql */ `
CREATE TABLE sync_resets (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seq bigint NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_resets TO motus_app;
ALTER TABLE sync_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON sync_resets TO motus_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});
`;
