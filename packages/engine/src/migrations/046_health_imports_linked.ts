// A band session that is a workout or activity recorded in Motus (the band also saw it, M-250 fix round) is linked to
// that record instead of becoming a second activity: its import log entry points at the Motus record (ref) and says
// which kind it is (linked), so time, steps and load count once. apart: the person unlinked it (Imported data →
// Unlink), so it comes in as its own activity and is never matched again. span_start/span_end: the session's time,
// kept also after it is deleted, so the same session from a second app arriving after the deletion stays out too.
export default /* sql */ `
ALTER TABLE health_imports ADD COLUMN linked text CHECK (linked IN ('activity', 'workout'));
ALTER TABLE health_imports ADD COLUMN apart boolean NOT NULL DEFAULT false;
ALTER TABLE health_imports ADD COLUMN span_start timestamptz;
ALTER TABLE health_imports ADD COLUMN span_end timestamptz;
UPDATE health_imports h SET span_start = a.started_at, span_end = a.ended_at FROM activities a WHERE h.kind = 'activity' AND a.id::text = h.ref;
`;
