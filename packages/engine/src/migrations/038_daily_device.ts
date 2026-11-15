// The kind of worn device (watch, band, ring, chestStrap) whose count a day's steps, distance or active calories is, as
// the phone names it per day, so screens say "your watch" or "your ring". Kept on the day's row and read back from the
// newest days (GET /health/device), not saved in the person's settings: settings are one row synced last-write-wins, so
// an automatic write there (from a phone's possibly stale copy) could undo what the person changed on another device,
// and each write logged a "Changed settings" they never made. null: not known (an older app, or a device that doesn't
// say, as many through Gadgetbridge); a later read that doesn't know never clears a known kind.
// No sync change: rows travel whole, and a copy on an older version leaves out the column it doesn't know.
export default /* sql */ `
ALTER TABLE daily_logs ADD COLUMN device text;
`;
