// What a band, watch or ring measured during an activity recorded in Motus, beside the app's own numbers and never
// over them: a typed or GPS distance or climb stays the activity's, and the page shows the band's as the band's. A time
// only activity (climbing, yoga) gets these where it has nothing of its own. Read through /health/ranges, only from a
// worn device's records (never the phone's own counting), and only when its records cover the whole activity.
// band_at: when the band's numbers were last taken in full, so a newer app asks about each activity once.
// No sync change: rows travel whole, and a copy on an older version leaves out the columns it doesn't know.
export default /* sql */ `
ALTER TABLE activities ADD COLUMN band_distance_m double precision;
ALTER TABLE activities ADD COLUMN band_kcal int;
ALTER TABLE activities ADD COLUMN band_elevation_m double precision;
ALTER TABLE activities ADD COLUMN band_floors double precision;
ALTER TABLE activities ADD COLUMN band_at timestamptz;
`;
