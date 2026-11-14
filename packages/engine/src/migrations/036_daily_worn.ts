// Whether a day's number from Health Connect came from something worn (a band, watch or ring) or only from other apps
// (the phone's own step counter, Google Fit), so the app says "from your band" only when a band counted. Kept beside
// source rather than as a source of its own: everything that tells a band's number from a typed one goes by
// source = 'health_connect' and stays as it is. true for every row there is already and for a phone on an older app,
// which doesn't say (as the app has always taken them); only steps, distance and active calories are ever false.
// No sync change: rows travel whole, and a copy on an older version leaves out the column it doesn't know.
export default /* sql */ `
ALTER TABLE daily_logs ADD COLUMN worn boolean NOT NULL DEFAULT true;
`;
