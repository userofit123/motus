// The activity log reads a person's changes newest first: index sync_log that way so it doesn't scan the whole table.
export default /* sql */ `
CREATE INDEX sync_log_recent ON sync_log (user_id, at DESC, seq DESC);
`;
